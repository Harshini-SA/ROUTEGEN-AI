import uuid
import time
from typing import TypedDict, Dict, Any, List
from langgraph.graph import StateGraph, END
from app.core.classifier import classifier
from app.core.cache import semantic_cache
from app.core.fallback import fallback_manager
from app.core.router import SYSTEM_PROMPT


def _build_context_preamble(history: List[Dict[str, str]]) -> str:
    """Format conversation history into a preamble string for LLM prompts."""
    if not history:
        return ""
    lines = []
    for msg in history:
        role_label = "User" if msg["role"] == "user" else "Assistant"
        lines.append(f"{role_label}: {msg['content']}")
    return "--- Conversation History ---\n" + "\n".join(lines) + "\n--- End History ---\n\n"


class PipelineState(TypedDict):
    session_id: str
    query: str
    conversation_history: List[Dict[str, str]]
    context: str
    analysis: str
    contradictions: str
    final_report: str
    nodes_executed: List[str]
    total_cost: float
    routing_logs: List[Dict[str, Any]]
    baseline_model: str  # Optional flag for comparison
    rag_used: bool
    rag_chunk_count: int
    rag_sources: List[str]


async def base_node(state: PipelineState, node_name: str, prompt: str, assertions: List[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Base execution logic for a pipeline node."""
    start_time = time.time()

    baseline_model = state.get("baseline_model")
    conversation_history = state.get("conversation_history", [])

    if baseline_model:
        # If baseline_model is a boolean True, dynamically resolve the Large tier model
        if isinstance(baseline_model, bool):
            from app.config import settings
            # Default to the first Large tier model
            baseline_model = settings.get_models_for_tier("large")[0]
            
        # Run straight through a single model, skipping caching, classification, and routing
        import litellm
        import logging
        _logger = logging.getLogger("routegen.baseline")
        _logger.info(f"🔬 BASELINE | Model={baseline_model} | Node={node_name}")
        try:
            res = await litellm.acompletion(
                model=baseline_model,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": prompt}
                ]
            )
            response_content = res.choices[0].message.content
            cost = litellm.completion_cost(completion_response=res) or 0.0
            _logger.info(f"✅ BASELINE OK | Model={baseline_model} | Node={node_name}")
        except Exception as e:
            _logger.error(f"❌ BASELINE FAIL | Model={baseline_model} | Node={node_name} | {type(e).__name__}: {str(e)[:200]}")
            response_content = f"Error: {str(e)}"
            cost = 0.0

        latency = (time.time() - start_time) * 1000
        log_entry = {
            "node_id": node_name,
            "model_used": baseline_model,
            "tier_selected": "baseline",
            "complexity_score": 0,
            "latency_ms": latency,
            "cost_usd": cost,
            "fallback_triggered": False,
            "cache_hit": False
        }
        return {
            "content": response_content,
            "log_entry": log_entry,
            "cost": cost
        }

    # --- Normal Routed Path ---

    # 1. Classification — use context-aware scoring
    complexity = classifier.score_prompt_in_context(prompt, conversation_history)

    # 1b. RAG queries require more synthesis — bump complexity so they land on a more capable tier
    if state.get("rag_used"):
        complexity.score = min(10.0, complexity.score + 1)
        complexity.tier = classifier.tier_for_score(complexity.score)

    # 2. Cache Check (Only for the first node/query parsing usually, or independent full prompts)
    cache_hit = False
    cache_similarity = None
    response_content = ""

    if node_name == "query_parsing":  # Simplification: only cache the initial query
        cached_result = await semantic_cache.check_cache(prompt)
        if cached_result:
            cache_hit = True
            cache_similarity = cached_result["similarity"]
            response_content = cached_result["response"]

    result = None
    if not cache_hit:
        # 3. Execution with Fallback
        result = await fallback_manager.execute_with_fallback(prompt, complexity, assertions)
        response_content = result.get("content", "")

        # Save to cache if successful
        if result.get("success") and node_name == "query_parsing":
            await semantic_cache.save_to_cache(prompt, response_content)

    latency = (time.time() - start_time) * 1000

    # Log generation (would be sent to Langfuse in a real implementation)
    log_entry = {
        "node_id": node_name,
        "model_used": "cache" if cache_hit else result.get("model_used"),
        "tier_selected": "cache" if cache_hit else result.get("tier_selected"),
        "complexity_score": complexity.score,
        "latency_ms": latency,
        "cost_usd": 0.0 if cache_hit else result.get("cost_usd", 0.0),
        "fallback_triggered": False if cache_hit else result.get("fallback_triggered", False),
        "cache_hit": cache_hit,
        "rag_used": state.get("rag_used", False),
        "rag_chunk_count": state.get("rag_chunk_count", 0),
        "rag_sources": state.get("rag_sources", [])
    }

    return {
        "content": response_content,
        "log_entry": log_entry,
        "cost": log_entry["cost_usd"]
    }


async def node_query_parsing(state: PipelineState):
    history_preamble = _build_context_preamble(state.get("conversation_history", []))
    prompt = f"{history_preamble}Parse this query into search intents: {state['query']}"
    res = await base_node(state, "query_parsing", prompt, [{"type": "min_length", "value": 5}])
    return {
        "nodes_executed": state["nodes_executed"] + ["query_parsing"],
        "routing_logs": state["routing_logs"] + [res["log_entry"]],
        "total_cost": state["total_cost"] + res["cost"]
    }


async def node_web_search_summarisation(state: PipelineState):
    history_preamble = _build_context_preamble(state.get("conversation_history", []))
    prompt = f"{history_preamble}Summarize information regarding: {state['query']}"
    res = await base_node(state, "web_search_summarisation", prompt)
    return {
        "context": res["content"],
        "nodes_executed": state["nodes_executed"] + ["web_search_summarisation"],
        "routing_logs": state["routing_logs"] + [res["log_entry"]],
        "total_cost": state["total_cost"] + res["cost"]
    }


async def node_evidence_analysis(state: PipelineState):
    history_preamble = _build_context_preamble(state.get("conversation_history", []))
    prompt = f"{history_preamble}Analyze this evidence deeply and find themes: {state.get('context', '')}"
    res = await base_node(state, "evidence_analysis", prompt)
    return {
        "analysis": res["content"],
        "nodes_executed": state["nodes_executed"] + ["evidence_analysis"],
        "routing_logs": state["routing_logs"] + [res["log_entry"]],
        "total_cost": state["total_cost"] + res["cost"]
    }


async def node_contradiction_detection(state: PipelineState):
    history_preamble = _build_context_preamble(state.get("conversation_history", []))
    prompt = f"{history_preamble}Critically evaluate the analysis for contradictions. If any found, explain them. Analysis: {state.get('analysis', '')}"
    res = await base_node(state, "contradiction_detection", prompt, [{"type": "no_contradiction"}])
    return {
        "contradictions": res["content"],
        "nodes_executed": state["nodes_executed"] + ["contradiction_detection"],
        "routing_logs": state["routing_logs"] + [res["log_entry"]],
        "total_cost": state["total_cost"] + res["cost"]
    }


async def node_final_formatting(state: PipelineState):
    history_preamble = _build_context_preamble(state.get("conversation_history", []))
    prompt = f"{history_preamble}Synthesize a clear, helpful, and conversational response to the user's query: '{state['query']}'. Use this analysis: {state.get('analysis', '')} and these contradictions/evaluations: {state.get('contradictions', '')}. Format with markdown."
    res = await base_node(state, "final_formatting", prompt)
    return {
        "final_report": res["content"],
        "nodes_executed": state["nodes_executed"] + ["final_formatting"],
        "routing_logs": state["routing_logs"] + [res["log_entry"]],
        "total_cost": state["total_cost"] + res["cost"]
    }


# Build graph
workflow = StateGraph(PipelineState)

workflow.add_node("query_parsing", node_query_parsing)
workflow.add_node("web_search_summarisation", node_web_search_summarisation)
workflow.add_node("evidence_analysis", node_evidence_analysis)
workflow.add_node("contradiction_detection", node_contradiction_detection)
workflow.add_node("final_formatting", node_final_formatting)

workflow.set_entry_point("query_parsing")
workflow.add_edge("query_parsing", "web_search_summarisation")
workflow.add_edge("web_search_summarisation", "evidence_analysis")
workflow.add_edge("evidence_analysis", "contradiction_detection")
workflow.add_edge("contradiction_detection", "final_formatting")
workflow.add_edge("final_formatting", END)

demo_pipeline = workflow.compile()
