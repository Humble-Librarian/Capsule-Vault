"""Cross-encoder reranking for retrieval results."""
from __future__ import annotations

from typing import Optional
from models.schemas import RetrievalResult
from config.settings import settings


class Reranker:
    def __init__(self, model_name: Optional[str] = None):
        self.model_name = model_name or settings.reranker.model_name
        self._model = None

    def _load_model(self):
        if self._model is not None:
            return
        try:
            from sentence_transformers import CrossEncoder
            self._model = CrossEncoder(self.model_name, device=settings.embedding.device)
        except ImportError:
            self._model = "fallback"

    def rerank(
        self,
        query: str,
        results: list[RetrievalResult],
        top_k: Optional[int] = None,
    ) -> list[RetrievalResult]:
        top_k = top_k or settings.reranker.output_k

        if not results:
            return []

        candidates = results[:settings.reranker.top_k]

        self._load_model()

        if self._model == "fallback":
            return self._fallback_rerank(query, candidates, top_k)

        pairs = []
        for r in candidates:
            if r.chunk:
                text = f"{r.chunk.name} {r.chunk.summary} {r.chunk.code[:500]}"
                pairs.append([query, text])
            else:
                pairs.append([query, ""])

        scores = self._model.predict(pairs)

        reranked = []
        for i, (r, score) in enumerate(zip(candidates, scores)):
            reranked.append(RetrievalResult(
                chunk=r.chunk,
                score=float(score),
                source="reranked",
            ))

        reranked.sort(key=lambda x: x.score, reverse=True)
        return reranked[:top_k]

    def _fallback_rerank(
        self,
        query: str,
        results: list[RetrievalResult],
        top_k: int,
    ) -> list[RetrievalResult]:
        query_lower = query.lower()
        query_tokens = set(query_lower.split())

        scored = []
        for r in results:
            if not r.chunk:
                continue
            text = f"{r.chunk.name} {r.chunk.summary} {r.chunk.code}".lower()
            text_tokens = set(text.split())
            overlap = len(query_tokens & text_tokens)
            name_match = 1.0 if any(t in r.chunk.name.lower() for t in query_tokens) else 0.0
            summary_match = 1.0 if any(t in r.chunk.summary.lower() for t in query_tokens) else 0.0
            combined = r.score * 0.3 + overlap * 0.2 + name_match * 0.3 + summary_match * 0.2
            scored.append(RetrievalResult(chunk=r.chunk, score=combined, source="reranked"))

        scored.sort(key=lambda x: x.score, reverse=True)
        return scored[:top_k]
