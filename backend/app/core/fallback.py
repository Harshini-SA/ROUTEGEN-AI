import logging
from typing import Dict, Any, List, Optional
import json
from app.core.router import router
from app.core.classifier import ComplexityScore

logger = logging.getLogger("routegen.fallback")

# A response substituted in when every model in every reachable tier failed,
# so the user always gets an answer instead of a raw error.
GRACEFUL_FAILURE_MESSAGE = (
    "I'm having trouble reaching my language models right now. "
    "Please try again in a moment."
)


def _describe_failure(error: Optional[str], error_type: Optional[str]) -> str:
    """Turn a raw exception into a short, human-readable reason for the observability log."""
    error = error or ""
    if "429" in error or error_type == "RateLimitError" or "RESOURCE_EXHAUSTED" in error:
        return "429 RESOURCE_EXHAUSTED"
    if "401" in error or error_type == "AuthenticationError":
        return "401 Unauthorized"
    if "404" in error or error_type == "NotFoundError":
        return "404 Model Not Found"
    if "500" in error or error_type == "InternalServerError":
        return "500 Internal Server Error"
    if error_type in ("Timeout", "APITimeoutError"):
        return "Request Timeout"
    return (error[:80] + "…") if len(error) > 80 else (error or error_type or "Unknown error")


class FallbackManager:
    """
    Manages assertions, intra-tier model fallback, and auto-escalation to a
    higher tier when every model within the current tier fails.
    """
    def __init__(self):
        # Tier progression: small -> large -> reasoning
        self.tier_progression = {
            "small": "large",
            "large": "reasoning",
            "reasoning": None # Cannot escalate beyond reasoning
        }

    def _run_assertions(self, response: str, assertions: List[Dict[str, Any]]) -> bool:
        """
        Run a series of assertions (schema, length, etc.) on the response.
        Returns True if all assertions pass, False otherwise.
        """
        if not assertions:
            return True

        for assertion in assertions:
            type_ = assertion.get("type")
            
            if type_ == "json_schema":
                try:
                    json.loads(response)
                    # For a real implementation, we would validate against the specific JSON schema here
                except json.JSONDecodeError:
                    logger.warning(f"Assertion failed: Expected JSON, got text.")
                    return False
                    
            elif type_ == "min_length":
                min_len = assertion.get("value", 0)
                if len(response.split()) < min_len:
                    logger.warning(f"Assertion failed: Min length {min_len} not met.")
                    return False
                    
            elif type_ == "no_contradiction":
                # Simulated DSPy contradiction assertion
                if "error" in response.lower() or "contradiction" in response.lower() or "not sure" in response.lower():
                    logger.warning(f"Assertion failed: Contradiction or uncertainty detected.")
                    return False

        return True

    async def execute_with_fallback(self, prompt: str, complexity: ComplexityScore, assertions: List[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Execute the prompt. On failure, try every other model configured for the SAME tier
        first (e.g. Gemini -> Groq backup within "large") before escalating to a pricier tier —
        escalation only happens once every model in the current tier has been exhausted.
        """
        current_tier = complexity.tier
        original_tier = current_tier
        fallback_occurred = False
        tier_escalated = False
        fallback_reason = None

        from app.config import settings

        while current_tier:
            models_to_try = settings.get_models_for_tier(current_tier)
            primary_model = models_to_try[0]

            for model_id in models_to_try:
                logger.info(f"Dispatching to tier: {current_tier} (Model: {model_id})")
                result = await router.dispatch(prompt, complexity, tier_override=current_tier, model_override=model_id)

                if not result["success"]:
                    fallback_reason = _describe_failure(result.get("error"), result.get("error_type"))
                    pass_assertions = False
                else:
                    pass_assertions = self._run_assertions(result["content"], assertions)
                    if not pass_assertions:
                        fallback_reason = "DSPy Assertion Failed"

                if pass_assertions and result["success"]:
                    used_fallback_model = fallback_occurred and model_id != primary_model
                    result["fallback_triggered"] = fallback_occurred
                    result["fallback_from_tier"] = original_tier if tier_escalated else None
                    result["tier_escalated"] = tier_escalated
                    result["primary_model"] = primary_model
                    result["fallback_model"] = model_id if used_fallback_model else None
                    result["fallback_reason"] = fallback_reason if fallback_occurred else None

                    log_payload = {
                        "router_decision": current_tier,
                        "primary_model": primary_model,
                        "fallback_model": model_id if used_fallback_model else None,
                        "fallback_reason": fallback_reason if fallback_occurred else None,
                        "exact_cost_usd": result.get("cost_usd", 0.0),
                    }
                    logger.info(json.dumps(log_payload))
                    return result

                # If we reach here, it failed. Try next model in the same tier.
                logger.warning(f"Model {model_id} in tier {current_tier} failed ({fallback_reason}). Trying next model in same tier.")
                fallback_occurred = True

            # Every model in this tier failed — only now escalate to the next tier
            logger.warning(f"All models in tier {current_tier} failed. Escalating to next tier.")
            tier_escalated = True

            next_tier = self.tier_progression.get(current_tier)
            if not next_tier:
                logger.error(f"Cannot escalate beyond {current_tier}. All models across all tiers failed.")
                result["fallback_triggered"] = fallback_occurred
                result["fallback_from_tier"] = original_tier
                result["tier_escalated"] = tier_escalated
                result["primary_model"] = primary_model
                result["fallback_model"] = None
                result["fallback_reason"] = fallback_reason
                result["success"] = False  # Mark as overall failure since all tiers failed
                # Never surface a raw error to the user — always return a usable message.
                result["content"] = GRACEFUL_FAILURE_MESSAGE

                logger.info(json.dumps({
                    "router_decision": current_tier,
                    "primary_model": primary_model,
                    "fallback_model": None,
                    "fallback_reason": f"All tiers exhausted: {fallback_reason}",
                    "exact_cost_usd": 0.0,
                }))
                return result

            current_tier = next_tier

        return {}

fallback_manager = FallbackManager()
