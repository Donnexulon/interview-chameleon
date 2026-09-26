param([string]$ModelDirectory)

$ErrorActionPreference = "Stop"
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$source = (Resolve-Path -LiteralPath $ModelDirectory).Path
$required = @("config.json", "model.bin", "tokenizer.json", "vocabulary.txt")
foreach ($file in $required) {
    if (-not (Test-Path -LiteralPath (Join-Path $source $file))) {
        throw "Speech model is incomplete; missing $file"
    }
}
$stage = Join-Path $repoRoot "release\speech-pack\faster-whisper-small.en"
if (Test-Path -LiteralPath $stage) { Remove-Item -LiteralPath $stage -Recurse -Force }
New-Item -ItemType Directory -Path $stage -Force | Out-Null
Copy-Item -Path (Join-Path $source "*") -Destination $stage -Recurse
$zip = Join-Path $repoRoot "release\InterviewChameleon-SpeechPack-en-small-1.0.0.zip"
if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip -Force }
Compress-Archive -Path (Join-Path $repoRoot "release\speech-pack\*") -DestinationPath $zip -CompressionLevel Optimal
$hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant()
Add-Content -LiteralPath (Join-Path $repoRoot "release\SHA256SUMS.txt") -Value "$hash  $(Split-Path $zip -Leaf)" -Encoding ascii
Write-Host "Speech pack ready: $zip"
