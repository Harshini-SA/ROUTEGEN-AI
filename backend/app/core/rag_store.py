"""
RouteGen AI — RAG Document Store

Chunks uploaded document text, embeds it locally with sentence-transformers,
and stores it in an embedded (on-disk) ChromaDB collection scoped per chat
session_id. No external services required — everything runs in-process.
"""

import uuid
import logging
from typing import Dict, List

try:
    import chromadb
    HAS_CHROMADB = True
except ImportError:
    HAS_CHROMADB = False

try:
    from sentence_transformers import SentenceTransformer
    HAS_SENTENCE_TRANSFORMERS = True
except ImportError:
    HAS_SENTENCE_TRANSFORMERS = False

try:
    import tiktoken
    HAS_TIKTOKEN = True
except ImportError:
    HAS_TIKTOKEN = False

logger = logging.getLogger("routegen.rag")

CHROMA_PATH = "./chroma_db"
COLLECTION_NAME = "rag_documents"
CHUNK_SIZE = 500
CHUNK_OVERLAP = 50


class RAGStore:
    """Simple session-scoped RAG store backed by local ChromaDB + MiniLM embeddings."""

    def __init__(self):
        self.model = None
        self.collection = None
        self._tokenizer = None

        if not HAS_CHROMADB or not HAS_SENTENCE_TRANSFORMERS:
            logger.warning("⚠️ RAG disabled (chromadb/sentence-transformers not installed)")
            return

        try:
            logger.info("Loading embedding model all-MiniLM-L6-v2 for RAG...")
            self.model = SentenceTransformer("all-MiniLM-L6-v2")
            client = chromadb.PersistentClient(path=CHROMA_PATH)
            self.collection = client.get_or_create_collection(COLLECTION_NAME)
            logger.info("✅ RAG store initialized (local ChromaDB + MiniLM embeddings).")
        except Exception as e:
            logger.error(f"⚠️ Failed to initialize RAG store: {e}")
            self.collection = None

        if HAS_TIKTOKEN:
            try:
                self._tokenizer = tiktoken.get_encoding("cl100k_base")
            except Exception:
                self._tokenizer = None

    def _chunk_text(self, text: str) -> List[str]:
        """Split text into ~500-token chunks with 50-token overlap."""
        if not text or not text.strip():
            return []

        step = CHUNK_SIZE - CHUNK_OVERLAP

        if self._tokenizer:
            tokens = self._tokenizer.encode(text)
            chunks = [
                self._tokenizer.decode(tokens[i:i + CHUNK_SIZE])
                for i in range(0, len(tokens), step)
            ]
        else:
            words = text.split()
            chunks = [" ".join(words[i:i + CHUNK_SIZE]) for i in range(0, len(words), step)]

        return [c for c in chunks if c.strip()]

    def add_document(self, session_id: str, text: str, filename: str) -> int:
        """Chunk, embed, and store a document's text scoped to a session. Returns chunk count."""
        if not self.collection or not self.model:
            logger.warning("RAG store unavailable — skipping document indexing.")
            return 0

        chunks = self._chunk_text(text)
        if not chunks:
            logger.warning(f"No text extracted from '{filename}' — nothing indexed.")
            return 0

        embeddings = self.model.encode(chunks).tolist()
        ids = [f"{session_id}__{uuid.uuid4().hex}" for _ in chunks]
        metadatas = [
            {"session_id": session_id, "filename": filename, "chunk_index": i}
            for i in range(len(chunks))
        ]

        self.collection.add(ids=ids, embeddings=embeddings, documents=chunks, metadatas=metadatas)
        logger.info(f"📚 Indexed {len(chunks)} chunks from '{filename}' (session={session_id})")
        return len(chunks)

    def has_session_docs(self, session_id: str) -> bool:
        if not self.collection:
            return False
        try:
            result = self.collection.get(where={"session_id": session_id}, limit=1)
            return len(result.get("ids", [])) > 0
        except Exception as e:
            logger.error(f"has_session_docs check failed: {e}")
            return False

    def retrieve_context(self, session_id: str, query: str, top_k: int = 3) -> List[Dict[str, str]]:
        """Return the top_k most relevant chunks for this session, or [] if none / unavailable."""
        if not self.collection or not self.model:
            return []
        try:
            query_embedding = self.model.encode([query]).tolist()
            results = self.collection.query(
                query_embeddings=query_embedding,
                n_results=top_k,
                where={"session_id": session_id},
            )
        except Exception as e:
            logger.error(f"RAG retrieval failed: {e}")
            return []

        docs = results.get("documents") or [[]]
        metas = results.get("metadatas") or [[]]
        return [
            {"text": doc, "filename": meta.get("filename", "unknown")}
            for doc, meta in zip(docs[0], metas[0])
        ]

    def list_documents(self, session_id: str) -> List[str]:
        """Return the distinct filenames uploaded for a session, in upload order."""
        if not self.collection:
            return []
        try:
            result = self.collection.get(where={"session_id": session_id})
        except Exception as e:
            logger.error(f"list_documents failed: {e}")
            return []

        filenames: List[str] = []
        for meta in result.get("metadatas", []) or []:
            fn = meta.get("filename")
            if fn and fn not in filenames:
                filenames.append(fn)
        return filenames

    def clear_session(self, session_id: str) -> None:
        """Delete all indexed chunks for a session."""
        if not self.collection:
            return
        try:
            self.collection.delete(where={"session_id": session_id})
            logger.info(f"🗑️ Cleared RAG documents for session {session_id}")
        except Exception as e:
            logger.error(f"clear_session failed: {e}")


rag_store = RAGStore()
