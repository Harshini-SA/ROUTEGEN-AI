"""
RouteGen AI — Energy & Carbon Modeling

Provides estimated inference energy (Joules) and emissions (gCO2e) per token
derived from published benchmarks for each provider/model size.
"""

from typing import Dict, Tuple

# Structure: { model_id: (joules_per_token, gco2e_per_token, fallback_cost_usd_per_token) }
ENERGY_METRICS = {
    # Groq LPUs are highly efficient for inference
    "groq/llama-3.1-8b-instant": (0.001, 0.0002, 0.0000001),
    "groq/llama-3.3-70b-versatile": (0.005, 0.001, 0.0000007),
    
    # Gemini TPUs
    "gemini/gemini-3.5-flash": (0.003, 0.0005, 0.0000003),
    
    # Cerebras WSE (Large Model)
    "cerebras/gpt-oss-120b": (0.02, 0.005, 0.000002),
    
    # Baseline premium (e.g. GPT-4o standard cluster)
    "openai/gpt-4o": (0.05, 0.015, 0.00001),
}

DEFAULT_METRICS = (0.02, 0.005, 0.000005)

def get_model_metrics(model_id: str) -> Tuple[float, float, float]:
    """Return (joules_per_token, gco2e_per_token, cost_per_token) for a model."""
    for key, metrics in ENERGY_METRICS.items():
        if key in model_id.lower():
            return metrics
    return DEFAULT_METRICS

def get_optimal_model_for_tier(models: list[str]) -> str:
    """
    Joint Optimizer: Selects the model from the list that minimizes
    the objective function: (Cost * Energy).
    """
    if not models:
        return ""
        
    best_model = models[0]
    best_objective = float('inf')
    
    for model_id in models:
        joules, gco2e, cost = get_model_metrics(model_id)
        # Joint objective: Cost × Energy
        # (Lower is better)
        objective = cost * joules
        
        if objective < best_objective:
            best_objective = objective
            best_model = model_id
            
    return best_model

def calculate_usage_energy(model_id: str, input_tokens: int, output_tokens: int) -> Tuple[float, float]:
    """Calculate total Joules and gCO2e for a given inference request."""
    total_tokens = input_tokens + output_tokens
    joules_per_token, gco2e_per_token, _ = get_model_metrics(model_id)
    
    return total_tokens * joules_per_token, total_tokens * gco2e_per_token
