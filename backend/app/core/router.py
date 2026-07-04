import time
import logging
from typing import Dict, Any, Optional, List
import litellm
from litellm import acompletion
from app.config import settings
from app.core.classifier import ComplexityScore
from app.core.energy import get_optimal_model_for_tier, calculate_usage_energy

logger = logging.getLogger("routegen.router")

# Per-model request timeout. Kept short so a stalled/rate-limited provider fails
# fast into FallbackManager's next-model attempt instead of blocking the whole run.
REQUEST_TIMEOUT_SECONDS = 15

# ── Shared System Prompt ────────────────────────────────────────────────────
# Applied to ALL LLM calls (routed + baseline) for consistent output quality.
SYSTEM_PROMPT = (
    "You are a helpful, direct AI assistant. "
    "Answer the user's question naturally and conversationally. "
    "Do not narrate your reasoning process, do not use section headers describing what you're about to do, "
    "and do not pad your answer with meta-commentary. Get to the point. "
    "Use bullets, bold, or headers only when they genuinely help clarity for lists, comparisons, "
    "or multi-step instructions — not for simple conversational answers.\n\n"
    "RESPONSE LENGTH RULES — STRICTLY FOLLOW:\n"
    "- Greetings (hi, hello, hey, thanks, ok): Reply in 1-2 sentences MAX. Be warm and friendly, "
    "and ask how you can help. Example: 'Hey! 👋 How can I help you today?'\n"
    "- Simple factual questions (capital of France, basic definitions): Answer in 1-3 sentences. "
    "Direct and clear.\n"
    "- Medium questions (explanations, writing tasks): Use a structured response with headers and "
    "bullets where helpful. 3-5 paragraphs max.\n"
    "- Complex questions (proofs, legal analysis, calculations): Full detailed response with all steps "
    "shown. Use math formatting where needed.\n\n"
    "NEVER write long essays for simple greetings. NEVER add sections like 'Addressing Contradictions' "
    "or 'Cultural Analysis' for a simple 'hello'. Match your response length to what the user actually needs."
)

# Applied ONLY to greetings, which short-circuit the 5-node research pipeline entirely.
GREETING_SYSTEM_PROMPT = (
    "You are a friendly AI assistant. The user said a greeting. "
    "Reply warmly in 1-2 sentences and ask how you can help them today. "
    "Do not write essays. Do not analyze the word. Just greet back naturally."
)


class DynamicRouter:
    """
    Routes the prompt to the appropriate LLM model based on complexity score.
    """
    def __init__(self):
        pass
        
    async def dispatch(self, prompt: str, complexity: ComplexityScore, tier_override: Optional[str] = None, model_override: Optional[str] = None) -> Dict[str, Any]:
        """
        Dispatch the prompt to the appropriate model.
        Returns the response text, usage, cost, and latency.
        """
        target_tier = tier_override if tier_override else complexity.tier
        
        if model_override:
            model_id = model_override
        else:
            # Get models for tier
            models = settings.get_models_for_tier(target_tier)
            if not models:
                raise ValueError(f"No models configured for tier: {target_tier}")
                
            model_id = get_optimal_model_for_tier(models)
        
        # ── Debug Logging ───────────────────────────────────────────────
        provider = model_id.split("/")[0] if "/" in model_id else "unknown"
        logger.info(f"🚀 DISPATCH | Tier={target_tier} | Model={model_id} | Provider={provider}")
        
        start_time = time.time()
        
        try:
            kwargs = {}
            if "cerebras" in model_id.lower():
                kwargs["api_base"] = "https://api.cerebras.ai/v1"

            # Fail fast instead of eating litellm's default 55-60s retry backoff on a
            # rate-limited model (esp. Cerebras). We have our OWN cross-model fallback in
            # FallbackManager, so a quick failure here immediately tries the next model
            # (e.g. reasoning tier: cerebras -> groq/llama-3.3-70b) rather than stalling.
            response = await acompletion(
                model=model_id,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.0,
                timeout=REQUEST_TIMEOUT_SECONDS,
                num_retries=0,
                **kwargs
            )
            
            latency = (time.time() - start_time) * 1000  # ms
            
            content = response.choices[0].message.content
            usage = response.usage
            
            logger.info(
                f"✅ SUCCESS | Model={model_id} | Provider={provider} | "
                f"Latency={latency:.0f}ms | "
                f"Tokens(in={usage.prompt_tokens if usage else '?'}, out={usage.completion_tokens if usage else '?'})"
            )
            
            # Real per-token cost from litellm's model pricing map (covers every model this
            # app actually dispatches to — Groq, Gemini, Cerebras). Falls back to a rough
            # flat-rate-per-tier estimate only if litellm has no pricing data for a model
            # (e.g. a brand-new model id not yet in its cost map).
            try:
                estimated_cost = litellm.completion_cost(completion_response=response) or 0.0
            except Exception as cost_err:
                logger.warning(f"completion_cost failed for {model_id} ({cost_err}); using flat-rate fallback.")
                fallback_rates = {"small": 0.0003, "large": 0.015, "reasoning": 0.04}
                estimated_cost = fallback_rates.get(target_tier, 0.0)

            # Calculate energy usage based on tokens
            in_tok = usage.prompt_tokens if usage else 0
            out_tok = usage.completion_tokens if usage else 0
            energy_joules, energy_gco2e = calculate_usage_energy(model_id, in_tok, out_tok)
            
            # Requested Observability Log Format
            logger.info(f'{{ "router_decision": "{target_tier}", "reasoning_score": {complexity.score}, "exact_cost_usd": {estimated_cost:.6f}, "energy_joules": {energy_joules:.4f} }}')
                
            return {
                "success": True,
                "content": content,
                "model_used": model_id,
                "tier_selected": target_tier,
                "latency_ms": latency,
                "input_tokens": in_tok,
                "output_tokens": out_tok,
                "cost_usd": estimated_cost,
                "energy_joules": energy_joules,
                "energy_gco2e": energy_gco2e,
                "error": None
            }
            
        except Exception as e:
            latency = (time.time() - start_time) * 1000
            logger.error(
                f"❌ FAILED | Model={model_id} | Provider={provider} | "
                f"Latency={latency:.0f}ms | Error={type(e).__name__}: {str(e)[:200]}"
            )
            return {
                "success": False,
                "content": "",
                "model_used": model_id,
                "tier_selected": target_tier,
                "latency_ms": latency,
                "input_tokens": 0,
                "output_tokens": 0,
                "cost_usd": 0.0,
                "energy_joules": 0.0,
                "energy_gco2e": 0.0,
                "error": str(e),
                "error_type": type(e).__name__
            }

router = DynamicRouter()
