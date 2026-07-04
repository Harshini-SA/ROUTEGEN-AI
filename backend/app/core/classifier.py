import re
import requests
import tiktoken
from pydantic import BaseModel
from typing import Dict, Any

from app.config import settings


class ComplexityScore(BaseModel):
    score: float
    tier: str
    breakdown: Dict[str, float] = {}
    features: Dict[str, Any] = {}
    # Enriched observability fields (populated by both the HF and keyword paths)
    reason: str = ""
    confidence: float = 0.0
    method: str = "keyword_fallback"  # "huggingface" | "keyword_fallback"


# ── HuggingFace Zero-Shot Classification ────────────────────────────────────
# The model reads the MEANING of a query instead of matching surface keywords,
# so "prove you love me" (emotional) and "prove √2 is irrational" (math) land on
# different tiers even though both contain the word "prove".
CANDIDATE_LABELS = [
    "simple factual question or basic lookup",
    "moderate analytical or creative task",
    "complex reasoning mathematical proof or legal analysis",
]

LABEL_TO_TIER = {
    "simple factual question or basic lookup": "small",
    "moderate analytical or creative task": "large",
    "complex reasoning mathematical proof or legal analysis": "reasoning",
}


class PromptClassifier:
    """
    Complexity classifier that scores a prompt on a 1-10 scale.

    Primary path: HuggingFace zero-shot classification (semantic understanding).
    Fallback path: rule-based feature scorer (used when no HF key is configured,
    the model is still loading, the request times out, or the API errors).
    """

    def __init__(self):
        try:
            self.tokenizer = tiktoken.get_encoding("cl100k_base")
        except Exception:
            self.tokenizer = None

        self.negation_words = {"not", "never", "none", "no", "cannot", "don't", "won't", "shouldn't", "mustn't", "neither", "nor"}
        self.conditional_words = {"if", "unless", "given", "provided", "assuming", "whether", "case"}
        self.structured_keywords = {"json", "code", "table", "csv", "xml", "html", "dictionary", "array", "list", "format"}

    # ── Public entry points (unchanged signatures — the pipeline depends on these) ──

    def score_prompt(self, prompt: str) -> ComplexityScore:
        return self.classify_with_huggingface(prompt)

    def score_prompt_in_context(self, prompt: str, conversation_history: list = None) -> ComplexityScore:
        """
        Score complexity using conversation context so short follow-ups like
        'make it shorter' inherit the complexity of the ongoing thread.
        """
        if not conversation_history or len(conversation_history) <= 1:
            return self.classify_with_huggingface(prompt)

        recent = conversation_history[-4:-1] if len(conversation_history) > 4 else conversation_history[:-1]
        context_block = "\n".join(f"{msg['role']}: {msg['content']}" for msg in recent)
        enriched_prompt = f"{context_block}\nuser: {prompt}"
        result = self.classify_with_huggingface(enriched_prompt)
        result.reason += " (context-aware)"
        return result

    def tier_for_score(self, score: float) -> str:
        """Map a complexity score (1-10) to a tier name (1-4 Small, 5-7 Large, 8-10 Reasoning)."""
        if score <= 4.9:
            return "small"
        elif score <= 7.9:
            return "large"
        else:
            return "reasoning"

    # ── HuggingFace path ───────────────────────────────────────────────────

    def classify_with_huggingface(self, query: str) -> ComplexityScore:
        """Use HuggingFace zero-shot classification to judge complexity by MEANING."""
        api_key = settings.huggingface_api_key
        # Treat unset/placeholder keys as missing so we cleanly fall back.
        if not api_key or "your_" in api_key or "here" in api_key:
            print("[Classifier] No HF key configured, using keyword fallback")
            return self._keyword_fallback(query)

        try:
            headers = {
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            }
            payload = {
                "inputs": query,
                "parameters": {"candidate_labels": CANDIDATE_LABELS, "multi_label": False},
            }
            response = requests.post(
                settings.huggingface_classifier_url,
                headers=headers,
                json=payload,
                timeout=5,
            )

            if response.status_code == 200:
                result = response.json()
                if "labels" not in result or "scores" not in result:
                    print(f"[Classifier] Unexpected HF response shape: {result}, using fallback")
                    return self._keyword_fallback(query)

                top_label = result["labels"][0]
                top_score = float(result["scores"][0])
                tier = LABEL_TO_TIER[top_label]

                # Map the winning label + its confidence onto our 1-10 scale.
                # Higher confidence pushes the score toward the tier's extreme.
                if tier == "small":
                    final_score = 1.0 + top_score * 3.0        # ~1.0 – 4.0
                elif tier == "large":
                    final_score = 4.5 + top_score * 3.0        # ~4.5 – 7.5
                else:
                    final_score = 7.0 + top_score * 3.0        # ~7.0 – 10.0
                final_score = round(min(10.0, max(1.0, final_score)), 1)

                reason = f"HuggingFace classified as '{top_label}' with {top_score:.0%} confidence"
                print(f"[HuggingFace Classifier] Query: '{query[:50]}...'")
                print(f"[HuggingFace Classifier] Label: {top_label} | Confidence: {top_score:.2%}")
                print(f"[HuggingFace Classifier] Score: {final_score} -> {tier} tier")

                return ComplexityScore(
                    score=final_score,
                    tier=tier,
                    breakdown={"hf_confidence": round(top_score, 3), "base_score": final_score},
                    features={"hf_label": top_label},
                    reason=reason,
                    confidence=round(top_score, 3),
                    method="huggingface",
                )

            elif response.status_code == 503:
                print("[Classifier] HF model loading (503), using keyword fallback")
                return self._keyword_fallback(query)
            else:
                print(f"[Classifier] HF API error {response.status_code}, using keyword fallback")
                return self._keyword_fallback(query)

        except requests.Timeout:
            print("[Classifier] HF API timeout, using keyword fallback")
            return self._keyword_fallback(query)
        except Exception as e:
            print(f"[Classifier] HF error: {e}, using keyword fallback")
            return self._keyword_fallback(query)

    # ── Keyword fallback path (feature-based scorer) ───────────────────────

    def _keyword_fallback(self, query: str) -> ComplexityScore:
        features = self.extract_features(query)
        result = self._score_from_features(features)
        result.method = "keyword_fallback"
        result.confidence = 0.7
        return result

    def extract_features(self, prompt: str) -> Dict[str, Any]:
        text = prompt.lower()
        words = re.findall(r'\b\w+\b', text)
        sentences = [s for s in re.split(r'[.!?]+', text) if s.strip()]

        if self.tokenizer:
            token_count = len(self.tokenizer.encode(prompt))
        else:
            token_count = len(words) * 1.3

        long_words = [w for w in words if len(w) > 8]
        return {
            "prompt_text": prompt,
            "token_count": token_count,
            "sentence_count": len(sentences) if sentences else 1,
            "question_count": prompt.count('?'),
            "technical_term_ratio": len(long_words) / len(words) if words else 0.0,
            "structured_output_required": any(kw in text for kw in self.structured_keywords),
            "negation_count": sum(1 for w in words if w in self.negation_words),
            "conditional_count": sum(1 for w in words if w in self.conditional_words),
            "avg_word_length": sum(len(w) for w in words) / len(words) if words else 0.0,
        }

    def _score_from_features(self, features: Dict[str, Any]) -> ComplexityScore:
        prompt_lower = features.get("prompt_text", "").lower()
        token_count = features.get("token_count", 0)

        reasoning_keywords = [
            "prove", "proof", "solve", "calculate", "theorem", "contradiction",
            "\\sqrt", "\\[", "\\(", "equation", "integral", "derivative", "math",
        ]
        analysis_keywords = [
            "explain", "analyze", "compare", "design", "strategy", "marketing",
            "positioning", "channels", "pricing", "write", "create", "how to", "steps",
        ]

        has_reasoning = any(word in prompt_lower for word in reasoning_keywords)
        has_analysis = any(word in prompt_lower for word in analysis_keywords)
        length_bonus = min(2.0, token_count / 100.0)

        if has_reasoning:
            base_score = 8.0
            reason = "Keyword match: reasoning/proof/calculation task"
        elif has_analysis or token_count > 60:
            base_score = 5.0
            reason = "Keyword match: analytical/creative task"
        else:
            base_score = 1.0
            reason = "Keyword match: simple factual query"

        total_score = min(10.0, max(1.0, round(base_score + length_bonus, 1)))

        return ComplexityScore(
            score=total_score,
            tier=self.tier_for_score(total_score),
            breakdown={
                "base_score": base_score,
                "length_bonus": round(length_bonus, 1),
                "is_reasoning": 1.0 if has_reasoning else 0.0,
                "is_analysis": 1.0 if has_analysis else 0.0,
            },
            features=features,
            reason=reason,
            confidence=0.7,
            method="keyword_fallback",
        )


classifier = PromptClassifier()
