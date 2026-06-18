"""Semantic search using vector embeddings."""
from __future__ import annotations

import json
import numpy as np
from pathlib import Path
from typing import Optional

from models.schemas import CodeChunk, RetrievalResult
from config.settings import settings


class VectorStore:
    def __init__(self):
        self.chunks: dict[str, CodeChunk] = {}
        self.embeddings: Optional[np.ndarray] = None
        self.ids: list[str] = []
        self._index = None

    def add_chunks(self, chunks: list[CodeChunk]) -> None:
        for chunk in chunks:
            if chunk.embedding:
                self.chunks[chunk.id] = chunk

        self._rebuild_index()

    def _rebuild_index(self) -> None:
        embedded_chunks = [c for c in self.chunks.values() if c.embedding]
        if not embedded_chunks:
            self.embeddings = None
            self.ids = []
            return

        self.ids = [c.id for c in embedded_chunks]
        self.embeddings = np.array(
            [c.embedding for c in embedded_chunks], dtype=np.float32
        )

        try:
            import faiss
            dim = self.embeddings.shape[1]
            self._index = faiss.IndexFlatIP(dim)
            faiss.normalize_L2(self.embeddings)
            self._index.add(self.embeddings)
        except ImportError:
            self._index = None

    def search(
        self,
        query_embedding: list[float],
        top_k: int = 30,
        min_score: float = 0.0,
    ) -> list[RetrievalResult]:
        if self.embeddings is None or len(self.ids) == 0:
            return []

        query_vec = np.array([query_embedding], dtype=np.float32)

        if self._index is not None:
            import faiss
            faiss.normalize_L2(query_vec)
            scores, indices = self._index.search(query_vec, min(top_k, len(self.ids)))
            results = []
            for score, idx in zip(scores[0], indices[0]):
                if idx < 0 or idx >= len(self.ids):
                    continue
                chunk_id = self.ids[idx]
                chunk = self.chunks.get(chunk_id)
                if chunk and score >= min_score:
                    results.append(RetrievalResult(chunk=chunk, score=float(score), source="semantic"))
            return results

        similarities = self.embeddings @ query_vec.T
        similarities = similarities.flatten()

        top_indices = np.argsort(similarities)[::-1][:top_k]

        results = []
        for idx in top_indices:
            score = float(similarities[idx])
            if score < min_score:
                continue
            chunk_id = self.ids[idx]
            chunk = self.chunks.get(chunk_id)
            if chunk:
                results.append(RetrievalResult(chunk=chunk, score=score, source="semantic"))

        return results

    def save(self, directory: str) -> None:
        p = Path(directory)
        p.mkdir(parents=True, exist_ok=True)

        with open(p / "chunks.json", "w") as f:
            chunk_data = {cid: c.to_dict() for cid, c in self.chunks.items()}
            json.dump(chunk_data, f, indent=2)

        if self.embeddings is not None:
            np.save(str(p / "embeddings.npy"), self.embeddings)
            with open(p / "ids.json", "w") as f:
                json.dump(self.ids, f)

    @classmethod
    def load(cls, directory: str) -> "VectorStore":
        store = cls()
        p = Path(directory)

        chunks_path = p / "chunks.json"
        if chunks_path.exists():
            with open(chunks_path) as f:
                chunk_data = json.load(f)
            store.chunks = {k: CodeChunk.from_dict(v) for k, v in chunk_data.items()}

        emb_path = p / "embeddings.npy"
        ids_path = p / "ids.json"
        if emb_path.exists() and ids_path.exists():
            store.embeddings = np.load(str(emb_path))
            with open(ids_path) as f:
                store.ids = json.load(f)
            store._rebuild_index()

        return store
