from dataclasses import dataclass, field
from typing import Dict

@dataclass
class SessionBudget:
    session_id: str
    budget_limit: float
    total_spent: float = 0.0
    query_count: int = 0
    forced_downgrades: int = 0

class BudgetManager:
    def __init__(self):
        self.sessions: Dict[str, SessionBudget] = {}
    
    def set_budget(self, session_id: str, limit: float) -> None:
        self.sessions[session_id] = SessionBudget(
            session_id=session_id,
            budget_limit=limit
        )
        print(f"[Budget] Set ${limit:.4f} for session {session_id[:8]}")
    
    def get_budget(self, session_id: str):
        return self.sessions.get(session_id)
    
    def check_and_adjust_tier(self, session_id: str, original_tier: str, estimated_cost: float) -> tuple[str, bool, str]:
        """
        Returns: (final_tier, was_downgraded, reason)
        """
        budget = self.sessions.get(session_id)
        
        if not budget:
            # No budget set — no restrictions
            return original_tier, False, ""
        
        remaining = budget.budget_limit - budget.total_spent
        usage_pct = budget.total_spent / budget.budget_limit if budget.budget_limit > 0 else 0
        
        # Budget exhausted completely
        if remaining <= 0:
            return "small", True, "Budget exhausted — forced to cheapest tier"
        
        # Budget critically low (95%+)
        if usage_pct >= 0.95 and original_tier != "small":
            budget.forced_downgrades += 1
            return "small", True, f"Budget {usage_pct:.0%} used — downgraded to Small tier to preserve remaining ${remaining:.4f}"
        
        # Budget getting low (80%+) — downgrade only reasoning tier to large
        if usage_pct >= 0.80 and original_tier == "reasoning":
            budget.forced_downgrades += 1
            return "large", True, f"Budget {usage_pct:.0%} used — downgraded from Reasoning to Large tier to conserve budget"
        
        # Budget healthy — no changes
        return original_tier, False, ""
    
    def record_spend(self, session_id: str, cost: float) -> None:
        budget = self.sessions.get(session_id)
        if budget:
            budget.total_spent += cost
            budget.query_count += 1
    
    def get_status(self, session_id: str) -> dict:
        budget = self.sessions.get(session_id)
        if not budget:
            return {"budget_set": False}
        
        remaining = budget.budget_limit - budget.total_spent
        usage_pct = budget.total_spent / budget.budget_limit if budget.budget_limit > 0 else 0
        
        return {
            "budget_set": True,
            "budget_limit": budget.budget_limit,
            "total_spent": budget.total_spent,
            "remaining": remaining,
            "usage_pct": usage_pct,
            "query_count": budget.query_count,
            "forced_downgrades": budget.forced_downgrades,
            "status": (
                "exhausted" if remaining <= 0 
                else "critical" if usage_pct >= 0.95
                else "warning" if usage_pct >= 0.80
                else "healthy"
            )
        }

budget_manager = BudgetManager()
