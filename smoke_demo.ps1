$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

$Python = Join-Path $Root "venv\Scripts\python.exe"
$BaseUrl = "http://127.0.0.1:8000"
$Doctor = Join-Path $Root "doctor.ps1"

function Invoke-Step {
    param([string]$Name)
    Write-Host ""
    Write-Host $Name
}

function Assert-True {
    param(
        [bool]$Condition,
        [string]$Message
    )
    if (-not $Condition) {
        throw $Message
    }
}

function Invoke-FileUpload {
    param(
        [string]$Uri,
        [string]$Path
    )

    Add-Type -AssemblyName System.Net.Http
    $Client = New-Object System.Net.Http.HttpClient
    $Content = New-Object System.Net.Http.MultipartFormDataContent
    try {
        $Bytes = [System.IO.File]::ReadAllBytes($Path)
        $FileContent = New-Object System.Net.Http.ByteArrayContent -ArgumentList @(,$Bytes)
        $FileContent.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::Parse("text/plain")
        $Content.Add($FileContent, "file", [System.IO.Path]::GetFileName($Path))
        $Response = $Client.PostAsync($Uri, $Content).GetAwaiter().GetResult()
        $Body = $Response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        if (-not $Response.IsSuccessStatusCode) {
            throw "Upload failed with HTTP $([int]$Response.StatusCode): $Body"
        }
        return $Body | ConvertFrom-Json
    } finally {
        $Content.Dispose()
        $Client.Dispose()
    }
}

if (-not (Test-Path $Python)) {
    throw "Could not find venv\Scripts\python.exe."
}

Invoke-Step "[1/6] Doctor prerequisites"
if (-not (Test-Path $Doctor)) {
    throw "Could not find doctor.ps1."
}
& powershell -NoProfile -ExecutionPolicy Bypass -File $Doctor
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Invoke-Step "[2/6] Backend unit tests"
& $Python -m unittest discover -s tests -p "test_*.py"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Invoke-Step "[3/6] Frontend syntax"
& node --check static\js\app.js
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Invoke-Step "[4/6] Backend health, setup status, and qwen defaults"
$ServerRunning = $false
try {
    $Health = Invoke-RestMethod -UseBasicParsing "$BaseUrl/health" -TimeoutSec 3
    Assert-True ($Health.status -eq "ok") "Unexpected health response."
    $ServerRunning = $true
    Write-Host "Health: ok"
} catch {
    Write-Host "Server is not running; start run_demo.bat for live endpoint checks."
}

if (-not $ServerRunning) {
    Write-Host "Skipped live endpoint checks."
    exit 0
}

$Setup = Invoke-RestMethod -UseBasicParsing "$BaseUrl/api/setup/status" -TimeoutSec 15
Assert-True ($Setup.recommended_model -eq "qwen2.5:7b") "Setup status did not recommend qwen2.5:7b."
Assert-True ($null -ne $Setup.ready) "Setup status did not include readiness."
Write-Host "Setup ready: $($Setup.ready); message: $($Setup.status_message)"

$Models = Invoke-RestMethod -UseBasicParsing "$BaseUrl/api/models" -TimeoutSec 15
Assert-True ($Models.defaults.interviewer -eq "qwen2.5:7b") "Interviewer default is not qwen2.5:7b."
Assert-True ($Models.defaults.evaluator -eq "qwen2.5:7b") "Evaluator default is not qwen2.5:7b."
Assert-True ($Models.defaults.fallback -eq "qwen2.5:7b") "Fallback default is not qwen2.5:7b."
Assert-True ($Models.interviewer_model -eq "qwen2.5:7b") "Interviewer model is not qwen2.5:7b."
Assert-True ($Models.evaluator_model -eq "qwen2.5:7b") "Evaluator model is not qwen2.5:7b."
Write-Host "Model defaults: qwen2.5:7b only"

Invoke-Step "[5/6] Resume parse compatibility alias"
$ResumePath = Join-Path $env:TEMP "ai-coach-smoke-resume.txt"
Set-Content -LiteralPath $ResumePath -Value "Demo Candidate`nProduct Manager`nActivation analytics launch" -Encoding UTF8
try {
    $ParseResult = Invoke-FileUpload "$BaseUrl/api/parse-resume" $ResumePath
    Assert-True ($ParseResult.text -like "*Product Manager*") "Parse-resume did not return expected text."
    $AliasResult = Invoke-FileUpload "$BaseUrl/api/upload-resume" $ResumePath
    Assert-True ($AliasResult.text -like "*Activation analytics*") "Upload-resume alias did not return expected text."
    Write-Host "Resume parse endpoints: ok"
} finally {
    Remove-Item -LiteralPath $ResumePath -ErrorAction SilentlyContinue
}

Invoke-Step "[6/6] V3 sample session save and reload"
$SmokeId = "smoke-v3-demo-cert"
$Scores = @{
    responsiveness = 90
    depth = 88
    clarity = 84
    communication_style = 86
}
$Competencies = @{
    answer_relevance = 90
    specificity = 86
    structure = 84
    evidence_quality = 88
    impact_orientation = 90
    role_alignment = 89
    communication_clarity = 84
    adaptability = 86
}
$Payload = @{
    id = $SmokeId
    date = (Get-Date).ToUniversalTime().ToString("o")
    target_role = "Smoke Demo Certification"
    module = "general"
    duration_seconds = 90
    messages = @(
        @{ role = "assistant"; content = "Tell me about a product launch you led."; timestamp = 1000 },
        @{ role = "user"; content = "I led an activation analytics launch and improved onboarding conversion from 42% to 61%."; timestamp = 7000 }
    )
    feedback = @{
        evaluation_version = "v3_readiness_scorecard"
        overall_score = 87
        grade = @{ grade = "A"; label = "Demo-ready"; color = "#4ade80"; score = 87 }
        interview_scores = $Scores
        competency_scores = $Competencies
        module_scores = @{}
        pillars = @{
            interview = @{
                score = 87
                weight = 1
                scores = $Scores
                competency_scores = $Competencies
                module_scores = @{}
            }
        }
        readiness = @{
            level = "interview_ready"
            hire_signal = "yes"
            summary = "Smoke session confirms V3 report data can be saved and reloaded."
            blockers = @()
            strongest_signals = @("Evidence-backed answer", "Clear impact metric")
        }
        weakest_area = "brevity"
        strongest_area = "measurable impact"
        improvement_tip = "Lead with the metric."
        coaching_summary = "Demo certification sample."
        actionable_next_steps = @("Practice one concise STAR answer.")
        risk_flags = @()
        red_flags = @()
        practice_plan = @("Repeat the launch story in 90 seconds.")
        question_evaluations = @(
            @{
                question = "Tell me about a product launch you led."
                answer_summary = "Described an activation analytics launch with measurable conversion lift."
                answer_type = "complete"
                score = 90
                competency_scores = $Competencies
                evidence_quotes = @("improved onboarding conversion from 42% to 61%")
                missed_opportunity = "Add one tradeoff."
                coaching_note = "Strong quantified answer."
                practice_drill = "Compress to 60 seconds."
            }
        )
        question_highlights = @(
            @{
                question = "Tell me about a product launch you led."
                answer_summary = "Described an activation analytics launch with measurable conversion lift."
                assessment = "Strong quantified answer."
                evidence_quote = "improved onboarding conversion from 42% to 61%"
                score = 90
            }
        )
        transcript_features = @{
            question_count = 1
            answer_count = 1
            missing_answer_count = 0
            timeout_count = 0
            avg_word_count = 12
        }
        evaluator_confidence = 92
    }
}

$Json = $Payload | ConvertTo-Json -Depth 20
Invoke-RestMethod -UseBasicParsing "$BaseUrl/api/sessions" -Method Post -ContentType "application/json" -Body $Json -TimeoutSec 10 | Out-Null
$Sessions = Invoke-RestMethod -UseBasicParsing "$BaseUrl/api/sessions" -TimeoutSec 10
$Found = @($Sessions.sessions | Where-Object { $_.id -eq $SmokeId })
Assert-True ($Found.Count -eq 1) "Smoke session was not returned by /api/sessions."
Assert-True ($Found[0].feedback.evaluation_version -eq "v3_readiness_scorecard") "Reloaded session did not preserve V3 feedback."
Assert-True ($Found[0].feedback.readiness.level -eq "interview_ready") "Reloaded session did not preserve readiness."
Invoke-RestMethod -UseBasicParsing "$BaseUrl/api/sessions/$SmokeId" -Method Delete -TimeoutSec 10 | Out-Null
Write-Host "V3 sample session save/reload: ok"

Write-Host ""
Write-Host "Smoke checks completed."
