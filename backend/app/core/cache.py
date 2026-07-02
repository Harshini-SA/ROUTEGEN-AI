import logging
from typing import Optional, Dict, Any

try:
    import chromadb
    from chromadb.config import Settings as ChromaSettings
    HAS_CHROMADB = True
except ImportError:
    HAS_CHROMADB = False

try:
    from sentence_transformers import SentenceTransformer
    HAS_SENTENCE_TRANSFORMERS = True
except ImportError:
    HAS_SENTENCE_TRANSFORMERS = False

from app.config import settings

logger = logging.getLogger("routegen.cache")

class SemanticCache:
    """
    Semantic cache using ChromaDB and Sentence-Transformers to avoid 
    redundant LLM calls for similar prompts.
    """
    def __init__(self):
        self.embedding_model = None
        self.collection = None
        self.client = None
        
        if not HAS_SENTENCE_TRANSFORMERS or not HAS_CHROMADB:
            logger.warning("⚠️ Semantic Cache disabled (chromadb/sentence-transformers not installed)")
            return
        
        try:
            # Load lightweight embedding model
            self.embedding_model = SentenceTransformer('all-MiniLM-L6-v2')
            
            # Extract host and port from settings.chroma_url (e.g. http://localhost:8001 or http://chroma:8000)
            url_parts = settings.chroma_url.replace("http://", "").split(":")
            host = url_parts[0]
            port = url_parts[1] if len(url_parts) > 1 else "8000"
            
            self.client = chromadb.HttpClient(host=host, port=port)
            self.collection = self.client.get_or_create_collection(
                name="routegen_cache",
                metadata={"hnsw:space": "cosine"}
            )
            logger.info("✅ Semantic Cache initialized successfully.")
        except Exception as e:
            logger.error(f"⚠️ Failed to initialize Semantic Cache: {e}")
            self.collection = None
            
    def _get_embedding(self, text: str) -> list[float]:
        if not self.embedding_model:
            return []
        return self.embedding_model.encode(text).tolist()

    async def check_cache(self, prompt: str) -> Optional[Dict[str, Any]]:
        """
        Check if a highly similar prompt exists in the cache.
        Returns the cached response if similarity >= threshold, else None.
        """
        if not self.collection or not self.embedding_model:
            return None
            
        try:
            embedding = self._get_embedding(prompt)
            
            # Query ChromaDB (Cosine similarity: Chroma returns distance. Distance = 1 - similarity for cosine in some versions, 
            # but usually we can just look at the raw distances if it's cosine space)
            results = self.collection.query(
                query_embeddings=[embedding],
                n_results=1,
                include=["documents", "metadatas", "distances"]
            )
            
            if not results["documents"][0]:
                return None
                
            distance = results["distances"][0][0]
            # Convert distance to similarity (depends on chroma version, usually 1 - distance)
            similarity = 1.0 - distance
            
            if similarity >= settings.cache_similarity_threshold:
                return {
                    "response": results["documents"][0][0], # The cached LLM output
                    "similarity": similarity,
                    "cached_prompt": results["metadatas"][0][0].get("original_prompt", "")
                }
                
        except Exception as e:
            logger.error(f"Cache check error: {e}")
            
        return None
        
    async def save_to_cache(self, prompt: str, response: str) -> None:
        """
        Save a new prompt-response pair to the cache.
        """
        if not self.collection or not self.embedding_model:
            return
            
        try:
            embedding = self._get_embedding(prompt)
            # Use a hash of the prompt as the ID
            import hashlib
            doc_id = hashlib.sha256(prompt.encode()).hexdigest()
            
            self.collection.add(
                ids=[doc_id],
                embeddings=[embedding],
                documents=[response], # We store the response as the document body
                metadatas=[{"original_prompt": prompt}]
            )
        except Exception as e:
            logger.error(f"Cache save error: {e}")

semantic_cache = SemanticCache()
