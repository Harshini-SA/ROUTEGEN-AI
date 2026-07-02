import logging
from typing import Dict, Any, List
import json
from app.core.router import router
from app.core.classifier import ComplexityScore

logger = logging.getLogger("routegen.fallback")

class FallbackManager:
    """
    Manages assertions and auto-escalation (fallback) to higher tiers 
    when the output quality is insufficient.
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
        Execute the prompt and automatically fallback if assertions fail.
        """
        current_tier = complexity.tier
        fallback_occurred = False
        original_tier = current_tier
        fallback_reason = None
        
        while current_tier:
            logger.info(f"Dispatching to tier: {current_tier}")
            result = await router.dispatch(prompt, complexity, tier_override=current_tier)
            
            if not result["success"]:
                # API Error -> fallback
                fallback_reason = f"API Error: {result['error']}"
                pass_assertions = False
            else:
                pass_assertions = self._run_assertions(result["content"], assertions)
                if not pass_assertions:
                    fallback_reason = "DSPy Assertion Failed"
            
            if pass_assertions and result["success"]:
                result["fallback_triggered"] = fallback_occurred
                result["fallback_from_tier"] = original_tier if fallback_occurred else None
                result["fallback_reason"] = fallback_reason if fallback_occurred else None
                return result
                
            # If we reach here, it failed. Try to escalate.
            logger.warning(f"Tier {current_tier} failed ({fallback_reason}). Attempting escalation.")
            fallback_occurred = True
            
            next_tier = self.tier_progression.get(current_tier)
            if not next_tier:
                logger.error(f"Cannot escalate beyond {current_tier}. Returning failed response.")
                result["fallback_triggered"] = fallback_occurred
                result["fallback_from_tier"] = original_tier
                result["fallback_reason"] = fallback_reason
                result["success"] = False # Mark as overall failure since all tiers failed
                return result
                
            current_tier = next_tier

        return {}

fallback_manager = FallbackManager()
