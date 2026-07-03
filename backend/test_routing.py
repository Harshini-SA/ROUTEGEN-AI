import asyncio
import os
from dotenv import load_dotenv

# Load env before importing app modules
load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

from app.core.classifier import classifier
from app.core.router import router

async def run_tests():
    prompts_with_scores = [
        ("What is the capital of France?", 2.0),  # Target: small
        ("Write a marketing strategy for a SaaS product", 6.0),  # Target: large
        ("Prove that √2 is irrational using proof by contradiction, showing all steps", 9.0)  # Target: reasoning
    ]
    
    for p, target_score in prompts_with_scores:
        print("\n" + "="*80)
        print(f"Prompt: {p}")
        complexity = classifier.score_prompt(p)
        # Override score to test the tiers
        complexity.score = target_score
        from app.config import settings
        complexity.tier = settings.get_tier_for_score(target_score)

        print(f"Complexity Score: {complexity.score} -> Target Tier: {complexity.tier}")
        
        from app.core.fallback import fallback_manager
        result = await fallback_manager.execute_with_fallback(p, complexity)
        
        if result.get("success"):
            print(f"Actual Tier Used: {result['tier_selected']}")
            print(f"Model Used: {result['model_used']}")
            print(f"Cost: ${result['cost_usd']:.6f}")
            print(f"Response snippet: {result['content'][:100]}...")
        else:
            print(f"Failed: {result['error']}")

if __name__ == "__main__":
    # Configure basic logging to see the observability JSON output
    import logging
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    asyncio.run(run_tests())
