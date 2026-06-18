"""Embedding generation for code chunks."""
from __future__ import annotations

import numpy as np
from typing import Optional
from models.schemas import CodeChunk
from config.settings import settings


class CodeEmbedder:
    def __init__(self, model_name: Optional[str] = None):
        self.model_name = model_name or settings.embedding.model_name
        self._model = None
        self.dimension = settings.embedding.dimension

    def _load_model(self):
        if self._model is not None:
            return
        try:
            from sentence_transformers import SentenceTransformer
            self._model = SentenceTransformer(self.model_name, device=settings.embedding.device)
            self.dimension = self._model.get_sentence_embedding_dimension()
        except ImportError:
            self._model = "fallback"

    def _embed_text(self, texts: list[str]) -> np.ndarray:
        self._load_model()
        if self._model == "fallback":
            return self._hash_embed(texts)
        return self._model.encode(
            texts,
            batch_size=settings.embedding.batch_size,
            show_progress_bar=False,
            normalize_embeddings=True,
        )

    def _hash_embed(self, texts: list[str]) -> np.ndarray:
        embeddings = []
        for text in texts:
            h = hash(text) % (2**31)
            rng = np.random.RandomState(h)
            vec = rng.randn(self.dimension).astype(np.float32)
            vec /= np.linalg.norm(vec) + 1e-9
            embeddings.append(vec)
        return np.array(embeddings, dtype=np.float32)

    def embed_text(self, text: str) -> list[float]:
        result = self._embed_text([text])
        return result[0].tolist()

    def embed_chunks(self, chunks: list[CodeChunk]) -> list[CodeChunk]:
        texts = []
        for chunk in chunks:
            parts = []
            if chunk.name:
                parts.append(f"{chunk.type}: {chunk.name}")
            if chunk.summary:
                parts.append(chunk.summary)
            if not parts:
                parts.append(chunk.code[:500])
            texts.append(" ".join(parts))

        embeddings = self._embed_text(texts)

        for i, chunk in enumerate(chunks):
            chunk.embedding = embeddings[i].tolist()

        return chunks

    def embed_query(self, query: str) -> list[float]:
        return self.embed_text(query)

    def save_index(self, chunks: list[CodeChunk], path: str) -> None:
        embeddings = np.array([c.embedding for c in chunks if c.embedding], dtype=np.float32)
        ids = [c.id for c in chunks if c.embedding]

        import json
        from pathlib import Path

        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)

        np.save(str(p) + ".npy", embeddings)
        with open(str(p) + "_ids.json", "w") as f:
            json.dump(ids, f)

    def load_index(self, path: str) -> tuple[list[str], np.ndarray]:
        import json
        from pathlib import Path

        p = Path(path)
        embeddings = np.load(str(p) + ".npy")
        with open(str(p) + "_ids.json") as f:
            ids = json.load(f)
        return ids, embeddings
