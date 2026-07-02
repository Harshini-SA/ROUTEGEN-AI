import time
import logging
from typing import Dict, Any, Optional, List
from litellm import acompletion
from app.config import settings
from app.core.classifier import ComplexityScore

logger = logging.getLogger("routegen.router")

# ── Shared System Prompt ────────────────────────────────────────────────────
# Applied to ALL LLM calls (routed + baseline) for consistent output quality.
SYSTEM_PROMPT = (
    "You are a helpful, direct AI assistant. "
    "Answer the user's question naturally and conversationally. "
    "Do not narrate your reasoning process, do not use section headers describing what you're about to do, "
    "and do not pad your answer with meta-commentary. Get to the point. "
    "Use bullets, bold, or headers only when they genuinely help clarity for lists, comparisons, "
    "or multi-step instructions — not for simple conversational answers. "
    "Match response length to the complexity of the question."
)


class DynamicRouter:
    """
    Routes the prompt to the appropriate LLM model based on complexity score.
    """
    def __init__(self):
        pass
        
    async def dispatch(self, prompt: str, complexity: ComplexityScore, tier_override: Optional[str] = None) -> Dict[str, Any]:
        """
        Dispatch the prompt to the appropriate model.
        Returns the response text, usage, cost, and latency.
        """
        target_tier = tier_override if tier_override else complexity.tier
        
        # Get models for tier
        models = settings.get_models_for_tier(target_tier)
        if not models:
            raise ValueError(f"No models configured for tier: {target_tier}")
            
        model_id = models[0]  # Try the first model in the tier
        
        # ── Debug Logging ───────────────────────────────────────────────
        provider = model_id.split("/")[0] if "/" in model_id else "unknown"
        logger.info(f"🚀 DISPATCH | Tier={target_tier} | Model={model_id} | Provider={provider}")
        
        start_time = time.time()
        
        try:
            response = await acompletion(
                model=model_id,
                messages=[
                    {"role": "system", "content": SYSTEM_PROMPT},
                    {"role": "user", "content": prompt}
                ],
                temperature=0.0
            )
            
            latency = (time.time() - start_time) * 1000  # ms
            
            content = response.choices[0].message.content
            usage = response.usage
            
            logger.info(
                f"✅ SUCCESS | Model={model_id} | Provider={provider} | "
                f"Latency={latency:.0f}ms | "
                f"Tokens(in={usage.prompt_tokens if usage else '?'}, out={usage.completion_tokens if usage else '?'})"
            )
            
            # Tier-based cost estimate (hardcoded for demo stability)
            estimated_cost = 0.0
            if target_tier == "small":
                estimated_cost = 0.0003
            elif target_tier == "large":
                estimated_cost = 0.015
            else:
                estimated_cost = 0.04
                
            return {
                "success": True,
                "content": content,
                "model_used": model_id,
                "tier_selected": target_tier,
                "latency_ms": latency,
                "input_tokens": usage.prompt_tokens if usage else 0,
                "output_tokens": usage.completion_tokens if usage else 0,
                "cost_usd": estimated_cost,
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
                "error": str(e)
            }

router = DynamicRouter()
