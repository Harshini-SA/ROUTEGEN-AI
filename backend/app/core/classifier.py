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
            "prompt_text": prompt,
            "token_count": token_count,
            "sentence_count": sentence_count,
            "question_count": question_count,
            "technical_term_ratio": technical_term_ratio,
            "structured_output_required": structured_output_required,
            "negation_count": negation_count,
            "conditional_count": conditional_count,
            "avg_word_length": avg_word_length
        }

    def tier_for_score(self, score: float) -> str:
        """Map a complexity score (1-10) to a tier name (1-4 Small, 5-7 Large, 8-10 Reasoning)."""
        if score <= 4.9:
            return "small"
        elif score <= 7.9:
            return "large"
        else:
            return "reasoning"

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
        prompt_lower = features.get("prompt_text", "").lower()
        token_count = features.get("token_count", 0)

        # 1. Reasoning / Math / Complex Logic Indicators (8-10 Range)
        reasoning_keywords = [
            "prove", "proof", "solve", "calculate", "theorem", "contradiction", 
            "\\sqrt", "\\[", "\\(", "equation", "integral", "derivative", "math"
        ]
        
        # 2. Analysis / Creative / Multi-part Indicators (5-7 Range)
        analysis_keywords = [
            "explain", "analyze", "compare", "design", "strategy", "marketing", 
            "positioning", "channels", "pricing", "write", "create", "how to", "steps"
        ]

        has_reasoning = any(word in prompt_lower for word in reasoning_keywords)
        has_analysis = any(word in prompt_lower for word in analysis_keywords)

        # Length bonus (up to +2.0 points for very long prompts)
        length_bonus = min(2.0, token_count / 100.0)

        if has_reasoning:
            base_score = 8.0
        elif has_analysis or token_count > 60:
            base_score = 5.0
        else:
            base_score = 1.0 # Simple factual questions fall here

        total_score = base_score + length_bonus
        total_score = min(10.0, max(1.0, round(total_score, 1)))

        return ComplexityScore(
            score=total_score,
            tier=self.tier_for_score(total_score),
            breakdown={
                "base_score": base_score,
                "length_bonus": round(length_bonus, 1),
                "is_reasoning": 1.0 if has_reasoning else 0.0,
                "is_analysis": 1.0 if has_analysis else 0.0
            },
            features=features
        )

classifier = PromptClassifier()

