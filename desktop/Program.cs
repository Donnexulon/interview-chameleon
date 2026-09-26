using System.Diagnostics;
using System.IO.Pipes;
using System.Security.Cryptography;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace InterviewChameleon.Desktop;

internal static class Program
{
    private const string MutexName = @"Local\InterviewChameleon.Desktop";
    private const string FocusPipe = "InterviewChameleon.Focus";

    [STAThread]
    private static void Main()
    {
        using var mutex = new Mutex(true, MutexName, out var firstInstance);
        if (!firstInstance)
        {
            TryFocusExisting();
            return;
        }
        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm());
    }

    private static void TryFocusExisting()
    {
        try
        {
            using var pipe = new NamedPipeClientStream(".", FocusPipe, PipeDirection.Out);
            pipe.Connect(800);
            pipe.WriteByte(1);
        }
        catch { }
    }
}

internal sealed class MainForm : Form
{
    private const int BackendStartupTimeoutSeconds = 120;
    private readonly WebView2 webView = new()
    {
        Dock = DockStyle.Fill,
        DefaultBackgroundColor = Color.FromArgb(16, 17, 15),
    };
    private readonly Label startupStatus = new()
    {
        Dock = DockStyle.Fill,
        BackColor = Color.FromArgb(16, 17, 15),
        ForeColor = Color.FromArgb(236, 226, 207),
        Font = new Font("Segoe UI", 12F, FontStyle.Regular),
        Text = string.Empty,
        TextAlign = ContentAlignment.MiddleCenter,
    };
    private readonly CancellationTokenSource lifetime = new();
    private readonly string token = Convert.ToHexString(RandomNumberGenerator.GetBytes(32)).ToLowerInvariant();
    private Process? backend;
    private int backendPort;
    private string? readyFile;
    private string? launcherLog;
    private bool shutdownComplete;

    public MainForm()
    {
        Text = "Interview Chameleon";
        BackColor = Color.FromArgb(16, 17, 15);
        MinimumSize = new Size(1024, 700);
        Width = 1440;
        Height = 900;
        StartPosition = FormStartPosition.CenterScreen;
        Controls.Add(webView);
        Controls.Add(startupStatus);
        startupStatus.BringToFront();
        Shown += async (_, _) => await StartAsync();
        FormClosing += OnClosing;
        _ = ListenForFocusAsync(lifetime.Token);
    }

    private async Task ListenForFocusAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                await using var pipe = new NamedPipeServerStream("InterviewChameleon.Focus", PipeDirection.In, 1,
                    PipeTransmissionMode.Byte, PipeOptions.Asynchronous);
                await pipe.WaitForConnectionAsync(cancellationToken);
                _ = BeginInvoke((Action)(() => { if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal; Show(); Activate(); }));
            }
            catch (OperationCanceledException) { return; }
            catch { await Task.Delay(300, cancellationToken); }
        }
    }

    private async Task StartAsync()
    {
        WriteLauncherLog("desktop_start");
        try
        {
            backendPort = await StartBackendAsync(lifetime.Token);
            var userData = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Interview Chameleon", "cache", "webview2");
            Directory.CreateDirectory(userData);
            var environment = await CoreWebView2Environment.CreateAsync(null, userData);
            await webView.EnsureCoreWebView2Async(environment);
            ConfigureWebView();
            webView.CoreWebView2.Navigate($"http://127.0.0.1:{backendPort}/?launch_token={token}");
            startupStatus.Visible = false;
            WriteLauncherLog("desktop_ready");
        }
        catch (WebView2RuntimeNotFoundException)
        {
            WriteLauncherLog("desktop_start_failed", "type=WebView2RuntimeNotFoundException");
            MessageBox.Show("Microsoft Edge WebView2 Runtime is required. Repair the Interview Chameleon installation.",
                "WebView2 is missing", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }
        catch (Exception error)
        {
            WriteLauncherLog("desktop_start_failed", $"type={error.GetType().Name}");
            var logHint = launcherLog is null ? "" : $"\n\nStartup log:\n{launcherLog}";
            MessageBox.Show($"Interview Chameleon could not start.\n\n{error.Message}{logHint}",
                "Startup failed", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }
    }

    private async Task<int> StartBackendAsync(CancellationToken cancellationToken)
    {
        var backendPath = Path.Combine(AppContext.BaseDirectory, "backend", "InterviewChameleon.Backend.exe");
        if (!File.Exists(backendPath)) throw new FileNotFoundException("The packaged local backend is missing.", backendPath);
        var cache = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Interview Chameleon", "cache");
        Directory.CreateDirectory(cache);
        readyFile = Path.Combine(cache, $"launch-{Environment.ProcessId}-{Guid.NewGuid():N}.json");
        var start = new ProcessStartInfo(backendPath)
        {
            UseShellExecute = false,
            CreateNoWindow = true,
            WindowStyle = ProcessWindowStyle.Hidden,
            WorkingDirectory = AppContext.BaseDirectory,
        };
        start.Environment["INTERVIEW_CHAMELEON_PACKAGED"] = "1";
        start.Environment["INTERVIEW_CHAMELEON_TOKEN"] = token;
        start.Environment["INTERVIEW_CHAMELEON_READY_FILE"] = readyFile;
        backend = Process.Start(start) ?? throw new InvalidOperationException("The local backend process did not start.");
        var stopwatch = Stopwatch.StartNew();
        WriteLauncherLog("backend_process_started", $"pid={backend.Id}");
        var deadline = DateTime.UtcNow.AddSeconds(BackendStartupTimeoutSeconds);
        while (DateTime.UtcNow < deadline)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (backend.HasExited)
            {
                WriteLauncherLog("backend_exited_during_startup", $"exit_code={backend.ExitCode};elapsed_ms={stopwatch.ElapsedMilliseconds}");
                throw new InvalidOperationException("The local backend stopped during startup.");
            }
            if (File.Exists(readyFile))
            {
                try
                {
                    using var document = JsonDocument.Parse(await File.ReadAllTextAsync(readyFile, cancellationToken));
                    WriteLauncherLog("backend_ready", $"elapsed_ms={stopwatch.ElapsedMilliseconds}");
                    return document.RootElement.GetProperty("port").GetInt32();
                }
                catch (IOException) { }
                catch (JsonException) { }
            }
            await Task.Delay(100, cancellationToken);
        }
        WriteLauncherLog("backend_start_timeout", $"elapsed_ms={stopwatch.ElapsedMilliseconds}");
        throw new TimeoutException($"The local backend did not become ready within {BackendStartupTimeoutSeconds} seconds.");
    }

    private void WriteLauncherLog(string eventName, string? detail = null)
    {
        try
        {
            var logDirectory = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Interview Chameleon", "logs");
            Directory.CreateDirectory(logDirectory);
            launcherLog ??= Path.Combine(logDirectory, "launcher.log");
            var suffix = string.IsNullOrWhiteSpace(detail) ? "" : $"\t{detail}";
            File.AppendAllText(launcherLog, $"{DateTime.UtcNow:O}\t{eventName}{suffix}{Environment.NewLine}");
        }
        catch
        {
            // Diagnostics must never prevent the local application from starting.
        }
    }

    private void ConfigureWebView()
    {
        var core = webView.CoreWebView2;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.AreDefaultContextMenusEnabled = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsPasswordAutosaveEnabled = false;
        core.Settings.IsGeneralAutofillEnabled = false;
        core.PermissionRequested += (_, args) =>
        {
            var local = IsLocalAppUri(args.Uri);
            if (!local || args.PermissionKind is not (CoreWebView2PermissionKind.Camera or CoreWebView2PermissionKind.Microphone))
                args.State = CoreWebView2PermissionState.Deny;
        };
        core.NewWindowRequested += (_, args) =>
        {
            args.Handled = true;
            if (Uri.TryCreate(args.Uri, UriKind.Absolute, out var uri) && !IsLocalAppUri(uri.ToString()))
                Process.Start(new ProcessStartInfo(uri.ToString()) { UseShellExecute = true });
        };
        core.NavigationStarting += (_, args) =>
        {
            if (IsLocalAppUri(args.Uri)) return;
            args.Cancel = true;
            if (Uri.TryCreate(args.Uri, UriKind.Absolute, out var uri))
                Process.Start(new ProcessStartInfo(uri.ToString()) { UseShellExecute = true });
        };
        core.WebMessageReceived += (_, args) =>
        {
            if (!IsLocalAppUri(args.Source)) return;
            try
            {
                using var message = JsonDocument.Parse(args.WebMessageAsJson);
                if (message.RootElement.ValueKind != JsonValueKind.Object
                    || !message.RootElement.TryGetProperty("type", out var type)) return;
                var action = type.GetString();
                if (action is not ("open-ollama" or "download-ollama")) return;
                var opened = action == "open-ollama" ? TryOpenOllama() : TryOpenOllamaDownload();
                core.PostWebMessageAsJson(JsonSerializer.Serialize(new
                {
                    type = "ollama-open-result",
                    action,
                    opened,
                }));
            }
            catch (JsonException) { }
        };
    }

    private bool TryOpenOllama()
    {
        var localPrograms = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        var candidates = new[]
        {
            Path.Combine(localPrograms, "Programs", "Ollama", "ollama app.exe"),
            Path.Combine(programFiles, "Ollama", "ollama app.exe"),
        };
        var executable = candidates.FirstOrDefault(File.Exists);
        if (executable is null)
        {
            WriteLauncherLog("ollama_open_failed", "reason=not_found");
            return false;
        }
        try
        {
            Process.Start(new ProcessStartInfo(executable) { UseShellExecute = true });
            WriteLauncherLog("ollama_open_requested");
            return true;
        }
        catch (Exception error)
        {
            WriteLauncherLog("ollama_open_failed", $"type={error.GetType().Name}");
            return false;
        }
    }

    private bool TryOpenOllamaDownload()
    {
        const string downloadUrl = "https://ollama.com/download/windows";
        try
        {
            Process.Start(new ProcessStartInfo(downloadUrl) { UseShellExecute = true });
            WriteLauncherLog("ollama_download_opened");
            return true;
        }
        catch (Exception error)
        {
            WriteLauncherLog("ollama_download_failed", $"type={error.GetType().Name}");
            return false;
        }
    }

    private bool IsLocalAppUri(string value) =>
        Uri.TryCreate(value, UriKind.Absolute, out var uri)
        && uri.Scheme == Uri.UriSchemeHttp
        && uri.Host == "127.0.0.1"
        && uri.Port == backendPort;

    private async void OnClosing(object? sender, FormClosingEventArgs args)
    {
        if (shutdownComplete) return;
        args.Cancel = true;
        lifetime.Cancel();
        try
        {
            await webView.ExecuteScriptAsync("window.icExitCheckpointComplete=false;Promise.resolve(window.icCheckpointBeforeExit?.()).finally(()=>window.icExitCheckpointComplete=true);");
            for (var attempt = 0; attempt < 20; attempt++)
            {
                await Task.Delay(100);
                var completed = await webView.ExecuteScriptAsync("Boolean(window.icExitCheckpointComplete)");
                if (string.Equals(completed, "true", StringComparison.OrdinalIgnoreCase)) break;
            }
        }
        catch { }
        if (backend is { HasExited: false })
        {
            try
            {
                using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
                client.DefaultRequestHeaders.Add("X-Interview-Chameleon-Token", token);
                await client.PostAsync($"http://127.0.0.1:{backendPort}/api/system/shutdown", null);
                if (!backend.WaitForExit(2500)) backend.Kill(true);
            }
            catch { try { backend.Kill(true); } catch { } }
        }
        if (readyFile is not null) try { File.Delete(readyFile); } catch { }
        shutdownComplete = true;
        BeginInvoke((Action)(() => Close()));
    }
}
