from sentence_transformers import SentenceTransformer
import numpy as np
from datetime import datetime, timedelta
from typing import Optional
import json

class SmartCache:
    def __init__(self, 
                 similarity_threshold=0.92,
                 max_entries=1000,
                 ttl_hours=24):
        
        # Use the same MiniLM model already 
        # installed for RAG — zero extra cost
        self.model = SentenceTransformer('all-MiniLM-L6-v2')
        self.threshold = similarity_threshold
        self.max_entries = max_entries
        self.ttl = timedelta(hours=ttl_hours)
        
        # Cache structure:
        # { embedding: np.array, 
        #   query: str,
        #   response: str,
        #   tier: str,
        #   model: str,
        #   cost: float,
        #   hits: int,
        #   created_at: datetime }
        self.cache = []
    
    def find_similar(self, query: str) -> Optional[dict]:
        """
        Check if semantically similar query exists in cache.
        Returns cached entry if similarity above threshold, None otherwise.
        """
        if not self.cache:
            return None
        
        # Embed the new query
        query_embedding = self.model.encode([query], convert_to_numpy=True)[0]
        
        # Compare against all cached embeddings
        best_similarity = 0
        best_entry = None
        
        now = datetime.now()
        
        for entry in self.cache:
            # Skip expired entries
            if now - entry['created_at'] > self.ttl:
                continue
            
            # Cosine similarity
            similarity = np.dot(query_embedding, entry['embedding']) / (np.linalg.norm(query_embedding) * np.linalg.norm(entry['embedding']))
            
            if similarity > best_similarity:
                best_similarity = similarity
                best_entry = entry
        
        if best_similarity >= self.threshold:
            # Cache hit!
            best_entry['hits'] += 1
            print(f"[SmartCache] HIT! Similarity: {best_similarity:.3f} Query: '{query[:50]}' Matched: '{best_entry['query'][:50]}'")
            return best_entry
        
        print(f"[SmartCache] MISS. Best similarity: {best_similarity:.3f}")
        return None
    
    def store(self, query: str, response: str, tier: str, model: str, cost: float) -> None:
        """Store a new query-response pair."""
        
        # Don't cache greetings or very short queries
        if len(query.split()) < 4:
            return
        
        # Don't cache if already at capacity
        # Remove oldest entry first
        if len(self.cache) >= self.max_entries:
            self.cache.sort(key=lambda x: x['created_at'])
            self.cache.pop(0)
        
        embedding = self.model.encode([query], convert_to_numpy=True)[0]
        
        self.cache.append({
            'embedding': embedding,
            'query': query,
            'response': response,
            'tier': tier,
            'model': model,
            'cost': cost,
            'hits': 0,
            'created_at': datetime.now()
        })
        
        print(f"[SmartCache] STORED: '{query[:50]}' Cache size: {len(self.cache)}")
    
    def get_stats(self) -> dict:
        """Return cache statistics."""
        total_hits = sum(e['hits'] for e in self.cache)
        total_cost_saved = sum(e['cost'] * e['hits'] for e in self.cache)
        return {
            'total_entries': len(self.cache),
            'total_hits': total_hits,
            'total_cost_saved': total_cost_saved,
            'hit_rate': total_hits / max(1, total_hits + len(self.cache))
        }
    
    def clear(self) -> None:
        self.cache = []

# Global instance — shared across all requests
smart_cache = SmartCache(
    similarity_threshold=0.92,
    max_entries=1000,
    ttl_hours=24
)
