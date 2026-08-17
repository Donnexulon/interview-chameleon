import os
import requests
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

# Setup paths for static files and templates
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")
TEMPLATES_DIR = os.path.join(BASE_DIR, "templates")

# Ensure directories exist
os.makedirs(STATIC_DIR, exist_ok=True)
os.makedirs(os.path.join(STATIC_DIR, "css"), exist_ok=True)
os.makedirs(os.path.join(STATIC_DIR, "js"), exist_ok=True)
os.makedirs(TEMPLATES_DIR, exist_ok=True)


@asynccontextmanager
async def lifespan(app):
    """Modern lifespan handler — runs startup/shutdown logic."""
    # ── Startup: clean up stale TTS audio files from previous sessions
    audio_dir = os.path.join(STATIC_DIR, "audio")
    if os.path.isdir(audio_dir):
        count = 0
        for fname in os.listdir(audio_dir):
            if fname.startswith("tts_") and fname.endswith(".mp3"):
                try:
                    os.remove(os.path.join(audio_dir, fname))
                    count += 1
                except OSError:
                    pass
        if count:
            print(f"Cleaned up {count} stale TTS audio file(s).")
    yield
    # ── Shutdown: nothing needed for now


app = FastAPI(title="Interview Chameleon API", version="1.0.0", lifespan=lifespan)

# Mount static files
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# Templates setup
templates = Jinja2Templates(directory=TEMPLATES_DIR)

@app.get("/")
async def root(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})

@app.get("/health")
async def health_check():
    return {"status": "ok"}

# --- API Endpoints ---
from services.ollama_client import OllamaClient, MODEL_DEFAULTS
from services.resume_parser import ResumeParser
from services.session_history import SessionHistory
from services.question_bank import QuestionBank
from services.stt_service import STTService
from services.tts_service import TTSService
from services.evaluation import (
    build_evaluation_fallback,
    build_evaluation_prompt,
    build_evaluation_repair_prompt,
    build_transcript_analysis,
    merge_scores,
    parse_evaluation_response,
)
from services.import_export import ImportExport
from pydantic import BaseModel
from typing import Optional, List
from fastapi.responses import StreamingResponse
from fastapi import UploadFile, File, Form, HTTPException
import json

ollama_client = OllamaClient()
history_db = SessionHistory()
question_db = QuestionBank()
stt_service = STTService()

def model_available_in_list(model_name: str, available_models: list[str]) -> bool:
    """Match Ollama model names with or without a tag suffix."""
    return any(
        model == model_name
        or model == f"{model_name}:latest"
        or model.startswith(f"{model_name}:")
        for model in available_models
    )


# ─── Setup & Model Endpoints ───────────────────────────────────────

@app.get("/api/models")
async def get_models():
    """Return available models and recommended defaults."""
    available = ollama_client.list_models()
    return {
        "available": available,
        "defaults": MODEL_DEFAULTS,
        "interviewer_model": ollama_client.get_best_model("interviewer"),
        "evaluator_model": ollama_client.get_best_model("evaluator"),
        "interviewer_ready": model_available_in_list(MODEL_DEFAULTS["interviewer"], available),
        "evaluator_ready": model_available_in_list(MODEL_DEFAULTS["evaluator"], available),
    }

@app.get("/api/setup/status")
async def setup_status():
    """Check if Ollama is running and required models are available."""
    connected = ollama_client.check_connection()
    available = ollama_client.list_models() if connected else []
    recommended = MODEL_DEFAULTS["interviewer"]
    has_recommended = model_available_in_list(recommended, available) if connected else False
    has_any = len(available) > 0
    ready = connected and has_recommended
    if ready:
        status_message = f"Ready. {recommended} is installed and Ollama is reachable."
    elif connected:
        status_message = f"Ollama is running, but {recommended} is not installed."
    else:
        status_message = "Ollama is not reachable. Start Ollama locally, then refresh status."
    return {
        "ollama_connected": connected,
        "models_available": available,
        "recommended_model": recommended,
        "has_recommended": has_recommended,
        "has_any_model": has_any,
        "ready": ready,
        "status_message": status_message,
    }

@app.post("/api/setup/pull")
async def pull_model(request: Request):
    """Pull a model from Ollama with SSE progress streaming."""
    model_name = MODEL_DEFAULTS["interviewer"]

    def stream_progress():
        for progress in ollama_client.pull_model_stream(model_name):
            yield f"data: {json.dumps(progress)}\n\n"
        yield f"data: {json.dumps({'status': 'complete', 'percent': 100})}\n\n"

    return StreamingResponse(
        stream_progress(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )



@app.post("/api/upload-resume")
@app.post("/api/parse-resume")
async def parse_resume(file: UploadFile = File(...)):
    """Parse text from uploaded resume"""
    if file.filename.endswith('.pdf'):
        text = await ResumeParser.parse_pdf(file)
    elif file.filename.endswith('.docx'):
        text = await ResumeParser.parse_docx(file)
    else:
        text = await ResumeParser.parse_txt(file)
    return {"text": text}

class ChatRequest(BaseModel):
    model: str
    messages: list
    system_prompt: str = None

class MinigameCoachRequest(BaseModel):
    game: str
    payload: dict = {}

@app.post("/api/chat")
async def chat(request: ChatRequest):
    """Stream chat from Ollama"""
    return StreamingResponse(
        ollama_client.generate_chat_stream(
            MODEL_DEFAULTS["interviewer"],
            request.messages,
            request.system_prompt,
        ),
        media_type="text/event-stream"
    )

@app.post("/api/minigames/coach")
async def minigame_coach(request: MinigameCoachRequest):
    """Return optional structured coaching for minigames using only qwen2.5:7b."""
    game = request.game.lower().strip()
    if game not in {"star", "blitz", "salary"}:
        raise HTTPException(status_code=400, detail="Unsupported minigame")

    model = MODEL_DEFAULTS["evaluator"]
    if not ollama_client.check_connection() or not ollama_client.is_model_available(model):
        return {
            "available": False,
            "model": model,
            "coaching": None,
            "error": f"Local AI coaching requires Ollama with {model} installed.",
        }

    system_prompt = (
        "You are a strict but practical interview coach. Return JSON only. "
        "Do not use markdown. Keep coaching concise and evidence-based. "
        "The only allowed schema is: "
        '{"summary":"string","strengths":["string"],"improvements":["string"],'
        '"rewritten_answer":"string","practice_drill":"string"}. '
        "If a field does not apply, use an empty string or empty list."
    )
    user_payload = {
        "game": game,
        "payload": request.payload,
        "task": (
            "For STAR, evaluate the candidate's STAR answer and provide one stronger rewritten answer. "
            "For Blitz, focus on directness, specificity, and concise practice. "
            "For Salary, focus on strategy, evidence, tone, and a better counter."
        ),
    }
    try:
        raw = await ollama_client.generate_json_async(
            model,
            [{"role": "user", "content": json.dumps(user_payload)}],
            system_prompt,
        )
        try:
            coaching = json.loads(raw)
        except json.JSONDecodeError:
            start = raw.find("{")
            end = raw.rfind("}")
            coaching = json.loads(raw[start:end + 1]) if start != -1 and end != -1 and end > start else {}
        if not isinstance(coaching, dict):
            coaching = {}
        return {
            "available": True,
            "model": model,
            "coaching": {
                "summary": str(coaching.get("summary", "")),
                "strengths": coaching.get("strengths", []) if isinstance(coaching.get("strengths", []), list) else [],
                "improvements": coaching.get("improvements", []) if isinstance(coaching.get("improvements", []), list) else [],
                "rewritten_answer": str(coaching.get("rewritten_answer", "")),
                "practice_drill": str(coaching.get("practice_drill", "")),
            },
        }
    except Exception as e:
        return {
            "available": False,
            "model": model,
            "coaching": None,
            "error": str(e),
        }

@app.get("/api/sessions")
async def get_sessions():
    return {"sessions": history_db.get_all_sessions()}

class SessionData(BaseModel):
    id: str
    date: str
    target_role: str
    module: str = "general"
    duration_seconds: int
    messages: list
    feedback: dict = None

@app.post("/api/sessions")
async def save_session(session: SessionData):
    history_db.save_session(session.model_dump())
    return {"status": "success"}

@app.delete("/api/sessions")
async def clear_all_sessions():
    history_db.clear_all_sessions()
    return {"status": "success"}

@app.delete("/api/sessions/{session_id}")
async def delete_session(session_id: str):
    """Delete a single session by ID."""
    history_db.delete_session(session_id)
    return {"status": "success"}


# ─── Data Import / Export ───────────────────────────────────────

@app.get("/api/export")
async def export_data():
    """Export all sessions and questions as a downloadable JSON file."""
    sessions = history_db.get_all_sessions()
    questions = question_db.get_questions()
    json_str = ImportExport.export_data(sessions, questions)
    return StreamingResponse(
        iter([json_str]),
        media_type="application/json",
        headers={"Content-Disposition": "attachment; filename=interview_chameleon_backup.json"}
    )

@app.post("/api/import")
async def import_data(file: UploadFile = File(...)):
    """Import sessions and questions from a previously exported JSON file."""
    content = await file.read()
    try:
        parsed = ImportExport.parse_import_data(content.decode("utf-8"))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    imported_sessions = 0
    imported_questions = 0
    for session in parsed.get("sessions", []):
        try:
            history_db.save_session(session)
            imported_sessions += 1
        except Exception:
            pass  # Skip malformed sessions
    for question in parsed.get("questions", []):
        try:
            question_db.add_question(question)
            imported_questions += 1
        except Exception:
            pass  # Skip duplicates or malformed questions
    return {
        "status": "success",
        "imported_sessions": imported_sessions,
        "imported_questions": imported_questions
    }

class EvaluateRequest(BaseModel):
    model: str
    target_role: str
    module: str = "general"
    job_description: str = ""
    messages: list
    presence_data: Optional[dict] = None
    engagement_data: Optional[dict] = None
    camera_on: bool = True

@app.post("/api/evaluate")
async def evaluate_session(request: EvaluateRequest):
    """Enhanced evaluation: LLM analysis + body language + engagement metrics.
    
    Returns a merged three-pillar evaluation with:
    - Interview performance (scored by LLM)
    - Professional presence (from MediaPipe body language data)
    - Session engagement (from client-side analytics)
    """
    transcript_analysis = build_transcript_analysis(request.messages)

    # Build module-specific evaluation prompt
    system_prompt = build_evaluation_prompt(
        target_role=request.target_role,
        module=request.module,
        job_description=request.job_description,
        presence_data=request.presence_data,
        transcript_features=transcript_analysis["features"],
    )
    
    # Send the chat transcript for LLM evaluation
    evaluation_messages = [
        {
            "role": "user",
            "content": (
                "Evaluate these paired interview turns. Evidence quotes must be copied exactly "
                "from the answer field in the same pair.\n\n"
                f"{json.dumps(transcript_analysis, indent=2)}"
            )
        }
    ]
    
    # Use the configured local evaluator model.
    eval_model = MODEL_DEFAULTS["evaluator"]
    feedback_str = await ollama_client.generate_json_async(eval_model, evaluation_messages, system_prompt)

    try:
        interview_feedback = parse_evaluation_response(
            feedback_str,
            transcript_pairs=transcript_analysis["pairs"],
            transcript_features=transcript_analysis["features"],
        )
    except Exception as first_error:
        print(f"Failed to validate evaluation JSON: {str(first_error)[:500]}")
        repair_prompt = build_evaluation_repair_prompt(request.module)
        repair_messages = [{
            "role": "user",
            "content": (
                "Repair this invalid evaluation output into valid JSON matching the required schema only.\n\n"
                f"Validation error:\n{first_error}\n\n"
                f"Valid paired transcript and deterministic features:\n{json.dumps(transcript_analysis, indent=2)}\n\n"
                f"Invalid output:\n{feedback_str}"
            )
        }]
        repaired_str = await ollama_client.generate_json_async(eval_model, repair_messages, repair_prompt)
        try:
            interview_feedback = parse_evaluation_response(
                repaired_str,
                transcript_pairs=transcript_analysis["pairs"],
                transcript_features=transcript_analysis["features"],
            )
        except Exception as repair_error:
            print(f"Failed to repair evaluation JSON: {str(repair_error)[:500]}")
            interview_feedback = build_evaluation_fallback(
                error_detail=f"Initial validation failed: {first_error}; repair failed: {repair_error}",
                messages=request.messages,
            )
    
    # Merge all three pillars into final score
    merged = merge_scores(
        interview_feedback=interview_feedback,
        presence_data=request.presence_data,
        engagement_data=request.engagement_data,
        camera_on=request.camera_on
    )
    
    return {"feedback": merged}


@app.get("/api/questions")
async def get_questions(category: str = None):
    return {"questions": question_db.get_questions(category)}

class QuestionData(BaseModel):
    id: str
    category: str
    text: str
    difficulty: str = "medium"
    tags: list = []
    answer: str = ""

@app.post("/api/questions")
async def add_question(question: QuestionData):
    question_db.add_question(question.model_dump())
    return {"status": "success"}

@app.put("/api/questions/{question_id}")
async def update_question(question_id: str, question: QuestionData):
    success = question_db.update_question(question_id, question.model_dump())
    if not success:
        raise HTTPException(status_code=404, detail="Question not found")
    return {"status": "success"}

@app.delete("/api/questions/{question_id}")
async def delete_question(question_id: str):
    success = question_db.delete_question(question_id)
    if not success:
        raise HTTPException(status_code=404, detail="Question not found")
    return {"status": "success"}

@app.post("/api/generate-question")
async def generate_question_endpoint(request: Request):
    """Use LLM to generate a new interview question."""
    body = await request.json() if request.headers.get("content-type") == "application/json" else {}
    category = body.get("category", "Technical")
    difficulty = body.get("difficulty", "Medium")
    topic = body.get("topic", "")

    topic_instruction = ""
    if topic:
        topic_instruction = (
            f' The question MUST be specifically about "{topic}". '
            f'The content, context, and focus of the question must directly relate to "{topic}". '
            f'Set "tags" to ["{topic}"].'
        )

    system_prompt = (
        "You are an expert interview coach. Generate a single unique interview question. "
        "Return ONLY valid JSON with these exact keys: "
        '"text" (the interview question, 1-2 sentences), '
        f'"category" (MUST be "{category}"), '
        f'"difficulty" (MUST be "{difficulty}"), '
        '"tags" (an array with exactly one short tag describing the topic), '
        '"answer" (a concise preparation tip, 1-2 sentences). '
        "Make questions creative, practical, and different from common ones."
        + topic_instruction
    )
    user_message = (
        f"Generate a {difficulty} {category} interview question"
        + (f' about "{topic}"' if topic else "")
        + ". Return JSON only, nothing else."
    )

    try:
        raw = await ollama_client.generate_json_async(
            model=MODEL_DEFAULTS["interviewer"],
            messages=[{"role": "user", "content": user_message}],
            system_prompt=system_prompt
        )
        result = json.loads(raw)
        if "error" in result:
            raise HTTPException(status_code=502, detail=result["error"])
        return {
            "text": result.get("text", ""),
            "category": result.get("category", category),
            "difficulty": result.get("difficulty", difficulty),
            "tags": result.get("tags", ["General"]),
            "answer": result.get("answer", "")
        }
    except HTTPException:
        raise
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="LLM returned invalid JSON")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/stt")
async def stt_endpoint(file: UploadFile = File(...)):
    import tempfile
    import os
    with tempfile.NamedTemporaryFile(delete=False, suffix=".webm") as temp_audio:
        content = await file.read()
        temp_audio.write(content)
        temp_audio_path = temp_audio.name
        
    try:
        text = await stt_service.transcribe_audio(temp_audio_path)
        return {"text": text}
    finally:
        if os.path.exists(temp_audio_path):
            try:
                os.remove(temp_audio_path)
            except OSError:
                pass

class TTSRequest(BaseModel):
    text: str
    gender: str = "female"
    
@app.post("/api/tts")
async def tts_endpoint(request: TTSRequest):
    audio_filename = await TTSService.generate_audio(request.text, request.gender)
    return {"audio_url": f"/static/audio/{audio_filename}"}


class IdealAnswerRequest(BaseModel):
    model: str
    question: str
    user_answer: str = ""
    role: str = "General Candidate"
    module: str = "general"

@app.post("/api/ideal-answer")
async def ideal_answer(request: IdealAnswerRequest):
    """Generate a benchmark ideal answer for a given interview question."""
    module_context = {
        "general":   "behavioral / general interview",
        "roleplay":  "roleplay & behavioral interview",
        "visual":    "visual & whiteboard interview",
        "technical": "technical assessment interview",
        "casestudy": "case study & strategy interview",
        "salary":    "salary negotiation scenario",
    }.get(request.module, "interview")

    system_prompt = (
        f"You are an expert interview coach. "
        f"The candidate is applying for: {request.role}. "
        f"This is a {module_context}. "
        "Your task: write a concise, high-quality model answer (3–6 sentences) for the given interview question. "
        "Use the STAR method (Situation, Task, Action, Result) where applicable. "
        "Be specific, confident, and professional. Do NOT include coaching commentary — "
        "return ONLY the model answer as if you were the candidate speaking. "
        "Do not use markdown, headers, or bullet points."
    )
    messages = [{"role": "user", "content": f"Interview question: {request.question}"}]
    try:
        result = await ollama_client.generate_chat(
            MODEL_DEFAULTS["interviewer"],
            messages,
            system_prompt,
        )
        return {"ideal_answer": result.get("content", "Could not generate ideal answer.")}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



class PortfolioRequest(BaseModel):
    model: str
    portfolio_url: str
    target_role: str = "Software Engineer"

@app.post("/api/portfolio-fetch")
async def portfolio_fetch(request: PortfolioRequest):
    """Fetch and extract text content from a portfolio URL. Requires internet access to reach the URL."""
    import asyncio
    from html.parser import HTMLParser

    class TextExtractor(HTMLParser):
        SKIP_TAGS = {'script', 'style', 'head', 'nav', 'footer', 'noscript', 'meta', 'link'}
        def __init__(self):
            super().__init__()
            self.current_tag = None
            self.chunks = []
        def handle_starttag(self, tag, attrs):
            self.current_tag = tag.lower()
        def handle_data(self, data):
            if self.current_tag not in self.SKIP_TAGS:
                text = data.strip()
                if len(text) > 2:
                    self.chunks.append(text)

    try:
        loop = asyncio.get_running_loop()
        response = await loop.run_in_executor(
            None,
            lambda: requests.get(request.portfolio_url, timeout=15, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            })
        )
        response.raise_for_status()
        parser = TextExtractor()
        parser.feed(response.text)
        text = ' '.join(parser.chunks)
        # Trim to ~4000 chars to avoid overwhelming the LLM context
        text = text[:4000] if len(text) > 4000 else text
        if not text.strip():
            raise ValueError("No readable text found on the page.")
        return {"text": text, "url": request.portfolio_url}
    except requests.Timeout:
        raise HTTPException(status_code=408, detail="The portfolio URL took too long to respond.")
    except requests.RequestException as e:
        raise HTTPException(status_code=400, detail=f"Could not fetch URL: {str(e)}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/portfolio-analysis")
async def portfolio_analysis(request: PortfolioRequest):
    """Stream tailored interview questions generated from scraped portfolio content."""
    # First scrape the URL
    import asyncio
    from html.parser import HTMLParser

    class TextExtractor(HTMLParser):
        SKIP_TAGS = {'script', 'style', 'head', 'nav', 'footer', 'noscript', 'meta', 'link'}
        def __init__(self):
            super().__init__()
            self.current_tag = None
            self.chunks = []
        def handle_starttag(self, tag, attrs):
            self.current_tag = tag.lower()
        def handle_data(self, data):
            if self.current_tag not in self.SKIP_TAGS:
                text = data.strip()
                if len(text) > 2:
                    self.chunks.append(text)

    try:
        loop = asyncio.get_running_loop()
        response = await loop.run_in_executor(
            None,
            lambda: requests.get(request.portfolio_url, timeout=15, headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
            })
        )
        response.raise_for_status()
        parser = TextExtractor()
        parser.feed(response.text)
        portfolio_text = ' '.join(parser.chunks)[:4000]
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not fetch portfolio URL: {str(e)}")

    system_prompt = (
        "You are a senior technical interviewer preparing specific questions for a candidate interview. "
        f"The candidate is applying for: {request.target_role}. "
        "You have been given the content of their portfolio/personal website. "
        "Your task: generate exactly 8 insightful, specific interview questions that directly reference "
        "things you found in their portfolio — their actual projects, technologies, experiences, and skills. "
        "Do NOT ask generic interview questions. Every question must be grounded in something specific from their portfolio. "
        "Format each question on its own line, numbered 1-8. "
        "After each question, add a short (1-sentence) NOTE: explaining what portfolio detail it references. "
        "Example format:\n"
        "1. You mentioned [specific project] — can you walk me through the biggest technical challenge you faced?\n"
        "NOTE: Referenced from their [project name] project section.\n\n"
        "Be direct, curious, and challenging."
    )
    messages = [{"role": "user", "content": f"Portfolio content:\n{portfolio_text}"}]

    return StreamingResponse(
        ollama_client.generate_chat_stream(
            MODEL_DEFAULTS["interviewer"],
            messages,
            system_prompt,
        ),
        media_type="text/event-stream"
    )
