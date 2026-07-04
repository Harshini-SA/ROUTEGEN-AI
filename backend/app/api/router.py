import os
import uuid
import tempfile
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends, UploadFile, File, Form
from pydantic import BaseModel
from app.core.classifier import classifier
from app.core.fallback import fallback_manager
from app.pipeline.demo_pipeline import demo_pipeline
from app.core.cache import semantic_cache
from app.core.session_store import session_store
from app.core.rag_store import rag_store
from app.core.file_processor import extract_text
from app.api.auth import get_current_user

router = APIRouter()

SUPPORTED_UPLOAD_TYPES = {"pdf", "pptx", "jpg", "jpeg", "png"}


def _build_rag_context(sid: str, query: str) -> Dict[str, Any]:
    """Retrieve relevant chunks for a session (if any docs were uploaded) and
    build the CONTEXT-augmented prompt to feed the pipeline."""
    if not rag_store.has_session_docs(sid):
        return {"prompt": query, "used": False, "chunk_count": 0, "sources": []}

    retrieved = rag_store.retrieve_context(sid, query, top_k=3)
    if not retrieved:
        return {"prompt": query, "used": False, "chunk_count": 0, "sources": []}

    sources = list(dict.fromkeys(c["filename"] for c in retrieved))
    context_block = "\n\n".join(c["text"] for c in retrieved)
    augmented_prompt = (
        "CONTEXT FROM USER'S UPLOADED DOCUMENTS:\n"
        f"{context_block}\n\n"
        f"USER QUESTION: {query}\n\n"
        "Answer the user's question using the context above. If the context doesn't contain the answer, say so clearly."
    )
    return {"prompt": augmented_prompt, "used": True, "chunk_count": len(retrieved), "sources": sources}

class RouteRequest(BaseModel):
    prompt: str
    assertions: List[Dict[str, Any]] = None

@router.post("/route", tags=["Routing"])
async def route_prompt(request: RouteRequest):
    """Score a prompt and route it through the fallback manager."""
    complexity = classifier.score_prompt(request.prompt)
    result = await fallback_manager.execute_with_fallback(request.prompt, complexity, request.assertions)
    
    return {
        "complexity": complexity.dict(),
        "result": result
    }

class PipelineRequest(BaseModel):
    query: str
    compare: bool = False
    session_id: Optional[str] = None

@router.post("/pipeline/run", tags=["Pipeline"])
async def run_pipeline(request: PipelineRequest, user_id: str = Depends(get_current_user)):
    """Run the 5-node demo pipeline with conversation memory."""
    
    # 1. Session management — get existing or create new
    session = session_store.get_or_create(user_id, request.session_id)
    sid = session.session_id
    
    # 2. Append the user's message to session history
    session_store.append_message(user_id, sid, "user", request.query)
    
    # 3. Get trimmed conversation history (last 10 messages for token control)
    conversation_history = session_store.get_recent_history(user_id, sid, n=10)

    # 4. RAG — retrieve relevant chunks from any documents uploaded to this session
    rag = _build_rag_context(sid, request.query)

    initial_state = {
        "session_id": sid,
        "query": rag["prompt"],
        "conversation_history": conversation_history,
        "context": "",
        "analysis": "",
        "contradictions": "",
        "final_report": "",
        "nodes_executed": [],
        "total_cost": 0.0,
        "routing_logs": [],
        "rag_used": rag["used"],
        "rag_chunk_count": rag["chunk_count"],
        "rag_sources": rag["sources"]
    }

    if request.compare:
        import asyncio
        import litellm
        import json

        baseline_state = {
            "session_id": sid + "_base",
            "query": rag["prompt"],
            "conversation_history": conversation_history,
            "context": "",
            "analysis": "",
            "contradictions": "",
            "final_report": "",
            "nodes_executed": [],
            "total_cost": 0.0,
            "routing_logs": [],
            "baseline_model": True,
            "rag_used": rag["used"],
            "rag_chunk_count": rag["chunk_count"],
            "rag_sources": rag["sources"]
        }
        
        # Run LangGraph pipeline concurrently
        final_state, final_base_state = await asyncio.gather(
            demo_pipeline.ainvoke(initial_state),
            demo_pipeline.ainvoke(baseline_state)
        )
        
        judge_prompt = f"""You are an expert evaluator. 
Query: {request.query}
Output A (Routed AI): {final_state.get('final_report')}
Output B (Baseline AI): {final_base_state.get('final_report')}
Score Output A and Output B from 1-10 on correctness, completeness, and clarity.
Return ONLY valid JSON: {{"score_a": 8, "score_b": 7, "reason": "..."}}"""
        try:
            judge_res = await litellm.acompletion(
                model="groq/llama-3.3-70b-versatile",
                messages=[{"role": "user", "content": judge_prompt}],
                response_format={"type": "json_object"}
            )
            judge_score = json.loads(judge_res.choices[0].message.content)
        except Exception as e:
            judge_score = {"score_a": 0, "score_b": 0, "reason": f"Failed to judge: {str(e)}"}
            
        # Broadcast routed logs
        for log in final_state["routing_logs"]:
            await broadcast_log(log)
        
        # 4. Append assistant response to session history
        assistant_response = final_state.get("final_report", "")
        session_store.append_message(user_id, sid, "assistant", assistant_response)
            
        return {
            "session_id": sid,
            "final_report": assistant_response,
            "total_cost": final_state.get("total_cost"),
            "logs": final_state.get("routing_logs"),
            "baseline_report": final_base_state.get("final_report"),
            "baseline_cost": final_base_state.get("total_cost"),
            "judge_score": judge_score
        }
    else:
        # Run standard LangGraph pipeline
        final_state = await demo_pipeline.ainvoke(initial_state)
        
        # Broadcast logs via websocket
        for log in final_state["routing_logs"]:
            await broadcast_log(log)
        
        # 4. Append assistant response to session history
        assistant_response = final_state.get("final_report", "")
        session_store.append_message(user_id, sid, "assistant", assistant_response)
        
        return {
            "session_id": sid,
            "final_report": assistant_response,
            "total_cost": final_state.get("total_cost"),
            "logs": final_state.get("routing_logs")
        }


class CompareRequest(BaseModel):
    prompt: str
    session_id: Optional[str] = None

# Forced single-model baseline for the quality-vs-cost dashboard: "what if we always
# used the premium model" regardless of the prompt's actual complexity.
BASELINE_MODEL = "cerebras/gpt-oss-120b"
JUDGE_MODEL = "groq/llama-3.1-8b-instant"


def _empty_scores() -> Dict[str, float]:
    return {"correctness": 0, "completeness": 0, "clarity": 0, "overall": 0}


@router.post("/compare", tags=["Compare"])
async def compare_prompt(request: CompareRequest, user_id: str = Depends(get_current_user)):
    """
    Quality-vs-cost tradeoff dashboard (hackathon requirement): run the same prompt through
    the routed pipeline (Run A) and a forced single-premium-model baseline (Run B), score both
    with an LLM judge, and compute cost savings / accuracy delta.
    """
    import asyncio
    import time
    import litellm
    import json

    sid = request.session_id or ("compare_" + str(uuid.uuid4())[:8])

    def _fresh_state(session_id: str, baseline_model: Optional[str] = None) -> Dict[str, Any]:
        state = {
            "session_id": session_id,
            "query": request.prompt,
            "conversation_history": [],
            "context": "",
            "analysis": "",
            "contradictions": "",
            "final_report": "",
            "nodes_executed": [],
            "total_cost": 0.0,
            "routing_logs": [],
            "rag_used": False,
            "rag_chunk_count": 0,
            "rag_sources": []
        }
        if baseline_model:
            state["baseline_model"] = baseline_model
        return state

    async def _timed_run(state: Dict[str, Any]):
        start = time.time()
        final = await demo_pipeline.ainvoke(state)
        return final, (time.time() - start) * 1000

    # Run A (routed) and Run B (forced baseline) concurrently, each individually timed.
    (routed_state, routed_latency_ms), (baseline_state, baseline_latency_ms) = await asyncio.gather(
        _timed_run(_fresh_state(sid)),
        _timed_run(_fresh_state(sid + "_baseline", baseline_model=BASELINE_MODEL))
    )

    routed_response = routed_state.get("final_report", "")
    baseline_response = baseline_state.get("final_report", "")

    # Every node in the routed run is locked to the same tier/model (classification runs
    # once, at query_parsing — see demo_pipeline.py), so the last log entry is representative.
    routed_logs = routed_state.get("routing_logs", [])
    routed_last_log = routed_logs[-1] if routed_logs else {}
    routed_model = routed_last_log.get("model_used", "unknown")
    routed_tier = routed_last_log.get("tier_selected", "unknown")
    routed_cost = routed_state.get("total_cost", 0.0)
    baseline_cost = baseline_state.get("total_cost", 0.0)

    # --- LLM-as-judge scoring ---
    judge_prompt = f"""You are evaluating two AI responses to the same question.
Question: {request.prompt}
Response A: {routed_response}
Response B: {baseline_response}

Score each response on these criteria (1-10 each):
- correctness: is the information accurate?
- completeness: does it fully answer the question?
- clarity: is it well written and easy to understand?

Return ONLY valid JSON, no extra text:
{{"routed": {{"correctness": X, "completeness": X, "clarity": X, "overall": X}}, "baseline": {{"correctness": X, "completeness": X, "clarity": X, "overall": X}}}}"""

    accuracy_scoring_available = True
    try:
        judge_res = await litellm.acompletion(
            model=JUDGE_MODEL,
            messages=[{"role": "user", "content": judge_prompt}],
            response_format={"type": "json_object"}
        )
        judge_json = json.loads(judge_res.choices[0].message.content)
        routed_scores = judge_json["routed"]
        baseline_scores = judge_json["baseline"]
    except Exception:
        accuracy_scoring_available = False
        routed_scores = _empty_scores()
        baseline_scores = _empty_scores()

    # --- Metrics (S = C_baseline - Σ(C_node_i); ΔA computed as routed - baseline so
    # positive always means "routed is better", per the API contract below) ---
    cost_savings_usd = baseline_cost - routed_cost
    cost_savings_pct = (cost_savings_usd / baseline_cost * 100) if baseline_cost > 0 else 0.0
    accuracy_delta = routed_scores.get("overall", 0) - baseline_scores.get("overall", 0)
    quality_maintained = accuracy_delta >= -1.0

    verdict = (
        f"Saved {cost_savings_pct:.0f}% cost with {accuracy_delta:+.1f} quality delta"
        if accuracy_scoring_available
        else f"Saved {cost_savings_pct:.0f}% cost (quality scoring unavailable)"
    )

    return {
        "prompt": request.prompt,
        "routed": {
            "model": routed_model,
            "tier": routed_tier,
            "cost": routed_cost,
            "latency_ms": routed_latency_ms,
            "response": routed_response,
            "scores": routed_scores,
            "trace": routed_logs
        },
        "baseline": {
            "model": BASELINE_MODEL,
            "cost": baseline_cost,
            "latency_ms": baseline_latency_ms,
            "response": baseline_response,
            "scores": baseline_scores,
            "trace": baseline_state.get("routing_logs", [])
        },
        "savings": {
            "cost_savings_usd": cost_savings_usd,
            "cost_savings_pct": cost_savings_pct,
            "accuracy_delta": accuracy_delta,
            "quality_maintained": quality_maintained,
            "accuracy_scoring_available": accuracy_scoring_available
        },
        "verdict": verdict
    }


# --- Session Management Endpoints ---

@router.get("/sessions", tags=["Sessions"])
async def list_sessions(user_id: str = Depends(get_current_user)):
    """List all conversation sessions (most recent first)."""
    return session_store.list_sessions(user_id)

@router.get("/sessions/{session_id}", tags=["Sessions"])
async def get_session(session_id: str, user_id: str = Depends(get_current_user)):
    """Get full message history for a session."""
    session = session_store.get_session(user_id, session_id)
    if not session:
        return {"error": "Session not found"}
    return session


# --- RAG Document Upload Endpoints ---

@router.post("/upload", tags=["RAG"])
async def upload_file(
    file: UploadFile = File(...),
    session_id: str = Form(...),
    user_id: str = Depends(get_current_user)
):
    """Upload a PDF/PPTX/image, extract its text, and index it for RAG retrieval scoped to session_id."""
    ext = os.path.splitext(file.filename or "")[1].lstrip(".").lower()
    if ext not in SUPPORTED_UPLOAD_TYPES:
        return {"status": "error", "message": f"Unsupported file type: .{ext or 'unknown'}"}

    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=f".{ext}") as tmp:
            tmp.write(await file.read())
            tmp_path = tmp.name

        text = await extract_text(tmp_path, ext)
        if not text.strip():
            return {"status": "error", "message": "Could not extract any text from this file."}

        chunks_added = rag_store.add_document(session_id, text, file.filename)
        return {"status": "ok", "filename": file.filename, "chunks_added": chunks_added}
    except Exception as e:
        return {"status": "error", "message": str(e)}
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)


@router.get("/documents/{session_id}", tags=["RAG"])
async def list_documents(session_id: str, user_id: str = Depends(get_current_user)):
    """List uploaded document filenames indexed for a session."""
    return {"filenames": rag_store.list_documents(session_id)}


@router.delete("/documents/{session_id}", tags=["RAG"])
async def clear_documents(session_id: str, user_id: str = Depends(get_current_user)):
    """Remove all uploaded documents indexed for a session."""
    rag_store.clear_session(session_id)
    return {"status": "ok"}


@router.get("/dashboard/metrics", tags=["Dashboard"])
async def get_metrics():
    """Return aggregated metrics for the dashboard (Mocked for demo)."""
    return {
        "total_savings_pct": 79.5,
        "baseline_cost": 0.312,
        "routegen_cost": 0.066,
        "total_runs": 15,
        "quality_retention": 98.2,
        "co2_saved_grams": 45.3
    }

@router.get("/cache/stats", tags=["Cache"])
async def get_cache_stats():
    """Return semantic cache statistics (Mocked for demo)."""
    return {
        "hit_rate_pct": 25.0,
        "queries_served_zero_cost": 12,
        "total_savings_usd": 0.15
    }

# --- WebSocket for Live Logs ---
class ConnectionManager:
    def __init__(self):
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.remove(websocket)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            try:
                await connection.send_json(message)
            except Exception:
                pass

manager = ConnectionManager()

@router.websocket("/ws/live")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            # Keep connection alive
            data = await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)

async def broadcast_log(log_entry: dict):
    """Called by pipeline runner to broadcast logs to dashboard."""
    await manager.broadcast(log_entry)
