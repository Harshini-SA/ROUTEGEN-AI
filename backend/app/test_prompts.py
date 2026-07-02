"""
Test set of prompts spanning easy/medium/hard complexity for repeatable hackathon demonstrations.
These are designed to trigger different routing tiers (Small/Large/Reasoning).
"""

TEST_PROMPTS = [
    # ── EASY (Should route to Small Tier - e.g. Llama 3.1 8B) ────────────────
    {
        "complexity": "easy",
        "expected_tier": "small",
        "prompt": "What is the capital of France?"
    },
    {
        "complexity": "easy",
        "expected_tier": "small",
        "prompt": "Give me a 3-sentence summary of what a black hole is."
    },
    
    # ── MEDIUM (Should route to Large Tier - e.g. Gemini 1.5 Pro) ────────────
    {
        "complexity": "medium",
        "expected_tier": "large",
        "prompt": "Explain the difference between synchronous and asynchronous programming. Please provide a brief code example of each."
    },
    {
        "complexity": "medium",
        "expected_tier": "large",
        "prompt": "What are the primary ethical concerns regarding facial recognition technology in public spaces? List at least 3 points."
    },

    # ── HARD (Should route to Reasoning Tier - e.g. Llama 3.3 70B) ───────────
    {
        "complexity": "hard",
        "expected_tier": "reasoning",
        "prompt": "I need to design a system architecture for a high-frequency trading platform. It needs to handle 100,000 requests per second with sub-millisecond latency. Assuming we are using AWS, what specific services should we use for message brokering, compute, and data storage? Discuss the trade-offs of using Kafka vs Kinesis in this specific scenario, taking into account potential bottlenecks and data loss prevention."
    },
    {
        "complexity": "hard",
        "expected_tier": "reasoning",
        "prompt": "Critically analyze the economic impact of universal basic income (UBI) if implemented in the United States today. Specifically address how it might affect inflation, labor market participation rates, and the housing market, citing historical precedents where applicable."
    },
    {
        "complexity": "easy",
        "expected_tier": "small",
        "prompt": "How many planets are in the solar system?"
    },
    {
        "complexity": "medium",
        "expected_tier": "large",
        "prompt": "Explain the mechanics of a black hole's event horizon and what happens to information that passes it, according to current physics theories."
    }
]

def print_test_plan():
    print("=== RouteGen AI Hackathon Demo Prompts ===")
    for i, test in enumerate(TEST_PROMPTS):
        print(f"\n[{i+1}] {test['complexity'].upper()} (Target: {test['expected_tier'].upper()} tier)")
        print(f"Prompt: {test['prompt']}")

import asyncio
import httpx
import json

async def run_evaluations():
    print("Starting evaluations against /compare...")
    async with httpx.AsyncClient(timeout=120.0) as client:
        for i, test in enumerate(TEST_PROMPTS):
            print(f"\n--- Testing [{i+1}/{len(TEST_PROMPTS)}] ({test['complexity']}) ---")
            print(f"Prompt: {test['prompt']}")
            try:
                response = await client.post("http://localhost:8000/compare", json={"prompt": test["prompt"]})
                response.raise_for_status()
                data = response.json()
                
                print(f"Routed Cost:   ${data.get('routed_cost', 0):.5f}")
                print(f"Baseline Cost: ${data.get('baseline_cost', 0):.5f}")
                print(f"Savings:       ${data.get('cost_savings_usd', 0):.5f} ({data.get('cost_savings_pct', 0):.1f}%)")
                print(f"Judge Score:   Routed: {data.get('judge_score', {}).get('score_a')} | Baseline: {data.get('judge_score', {}).get('score_b')}")
                print(f"Judge Reason:  {data.get('judge_score', {}).get('reason')}")
            except Exception as e:
                print(f"Error during evaluation: {e}")
                
if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "--eval":
        asyncio.run(run_evaluations())
    else:
        print_test_plan()
        print("\nRun with 'python -m app.test_prompts --eval' to execute the comparison script.")
