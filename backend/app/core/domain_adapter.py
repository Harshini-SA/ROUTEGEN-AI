from collections import Counter
from dataclasses import dataclass

DOMAIN_KEYWORDS = {
    "legal": [
        "contract", "liability", "clause", 
        "litigation", "arbitration", "tort",
        "breach", "indemnification", "statute",
        "jurisdiction", "plaintiff", "defendant",
        "damages", "negligence", "compliance",
        "law", "sue", "court", "judge", "illegal", "legal"
    ],
    "medical": [
        "diagnosis", "symptom", "treatment", 
        "medication", "dosage", "patient",
        "clinical", "prognosis", "therapy",
        "syndrome", "pathology", "prescription",
        "doctor", "disease", "health", "hospital"
    ],
    "technical": [
        "algorithm", "database", "api", 
        "architecture", "deployment", "code",
        "function", "framework", "server",
        "debug", "optimize", "compile",
        "software", "hardware", "network", "system"
    ],
    "financial": [
        "investment", "portfolio", "equity",
        "revenue", "valuation", "audit",
        "taxation", "compliance", "roi",
        "amortization", "liquidity",
        "finance", "stock", "market", "economy"
    ]
}

# Domain-specific threshold shifts
# Negative = push toward higher tiers (more conservative/careful)
# Positive = push toward lower tiers
DOMAIN_SHIFTS = {
    "legal": -1.5,      # legal needs precision
    "medical": -2.0,    # medical needs most caution
    "financial": -1.0,  
    "technical": 0.0,   # technical questions are usually clear-cut
    "general": 0.0
}

@dataclass
class UserDomainProfile:
    session_id: str
    query_history: list
    dominant_domain: str = "general"
    confidence: float = 0.0

class DomainAdapter:
    def __init__(self, history_window=10):
        self.profiles = {}
        self.window = history_window
    
    def update_profile(self, session_id: str, query: str) -> None:
        if session_id not in self.profiles:
            self.profiles[session_id] = UserDomainProfile(
                session_id=session_id,
                query_history=[]
            )
        
        profile = self.profiles[session_id]
        profile.query_history.append(query.lower())
        
        # Keep only last N queries
        if len(profile.query_history) > self.window:
            profile.query_history.pop(0)
        
        # Recalculate dominant domain
        self._classify_domain(profile)
    
    def _classify_domain(self, profile: UserDomainProfile) -> None:
        combined_text = " ".join(profile.query_history)
        
        domain_scores = {}
        for domain, keywords in DOMAIN_KEYWORDS.items():
            matches = sum(1 for kw in keywords if kw in combined_text)
            domain_scores[domain] = matches
        
        if not any(domain_scores.values()):
            profile.dominant_domain = "general"
            profile.confidence = 0.0
            return
        
        best_domain = max(domain_scores, key=domain_scores.get)
        total_matches = sum(domain_scores.values())
        
        profile.dominant_domain = best_domain
        profile.confidence = domain_scores[best_domain] / max(1, total_matches)
        
        print(f"[DomainAdapter] Session {profile.session_id[:8]}: domain={best_domain} confidence={profile.confidence:.2f}")
    
    def get_adjusted_score(self, session_id: str, base_score: float) -> tuple[float, str, float]:
        """
        Returns: (adjusted_score, domain, shift)
        """
        profile = self.profiles.get(session_id)
        
        if not profile or profile.confidence < 0.3:
            return base_score, "general", 0.0
        
        shift = DOMAIN_SHIFTS.get(profile.dominant_domain, 0.0)
        
        # A negative shift means more conservative. To push to higher tiers,
        # we must increase the score. So we subtract the negative shift.
        adjusted = base_score - shift
        adjusted = max(1.0, min(10.0, adjusted))
        
        return (adjusted, profile.dominant_domain, -shift)

domain_adapter = DomainAdapter()

