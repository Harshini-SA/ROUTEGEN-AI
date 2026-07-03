import asyncio
import os
import sys
import traceback
from dotenv import load_dotenv

# Ensure stdout uses UTF-8 to prevent charmap errors on Windows
if sys.stdout.encoding != 'utf-8':
    sys.stdout.reconfigure(encoding='utf-8')

def check_env_vars():
    print("--- Environment Variables Check ---")
    keys_to_check = ["GROQ_API_KEY", "GEMINI_API_KEY", "CEREBRAS_API_KEY"]
    for key in keys_to_check:
        val = os.environ.get(key)
        if val:
            print(f"[OK] {key} is present (length: {len(val)})")
        else:
            print(f"[FAIL] {key} is missing or empty")
    print("-----------------------------------\n")

async def main():
    try:
        print("Starting script...")
        
        # Load environment variables
        env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
        load_dotenv(env_path)
        print(f"Loaded .env file from: {os.path.abspath(env_path)}")
        
        check_env_vars()

        print("Importing modules...")
        from app.core.router import router
        from app.core.classifier import classifier
        print("Imports OK.")
        
        print("Router ready.\n")

        prompts_and_tiers = [
            ("small", "What is the capital of France?"),
            ("large", "Write a marketing strategy for a SaaS product targeting small businesses with positioning, channels, and pricing."),
            ("reasoning", "Prove that the square root of 2 is irrational using proof by contradiction. Show every step.")
        ]

        summary = []

        for target_tier, prompt in prompts_and_tiers:
            print(f"==================================================")
            print(f"Testing Expected Tier: {target_tier.upper()}")
            print(f"Prompt: {prompt}")
            
            print("Scoring prompt...")
            complexity = classifier.score_prompt(prompt)
            print(f"Original classifier tier: {complexity.tier} (score: {complexity.score})")

            print("Dispatching prompt...")
            # Let the classifier decide the tier based on the score!
            result = await router.dispatch(prompt, complexity)
            print("Result received.")

            if result.get("success"):
                actual_tier = result.get("tier_selected")
                model_used = result.get("model_used")
                cost = result.get("cost_usd", 0.0)
                content = result.get("content", "")
                snippet = content[:300] + ("..." if len(content) > 300 else "")
                
                print(f"Actual Tier Used: {actual_tier}")
                print(f"Actual Model Used: {model_used}")
                print(f"Cost: ${cost:.6f}")
                print(f"Response snippet:\n{snippet}\n")
                
                summary.append({
                    "expected_tier": target_tier,
                    "actual_tier": actual_tier,
                    "model_used": model_used,
                    "success": True
                })
            else:
                error_msg = result.get("error", "Unknown error")
                print(f"[FAIL] to get response. Error: {error_msg}\n")
                summary.append({
                    "expected_tier": target_tier,
                    "actual_tier": "N/A",
                    "model_used": result.get("model_used", "N/A"),
                    "success": False
                })

        # Print Summary Table
        print("==================================================")
        print("SUMMARY TABLE")
        print(f"{'Expected Tier':<15} | {'Actual Tier':<15} | {'Model Used':<30} | {'Status'}")
        print("-" * 80)
        for s in summary:
            status = "[OK]" if s["success"] else "[FAILED]"
            print(f"{s['expected_tier']:<15} | {s['actual_tier']:<15} | {s['model_used']:<30} | {status}")
            
    except Exception as e:
        print("\n[CRITICAL ERROR IN SCRIPT]")
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    asyncio.run(main())