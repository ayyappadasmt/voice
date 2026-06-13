"""
Simple TF-IDF based RAG for MVP.
No vector DB needed - works with flat JSON file.
Replace with Vertex AI Matching Engine when moving to GCP.
"""
import json
import os
from pathlib import Path
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity
import numpy as np

from app.models.knowledge import KnowledgeBase, KnowledgeChunk, KnowledgeChunkCreate, KnowledgeChunkUpdate

DATA_FILE = Path(__file__).parent.parent / "data" / "knowledge_base.json"


def _load() -> KnowledgeBase:
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)

    if not DATA_FILE.exists():
        DATA_FILE.write_text(KnowledgeBase().model_dump_json())

    content = DATA_FILE.read_text().strip()

    if not content:
        empty_kb = KnowledgeBase()
        DATA_FILE.write_text(empty_kb.model_dump_json())
        return empty_kb

    return KnowledgeBase.model_validate_json(content)


def _save(kb: KnowledgeBase):
    DATA_FILE.write_text(kb.model_dump_json(indent=2))


def get_all_chunks() -> list[KnowledgeChunk]:
    return _load().chunks


def add_chunk(data: KnowledgeChunkCreate) -> KnowledgeChunk:
    kb = _load()
    chunk = KnowledgeChunk(**data.model_dump())
    kb.chunks.append(chunk)
    _save(kb)
    return chunk


def update_chunk(chunk_id: str, data: KnowledgeChunkUpdate) -> KnowledgeChunk | None:
    kb = _load()
    for i, chunk in enumerate(kb.chunks):
        if chunk.id == chunk_id:
            updated = chunk.model_copy(update={
                k: v for k, v in data.model_dump().items() if v is not None
            })
            kb.chunks[i] = updated
            _save(kb)
            return updated
    return None


def delete_chunk(chunk_id: str) -> bool:
    kb = _load()
    original_len = len(kb.chunks)
    kb.chunks = [c for c in kb.chunks if c.id != chunk_id]
    if len(kb.chunks) < original_len:
        _save(kb)
        return True
    return False


def retrieve_relevant_context(query: str, top_k: int = 3) -> str:
    """Return the most relevant knowledge chunks as a single context string."""
    kb = _load()
    if not kb.chunks:
        return "No company knowledge base has been configured yet."

    documents = [f"{c.title}: {c.content}" for c in kb.chunks]

    try:
        vectorizer = TfidfVectorizer(stop_words="english")
        tfidf_matrix = vectorizer.fit_transform(documents)
        query_vec = vectorizer.transform([query])
        scores = cosine_similarity(query_vec, tfidf_matrix).flatten()
        top_indices = np.argsort(scores)[::-1][:top_k]

        selected = [documents[i] for i in top_indices if scores[i] > 0.0]
        if not selected:
            # fallback: return all if no match
            selected = documents[:top_k]

        return "\n\n".join(selected)
    except Exception:
        # If vectorizer fails (e.g., empty vocab), return all content
        return "\n\n".join(documents[:top_k])