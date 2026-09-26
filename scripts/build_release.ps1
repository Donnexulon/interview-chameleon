param(
    [string]$Version = "1.0.0-beta.1",
    [string]$SignToolName = ""
)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$releaseRoot = Join-Path $repoRoot "release"
$distRoot = Join-Path $repoRoot "dist"
$appRoot = Join-Path $distRoot "release\app"
$backendRoot = Join-Path $appRoot "backend"
$bootstrapper = Join-Path $repoRoot "installer\prerequisites\MicrosoftEdgeWebview2Setup.exe"
$buildEnvironment = Join-Path $repoRoot ".release-venv"
$buildPython = Join-Path $buildEnvironment "Scripts\python.exe"

function Assert-WorkspaceChildPath([string]$Candidate) {
    $rootWithSeparator = [System.IO.Path]::GetFullPath($repoRoot).TrimEnd('\') + '\'
    $resolvedCandidate = [System.IO.Path]::GetFullPath($Candidate)
    if (-not $resolvedCandidate.StartsWith($rootWithSeparator, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to modify a path outside the workspace: $resolvedCandidate"
    }
}

if ($Version -ne "1.0.0-beta.1") {
    throw "Update APP_VERSION, the desktop project, and installer together before changing the release version."
}
if (-not (Test-Path -LiteralPath $bootstrapper)) {
    throw "Missing official Evergreen WebView2 bootstrapper: $bootstrapper"
}
$bootstrapperSignature = Get-AuthenticodeSignature -LiteralPath $bootstrapper
if ($bootstrapperSignature.Status -ne "Valid" -or $bootstrapperSignature.SignerCertificate.Subject -notmatch "O=Microsoft Corporation") {
    throw "The WebView2 bootstrapper is not validly signed by Microsoft Corporation."
}

Push-Location $repoRoot
try {
    if (-not (Test-Path -LiteralPath $buildPython)) {
        python -m venv $buildEnvironment
        if ($LASTEXITCODE -ne 0) { throw "Could not create the isolated release environment." }
    }
    & $buildPython -m pip install --disable-pip-version-check -r requirements-build.txt
    if ($LASTEXITCODE -ne 0) { throw "Release dependency installation failed." }

    & $buildPython -m unittest discover -s tests -v
    if ($LASTEXITCODE -ne 0) { throw "Backend tests failed." }
    node --check static/js/app.js
    node --check static/js/body_language.js
    node --check static/js/local_speech.js
    node --check static/js/accessibility.js
    node --check static/js/setup_carousel.js
    node --check static/js/html_safety.js
    if ($LASTEXITCODE -ne 0) { throw "Frontend syntax validation failed." }
    node tests/frontend_state.test.cjs
    if ($LASTEXITCODE -ne 0) { throw "Frontend state tests failed." }
    npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw "Frontend release dependency installation failed." }
    $vendoredAlpine = Join-Path $repoRoot "static\vendor\alpine\cdn.min.js"
    $pinnedAlpine = Join-Path $repoRoot "node_modules\@alpinejs\csp\dist\cdn.min.js"
    if ((Get-FileHash -LiteralPath $vendoredAlpine -Algorithm SHA256).Hash -ne (Get-FileHash -LiteralPath $pinnedAlpine -Algorithm SHA256).Hash) {
        throw "The vendored Alpine runtime does not match the pinned CSP-compatible package."
    }
    npx playwright install chromium
    if ($LASTEXITCODE -ne 0) { throw "Playwright Chromium installation failed." }
    npm run test:e2e
    if ($LASTEXITCODE -ne 0) { throw "Browser flow or accessibility tests failed." }

    & $buildPython -m PyInstaller --noconfirm --clean packaging/InterviewChameleon.spec
    if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed." }
    & (Join-Path $repoRoot "scripts\smoke_packaged.ps1") -BackendPath (Join-Path $distRoot "InterviewChameleon.Backend\InterviewChameleon.Backend.exe")
    if ($LASTEXITCODE -ne 0) { throw "Packaged backend smoke test failed." }

    Assert-WorkspaceChildPath $appRoot
    if (Test-Path -LiteralPath $appRoot) { Remove-Item -LiteralPath $appRoot -Recurse -Force }
    New-Item -ItemType Directory -Path $appRoot -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $distRoot "InterviewChameleon.Backend") -Destination $backendRoot -Recurse

    dotnet publish desktop/InterviewChameleon.Desktop.csproj -c Release -r win-x64 --self-contained true -o $appRoot
    if ($LASTEXITCODE -ne 0) { throw "Desktop shell publish failed." }
    Copy-Item -LiteralPath (Join-Path $repoRoot "PRIVACY.md") -Destination $appRoot
    Copy-Item -LiteralPath (Join-Path $repoRoot "PROPRIETARY_NOTICE.txt") -Destination $appRoot
    Copy-Item -LiteralPath (Join-Path $repoRoot "THIRD_PARTY_NOTICES.md") -Destination $appRoot

    New-Item -ItemType Directory -Path $releaseRoot -Force | Out-Null
    $dependencyInventory = Join-Path $releaseRoot "python-dependencies.json"
    $pythonSbom = Join-Path $releaseRoot "sbom-python.json"
    $runtimeLock = Join-Path $releaseRoot "runtime-requirements.lock"
    $auditReport = Join-Path $releaseRoot "python-vulnerability-audit.json"
    & $buildPython scripts/runtime_dependencies.py --requirements requirements.txt --output $runtimeLock
    if ($LASTEXITCODE -ne 0) { throw "Runtime dependency closure generation failed." }
    $runtimePackages = @(& $buildPython scripts/runtime_dependencies.py --requirements requirements.txt --names)
    & $buildPython -m piplicenses --format=json --output-file=$dependencyInventory --packages @runtimePackages
    if ($LASTEXITCODE -ne 0) { throw "Dependency inventory generation failed." }
    & $buildPython -m cyclonedx_py requirements $runtimeLock --output-reproducible --output-file $pythonSbom
    if ($LASTEXITCODE -ne 0) { throw "SBOM generation failed." }
    & $buildPython -m pip_audit -r $runtimeLock --format json --output $auditReport
    if ($LASTEXITCODE -ne 0) { throw "Dependency vulnerability audit found an unaccepted vulnerability." }

    $isccCommand = Get-Command iscc.exe -ErrorAction SilentlyContinue
    $iscc = if ($isccCommand) { $isccCommand.Source } else { $null }
    if (-not $iscc) {
        $knownIsccPaths = @(
            (Join-Path $env:LOCALAPPDATA "Programs\Inno Setup 6\ISCC.exe"),
            (Join-Path $env:ProgramFiles "Inno Setup 6\ISCC.exe"),
            (Join-Path ${env:ProgramFiles(x86)} "Inno Setup 6\ISCC.exe")
        )
        $iscc = $knownIsccPaths | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    }
    if (-not $iscc) { throw "Inno Setup 6 (iscc.exe) is required to build the installer." }
    $installerArgs = @((Join-Path $repoRoot "installer\InterviewChameleon.iss"))
    if ($SignToolName) { $installerArgs += "/DSignToolName=$SignToolName" }
    & $iscc @installerArgs
    if ($LASTEXITCODE -ne 0) { throw "Inno Setup failed." }

    $artifact = Join-Path $releaseRoot "InterviewChameleon-Setup-$Version.exe"
    if (-not (Test-Path -LiteralPath $artifact)) { throw "Installer artifact was not produced." }
    $hash = (Get-FileHash -LiteralPath $artifact -Algorithm SHA256).Hash.ToLowerInvariant()
    $checksums = Join-Path $releaseRoot "SHA256SUMS.txt"
    "$hash  $(Split-Path $artifact -Leaf)" | Set-Content -LiteralPath $checksums -Encoding ascii
    $releaseIso = Join-Path $releaseRoot "InterviewChameleon-$Version.iso"
    & $buildPython scripts/build_release_iso.py --installer $artifact --checksums $checksums --output $releaseIso
    if ($LASTEXITCODE -ne 0) { throw "Release ISO generation failed." }
    Write-Host "Release ready: $artifact"
}
finally {
    Pop-Location
}
