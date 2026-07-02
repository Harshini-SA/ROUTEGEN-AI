import re
import tiktoken
from pydantic import BaseModel
from typing import Dict, Any

class ComplexityScore(BaseModel):
    score: float
    tier: str
    breakdown: Dict[str, float]
    features: Dict[str, Any]

class PromptClassifier:
    """
    Rule-based complexity classifier that scores a prompt on a 1-10 scale
    based on 8 features extracted from the text.
    """
    def __init__(self):
        try:
            self.tokenizer = tiktoken.get_encoding("cl100k_base")
        except Exception:
            self.tokenizer = None

        self.negation_words = {"not", "never", "none", "no", "cannot", "don't", "won't", "shouldn't", "mustn't", "neither", "nor"}
        self.conditional_words = {"if", "unless", "given", "provided", "assuming", "whether", "case"}
        self.structured_keywords = {"json", "code", "table", "csv", "xml", "html", "dictionary", "array", "list", "format"}

    def extract_features(self, prompt: str) -> Dict[str, Any]:
        text = prompt.lower()
        words = re.findall(r'\b\w+\b', text)
        sentences = re.split(r'[.!?]+', text)
        sentences = [s for s in sentences if s.strip()]

        # 1. token_count
        if self.tokenizer:
            token_count = len(self.tokenizer.encode(prompt))
        else:
            token_count = len(words) * 1.3  # Rough estimate

        # 2. sentence_count
        sentence_count = len(sentences) if len(sentences) > 0 else 1

        # 3. question_count
        question_count = prompt.count('?')

        # 4. technical_term_ratio (Heuristic: words > 8 chars or specific domains)
        long_words = [w for w in words if len(w) > 8]
        technical_term_ratio = len(long_words) / len(words) if words else 0.0

        # 5. structured_output_required
        structured_output_required = any(kw in text for kw in self.structured_keywords)

        # 6. negation_count
        negation_count = sum(1 for w in words if w in self.negation_words)

        # 7. conditional_count
        conditional_count = sum(1 for w in words if w in self.conditional_words)

        # 8. avg_word_length
        avg_word_length = sum(len(w) for w in words) / len(words) if words else 0.0

        return {
            "token_count": token_count,
            "sentence_count": sentence_count,
            "question_count": question_count,
            "technical_term_ratio": technical_term_ratio,
            "structured_output_required": structured_output_required,
            "negation_count": negation_count,
            "conditional_count": conditional_count,
            "avg_word_length": avg_word_length
        }

    def score_prompt(self, prompt: str) -> ComplexityScore:
        features = self.extract_features(prompt)
        return self._score_from_features(features)

    def score_prompt_in_context(self, prompt: str, conversation_history: list[dict] = None) -> ComplexityScore:
        """
        Score complexity using conversation context.
        Concatenates the last 3 turns + current prompt so short follow-ups
        like 'make it shorter' inherit the complexity of the full thread.
        """
        if not conversation_history or len(conversation_history) <= 1:
            # No prior context, score normally
            return self.score_prompt(prompt)

        # Build a context block from the last 3 turns (excluding the current message which is already appended)
        recent = conversation_history[-4:-1] if len(conversation_history) > 4 else conversation_history[:-1]
        context_block = "\n".join(
            f"{msg['role']}: {msg['content']}" for msg in recent
        )
        enriched_prompt = f"{context_block}\nuser: {prompt}"
        features = self.extract_features(enriched_prompt)
        return self._score_from_features(features)

    def _score_from_features(self, features: Dict[str, Any]) -> ComplexityScore:
        # Calculate dimension scores (1-10)
        
        # Dimension 1: Token Length (20%)
        # > 1000 tokens -> 10, < 50 -> 1
        len_score = min(10.0, max(1.0, (features["token_count"] / 100.0) + 1.0))
        
        # Dimension 2: Ambiguity (20%)
        # Few sentences but long words / questions might mean underspecified
        amb_score = min(10.0, max(1.0, features["question_count"] * 2.0 + (features["avg_word_length"] - 4)))

        # Dimension 3: Domain Depth (25%)
        dom_score = min(10.0, max(1.0, features["technical_term_ratio"] * 30.0 + 1.0))

        # Dimension 4: Output Format (15%)
        fmt_score = 8.0 if features["structured_output_required"] else 2.0

        # Dimension 5: Reasoning Required (20%)
        rsn_score = min(10.0, max(1.0, (features["negation_count"] * 1.5) + (features["conditional_count"] * 2.0) + 1.0))

        # Weighted Total Score
        total_score = (
            len_score * 0.20 +
            amb_score * 0.20 +
            dom_score * 0.25 +
            fmt_score * 0.15 +
            rsn_score * 0.20
        )

        total_score = min(10.0, max(1.0, round(total_score, 1)))

        # Tier mapping (1-4 Small, 5-7 Large, 8-10 Reasoning)
        if total_score <= 4:
            tier = "small"
        elif total_score <= 7:
            tier = "large"
        else:
            tier = "reasoning"

        return ComplexityScore(
            score=total_score,
            tier=tier,
            breakdown={
                "length": round(len_score, 1),
                "ambiguity": round(amb_score, 1),
                "domain": round(dom_score, 1),
                "format": round(fmt_score, 1),
                "reasoning": round(rsn_score, 1)
            },
            features=features
        )

classifier = PromptClassifier()

