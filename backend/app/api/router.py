import uuid
from typing import Dict, Any, List, Optional
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Depends
from pydantic import BaseModel
from app.core.classifier import classifier
from app.core.fallback import fallback_manager
from app.pipeline.demo_pipeline import demo_pipeline
from app.core.cache import semantic_cache
from app.core.session_store import session_store
from app.api.auth import get_current_user

router = APIRouter()

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
    
    initial_state = {
        "session_id": sid,
        "query": request.query,
        "conversation_history": conversation_history,
        "context": "",
        "analysis": "",
        "contradictions": "",
        "final_report": "",
        "nodes_executed": [],
        "total_cost": 0.0,
        "routing_logs": []
    }
    
    if request.compare:
        import asyncio
        import litellm
        import json
        
        baseline_state = {
            "session_id": sid + "_base",
            "query": request.query,
            "conversation_history": conversation_history,
            "context": "",
            "analysis": "",
            "contradictions": "",
            "final_report": "",
            "nodes_executed": [],
            "total_cost": 0.0,
            "routing_logs": [],
            "baseline_model": True
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

@router.post("/compare", tags=["Compare"])
async def compare_prompt(request: CompareRequest):
    """Run a prompt through both the routed pipeline and the baseline pipeline side-by-side."""
    import asyncio
    import litellm
    import json
    
    sid = "test_eval_" + str(uuid.uuid4())[:8]
    
    initial_state = {
        "session_id": sid,
        "query": request.prompt,
        "conversation_history": [],
        "context": "",
        "analysis": "",
        "contradictions": "",
        "final_report": "",
        "nodes_executed": [],
        "total_cost": 0.0,
        "routing_logs": []
    }
    
    baseline_state = {
        **initial_state,
        "session_id": sid + "_base",
        "baseline_model": True
    }
    
    # Run both pipelines
    final_state, final_base_state = await asyncio.gather(
        demo_pipeline.ainvoke(initial_state),
        demo_pipeline.ainvoke(baseline_state)
    )
    
    # Judge Evaluation
    judge_prompt = f"""You are an expert evaluator. 
Query: {request.prompt}
Output A (Routed AI): {final_state.get('final_report')}
Output B (Baseline AI): {final_base_state.get('final_report')}
Score Output A and Output B from 1-10 on correctness, completeness, and clarity. Then give an overall score from 1-10.
Return ONLY valid JSON with keys: score_a, score_b, reason.
Example: {{"score_a": 8, "score_b": 7, "reason": "..."}}"""

    try:
        judge_res = await litellm.acompletion(
            model="groq/llama-3.3-70b-versatile",
            messages=[{"role": "user", "content": judge_prompt}],
            response_format={"type": "json_object"}
        )
        judge_score = json.loads(judge_res.choices[0].message.content)
    except Exception as e:
        judge_score = {"score_a": 0, "score_b": 0, "reason": f"Failed to judge: {str(e)}"}
        
    routed_cost = final_state.get("total_cost", 0.0)
    baseline_cost = final_base_state.get("total_cost", 0.0)
    
    cost_savings_usd = max(0.0, baseline_cost - routed_cost)
    cost_savings_pct = (cost_savings_usd / baseline_cost * 100) if baseline_cost > 0 else 0.0
    
    return {
        "prompt": request.prompt,
        "routed_report": final_state.get("final_report"),
        "routed_cost": routed_cost,
        "baseline_report": final_base_state.get("final_report"),
        "baseline_cost": baseline_cost,
        "cost_savings_usd": cost_savings_usd,
        "cost_savings_pct": cost_savings_pct,
        "judge_score": judge_score
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
