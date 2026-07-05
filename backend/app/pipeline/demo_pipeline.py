import uuid
import time
from typing import TypedDict, Dict, Any, List, Optional
from langgraph.graph import StateGraph, END
from app.core.classifier import classifier, ComplexityScore
from app.core.cache import semantic_cache
from app.core.fallback import fallback_manager
from app.core.router import SYSTEM_PROMPT, GREETING_SYSTEM_PROMPT


# Tight greeting list — narrower than the classifier's INSTANT_SMALL (which also
# covers simple factual openers like "what is"). These short-circuit the entire
# 5-node research pipeline so "hello" can never become a 5-paragraph essay.
GREETING_WORDS = [
    "hello", "hi", "hey", "hiya", "yo", "thanks", "thank you", "thx",
    "ok", "okay", "cool", "great", "nice", "sure", "bye", "goodbye",
    "good morning", "good afternoon", "good evening", "good night",
    "how are you", "what's up", "whats up", "sup",
]


_GREETING_DISQUALIFIERS = (
    "prove", "solve", "calculate", "explain", "write", "analyze", "design",
    "proof", "help me", "how do", "how to", "what is", "why", "code",
)


def is_greeting(query: str) -> bool:
    """
    True when the raw query is *just* a social greeting/acknowledgement — not a
    real request that merely opens with one (e.g. "hey, can you prove X?").
    """
    ql = query.lower().strip().rstrip("!.?,")
    # A greeting followed by a substantive ask is NOT a greeting.
    if len(ql.split()) > 4 or any(d in ql for d in _GREETING_DISQUALIFIERS):
        return False
    # Word-boundary match so "hi" never matches "history" and "hey" never "heyday".
    return any(ql == w or ql.startswith(w + " ") for w in GREETING_WORDS)


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
    total_joules: float
    total_gco2e: float
    routing_logs: List[Dict[str, Any]]
    baseline_model: str  # Optional flag for comparison
    rag_used: bool
    rag_chunk_count: int
    rag_sources: List[str]
    locked_complexity: Optional[ComplexityScore]  # Tier decision made once at query_parsing, reused by every node
    predicted_tier: Optional[str]
    detected_domain: Optional[str]
    domain_shift: Optional[float]
    base_score: Optional[float]
    adjusted_score: Optional[float]


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
            
            in_tok = res.usage.prompt_tokens if hasattr(res, "usage") and res.usage else 0
            out_tok = res.usage.completion_tokens if hasattr(res, "usage") and res.usage else 0
            from app.core.energy import calculate_usage_energy
            energy_joules, energy_gco2e = calculate_usage_energy(baseline_model, in_tok, out_tok)
            
            _logger.info(f"✅ BASELINE OK | Model={baseline_model} | Node={node_name}")
        except Exception as e:
            _logger.error(f"❌ BASELINE FAIL | Model={baseline_model} | Node={node_name} | {type(e).__name__}: {str(e)[:200]}")
            response_content = f"Error: {str(e)}"
            cost = 0.0
            energy_joules = 0.0
            energy_gco2e = 0.0
            in_tok = 0
            out_tok = 0

        latency = (time.time() - start_time) * 1000
        log_entry = {
            "node_id": node_name,
            "model_used": baseline_model,
            "tier_selected": "baseline",
            "complexity_score": 0,
            "latency_ms": latency,
            "cost_usd": cost,
            "energy_joules": energy_joules,
            "energy_gco2e": energy_gco2e,
            "input_tokens": in_tok,
            "output_tokens": out_tok,
            "fallback_triggered": False,
            "cache_hit": False
        }
        return {
            "content": response_content,
            "log_entry": log_entry,
            "cost": cost,
            "energy_joules": energy_joules,
            "energy_gco2e": energy_gco2e
        }

    # --- Normal Routed Path ---

    # 1. Classification — decided ONCE per pipeline run (at query_parsing) and reused by every
    # subsequent node. Nodes must NOT reclassify their own internally-generated meta-prompt text
    # (e.g. "Analyze this evidence deeply...") — that text's wording/length has nothing to do with
    # the original user query's actual complexity, and re-scoring it causes the tier to drift
    # (usually upward) as the pipeline progresses, regardless of how simple the user's question was.
    locked_complexity = state.get("locked_complexity")
    if locked_complexity is not None:
        complexity = locked_complexity
    elif state.get("predicted_tier"):
        # Trust pre-predicted tier, skip classifier
        from app.core.classifier import ComplexityScore
        score_map = {"small": 2.5, "large": 6.0, "reasoning": 9.0}
        tier = state["predicted_tier"]
        score = score_map.get(tier, 2.5)
        complexity = ComplexityScore(
            score=score,
            tier=tier,
            reason="Pre-predicted while typing",
            confidence=1.0,
            method="pre-predicted"
        )
        import logging
        logging.getLogger("routegen.pipeline").info(f"Using predicted tier: {tier} (skipped classifier)")
    else:
        complexity = classifier.score_prompt_in_context(state["query"], conversation_history)

        # RAG queries require more synthesis — bump complexity so they land on a more capable tier
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
        "classification_reason": getattr(complexity, "reason", ""),
        "classification_confidence": getattr(complexity, "confidence", 0.0),
        "classification_method": getattr(complexity, "method", "keyword_fallback"),
        "latency_ms": latency,
        "cost_usd": 0.0 if cache_hit else result.get("cost_usd", 0.0),
        "energy_joules": 0.0 if cache_hit else result.get("energy_joules", 0.0),
        "energy_gco2e": 0.0 if cache_hit else result.get("energy_gco2e", 0.0),
        "input_tokens": 0 if cache_hit else result.get("input_tokens", 0),
        "output_tokens": 0 if cache_hit else result.get("output_tokens", 0),
        "fallback_triggered": False if cache_hit else result.get("fallback_triggered", False),
        "tier_escalated": False if cache_hit else result.get("tier_escalated", False),
        "primary_model": None if cache_hit else result.get("primary_model"),
        "fallback_model": None if cache_hit else result.get("fallback_model"),
        "fallback_reason": None if cache_hit else result.get("fallback_reason"),
        "cache_hit": cache_hit,
        "rag_used": state.get("rag_used", False),
        "rag_chunk_count": state.get("rag_chunk_count", 0),
        "rag_sources": state.get("rag_sources", []),
        "detected_domain": state.get("detected_domain"),
        "domain_shift": state.get("domain_shift"),
        "base_score": state.get("base_score"),
        "adjusted_score": state.get("adjusted_score")
    }

    if cache_hit:
        log_entry["similarity"] = cache_similarity

    return {
        "content": response_content,
        "log_entry": log_entry,
        "cost": log_entry["cost_usd"],
        "energy_joules": log_entry["energy_joules"],
        "energy_gco2e": log_entry["energy_gco2e"],
        "complexity": complexity
    }


async def node_query_parsing(state: PipelineState):
    history_preamble = _build_context_preamble(state.get("conversation_history", []))
    prompt = f"{history_preamble}Parse this query into search intents: {state['query']}"
    res = await base_node(state, "query_parsing", prompt, [{"type": "min_length", "value": 5}])
    return {
        "nodes_executed": state["nodes_executed"] + ["query_parsing"],
        "routing_logs": state["routing_logs"] + [res["log_entry"]],
        "total_cost": state.get("total_cost", 0.0) + res.get("cost", 0.0),
        "total_joules": state.get("total_joules", 0.0) + res.get("energy_joules", 0.0),
        "total_gco2e": state.get("total_gco2e", 0.0) + res.get("energy_gco2e", 0.0),
        # Absent on baseline runs (base_node's baseline branch skips classification entirely) — fine,
        # since baseline nodes never consult locked_complexity for routing either.
        "locked_complexity": res.get("complexity")
    }


async def node_web_search_summarisation(state: PipelineState):
    history_preamble = _build_context_preamble(state.get("conversation_history", []))
    prompt = f"{history_preamble}Summarize information regarding: {state['query']}"
    res = await base_node(state, "web_search_summarisation", prompt)
    return {
        "context": res["content"],
        "nodes_executed": state["nodes_executed"] + ["web_search_summarisation"],
        "routing_logs": state["routing_logs"] + [res["log_entry"]],
        "total_cost": state.get("total_cost", 0.0) + res.get("cost", 0.0),
        "total_joules": state.get("total_joules", 0.0) + res.get("energy_joules", 0.0),
        "total_gco2e": state.get("total_gco2e", 0.0) + res.get("energy_gco2e", 0.0)
    }


async def node_evidence_analysis(state: PipelineState):
    history_preamble = _build_context_preamble(state.get("conversation_history", []))
    prompt = f"{history_preamble}Analyze this evidence deeply and find themes: {state.get('context', '')}"
    res = await base_node(state, "evidence_analysis", prompt)
    return {
        "analysis": res["content"],
        "nodes_executed": state["nodes_executed"] + ["evidence_analysis"],
        "routing_logs": state["routing_logs"] + [res["log_entry"]],
        "total_cost": state.get("total_cost", 0.0) + res.get("cost", 0.0),
        "total_joules": state.get("total_joules", 0.0) + res.get("energy_joules", 0.0),
        "total_gco2e": state.get("total_gco2e", 0.0) + res.get("energy_gco2e", 0.0)
    }


async def node_contradiction_detection(state: PipelineState):
    history_preamble = _build_context_preamble(state.get("conversation_history", []))
    prompt = f"{history_preamble}Critically evaluate the analysis for contradictions. If any found, explain them. Analysis: {state.get('analysis', '')}"
    # No "no_contradiction" assertion here: this node's entire job is to discuss contradictions,
    # so its own output legitimately contains that word almost every time (even when reporting
    # "no contradictions found"). Asserting on that substring was tripping on itself and force-
    # escalating to a pricier tier on nearly every run.
    res = await base_node(state, "contradiction_detection", prompt)
    return {
        "contradictions": res["content"],
        "nodes_executed": state["nodes_executed"] + ["contradiction_detection"],
        "routing_logs": state["routing_logs"] + [res["log_entry"]],
        "total_cost": state.get("total_cost", 0.0) + res.get("cost", 0.0),
        "total_joules": state.get("total_joules", 0.0) + res.get("energy_joules", 0.0),
        "total_gco2e": state.get("total_gco2e", 0.0) + res.get("energy_gco2e", 0.0)
    }


async def node_final_formatting(state: PipelineState):
    history_preamble = _build_context_preamble(state.get("conversation_history", []))
    prompt = f"{history_preamble}Synthesize a clear, helpful, and conversational response to the user's query: '{state['query']}'. Use this analysis: {state.get('analysis', '')} and these contradictions/evaluations: {state.get('contradictions', '')}. Format with markdown."
    res = await base_node(state, "final_formatting", prompt)
    return {
        "final_report": res["content"],
        "nodes_executed": state["nodes_executed"] + ["final_formatting"],
        "routing_logs": state["routing_logs"] + [res["log_entry"]],
        "total_cost": state.get("total_cost", 0.0) + res.get("cost", 0.0),
        "total_joules": state.get("total_joules", 0.0) + res.get("energy_joules", 0.0),
        "total_gco2e": state.get("total_gco2e", 0.0) + res.get("energy_gco2e", 0.0)
    }


async def node_greeting(state: PipelineState):
    """
    Fast path for greetings: ONE cheap Small-tier call with a greeting-only system
    prompt, then straight to END — skipping search / analysis / contradiction /
    formatting. This is what actually prevents "hello" from becoming an essay.
    """
    import litellm
    import logging
    from app.config import settings
    from app.core.energy import calculate_usage_energy

    _logger = logging.getLogger("routegen.greeting")
    start_time = time.time()

    # Baseline compare runs greet with their forced model too; otherwise Small tier.
    baseline_model = state.get("baseline_model")
    if baseline_model and not isinstance(baseline_model, bool):
        model_id = baseline_model
    else:
        model_id = settings.get_models_for_tier("small")[0]

    _logger.info(f"👋 GREETING fast-path | Model={model_id} | Query={state['query']!r}")

    content = "Hey! 👋 How can I help you today?"  # safe fallback if the call errors
    cost = energy_joules = energy_gco2e = 0.0
    try:
        kwargs = {}
        if "cerebras" in model_id.lower():
            kwargs["api_base"] = "https://api.cerebras.ai/v1"
        res = await litellm.acompletion(
            model=model_id,
            messages=[
                {"role": "system", "content": GREETING_SYSTEM_PROMPT},
                {"role": "user", "content": state["query"]},
            ],
            temperature=0.3,
            **kwargs,
        )
        content = res.choices[0].message.content
        cost = litellm.completion_cost(completion_response=res) or 0.0
        in_tok = res.usage.prompt_tokens if getattr(res, "usage", None) else 0
        out_tok = res.usage.completion_tokens if getattr(res, "usage", None) else 0
        energy_joules, energy_gco2e = calculate_usage_energy(model_id, in_tok, out_tok)
    except Exception as e:
        _logger.warning(f"Greeting call failed ({type(e).__name__}: {e}); using canned reply")

    latency = (time.time() - start_time) * 1000
    # Logged under query_parsing so the visualizer's summary bar (tier/score/model/cost)
    # and Node 1 detail populate; nodes 2-5 simply have no trace entry.
    log_entry = {
        "node_id": "query_parsing",
        "model_used": model_id,
        "tier_selected": "baseline" if baseline_model else "small",
        "complexity_score": 1.0,
        "classification_reason": "Greeting — fast path (research pipeline skipped)",
        "classification_confidence": 0.99,
        "classification_method": "greeting_shortcut",
        "latency_ms": latency,
        "cost_usd": cost,
        "energy_joules": energy_joules,
        "energy_gco2e": energy_gco2e,
        "fallback_triggered": False,
        "cache_hit": False,
        "rag_used": False,
        "rag_chunk_count": 0,
        "rag_sources": [],
    }
    return {
        "final_report": content,
        "context": content,
        "analysis": "",
        "contradictions": "",
        "nodes_executed": ["greeting"],
        "routing_logs": [log_entry],
        "total_cost": state.get("total_cost", 0.0) + cost,
        "total_joules": state.get("total_joules", 0.0) + energy_joules,
        "total_gco2e": state.get("total_gco2e", 0.0) + energy_gco2e,
    }


def _route_entry(state: PipelineState) -> str:
    """Send greetings down the fast path; everything else into the full pipeline."""
    return "greeting" if is_greeting(state["query"]) else "query_parsing"


# Build graph
workflow = StateGraph(PipelineState)

workflow.add_node("greeting", node_greeting)
workflow.add_node("query_parsing", node_query_parsing)
workflow.add_node("web_search_summarisation", node_web_search_summarisation)
workflow.add_node("evidence_analysis", node_evidence_analysis)
workflow.add_node("contradiction_detection", node_contradiction_detection)
workflow.add_node("final_formatting", node_final_formatting)

# Conditional entry: greeting fast-path vs. full research pipeline.
workflow.set_conditional_entry_point(
    _route_entry,
    {"greeting": "greeting", "query_parsing": "query_parsing"},
)
workflow.add_edge("greeting", END)
workflow.add_edge("query_parsing", "web_search_summarisation")
workflow.add_edge("web_search_summarisation", "evidence_analysis")
workflow.add_edge("evidence_analysis", "contradiction_detection")
workflow.add_edge("contradiction_detection", "final_formatting")
workflow.add_edge("final_formatting", END)

demo_pipeline = workflow.compile()
