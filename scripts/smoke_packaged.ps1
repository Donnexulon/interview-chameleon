param(
    [Parameter(Mandatory = $true)]
    [string]$BackendPath
)

$ErrorActionPreference = "Stop"
$backend = (Resolve-Path -LiteralPath $BackendPath).Path
$tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath()).TrimEnd('\') + '\'
$smokeRoot = Join-Path $tempRoot ("InterviewChameleon-Smoke-" + [Guid]::NewGuid().ToString("N"))
$resolvedSmokeRoot = [System.IO.Path]::GetFullPath($smokeRoot)
if (-not $resolvedSmokeRoot.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase) -or
    -not ([System.IO.Path]::GetFileName($resolvedSmokeRoot)).StartsWith("InterviewChameleon-Smoke-")) {
    throw "Refusing to create a smoke-test directory outside the system temporary directory."
}

$readyFile = Join-Path $resolvedSmokeRoot "ready.json"
$dataRoot = Join-Path $resolvedSmokeRoot "data-root"
$token = [Guid]::NewGuid().ToString("N") + [Guid]::NewGuid().ToString("N")
$process = $null

try {
    New-Item -ItemType Directory -Path $resolvedSmokeRoot | Out-Null
    $start = New-Object System.Diagnostics.ProcessStartInfo
    $start.FileName = $backend
    $start.WorkingDirectory = Split-Path -Parent $backend
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
    $start.EnvironmentVariables["INTERVIEW_CHAMELEON_PACKAGED"] = "1"
    $start.EnvironmentVariables["INTERVIEW_CHAMELEON_TOKEN"] = $token
    $start.EnvironmentVariables["INTERVIEW_CHAMELEON_READY_FILE"] = $readyFile
    $start.EnvironmentVariables["INTERVIEW_CHAMELEON_DATA_DIR"] = $dataRoot
    $process = [System.Diagnostics.Process]::Start($start)

    $deadline = [DateTime]::UtcNow.AddSeconds(35)
    while (-not (Test-Path -LiteralPath $readyFile)) {
        if ($process.HasExited) { throw "The packaged backend exited before becoming ready." }
        if ([DateTime]::UtcNow -ge $deadline) { throw "The packaged backend did not become ready within 35 seconds." }
        Start-Sleep -Milliseconds 100
    }
    $ready = Get-Content -LiteralPath $readyFile -Raw | ConvertFrom-Json
    $baseUrl = "http://127.0.0.1:$($ready.port)"

    $unauthorized = $null
    try {
        Invoke-WebRequest -Uri "$baseUrl/health" -UseBasicParsing | Out-Null
    }
    catch {
        if ($_.Exception.Response) { $unauthorized = [int]$_.Exception.Response.StatusCode }
    }
    if ($unauthorized -ne 401) { throw "The packaged API accepted a request without its launch token." }

    $headers = @{ "X-Interview-Chameleon-Token" = $token }
    $healthDeadline = [DateTime]::UtcNow.AddSeconds(8)
    do {
        try { $health = Invoke-RestMethod -Uri "$baseUrl/health" -Headers $headers; break }
        catch {
            if ([DateTime]::UtcNow -ge $healthDeadline) { throw }
            Start-Sleep -Milliseconds 150
        }
    } while ($true)
    if ($health.status -ne "ok") { throw "Packaged health endpoint did not return ok." }

    $status = Invoke-RestMethod -Uri "$baseUrl/api/system/status" -Headers $headers
    if (-not $status.app.packaged -or $status.telemetry -ne $false) {
        throw "Packaged system status did not report the expected local-only runtime."
    }
    $root = Invoke-WebRequest -Uri "$baseUrl/" -Headers $headers -UseBasicParsing
    if ($root.StatusCode -ne 200 -or $root.Content -notmatch "Interview Chameleon") {
        throw "Packaged application HTML did not load."
    }

    $docsStatus = $null
    try { Invoke-WebRequest -Uri "$baseUrl/docs" -Headers $headers -UseBasicParsing | Out-Null }
    catch { if ($_.Exception.Response) { $docsStatus = [int]$_.Exception.Response.StatusCode } }
    if ($docsStatus -ne 404) { throw "Packaged API documentation must be disabled." }

    Invoke-RestMethod -Method Post -Uri "$baseUrl/api/system/shutdown" -Headers $headers | Out-Null
    if (-not $process.WaitForExit(5000)) { throw "Packaged backend did not shut down cleanly." }
    if ($process.ExitCode -ne 0) { throw "Packaged backend exited with code $($process.ExitCode)." }
    Write-Host "Packaged backend smoke test passed."
}
finally {
    if ($process -and -not $process.HasExited) {
        $process.Kill()
        $process.WaitForExit(3000) | Out-Null
    }
    if (Test-Path -LiteralPath $resolvedSmokeRoot) {
        $verified = [System.IO.Path]::GetFullPath($resolvedSmokeRoot)
        if ($verified.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase) -and
            ([System.IO.Path]::GetFileName($verified)).StartsWith("InterviewChameleon-Smoke-")) {
            Remove-Item -LiteralPath $verified -Recurse -Force
        }
    }
}
