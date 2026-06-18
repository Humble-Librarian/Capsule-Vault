"""Merge and deduplicate retrieval results from multiple sources."""
from __future__ import annotations

from models.schemas import RetrievalResult
from config.settings import settings


def merge_results(
    semantic_results: list[RetrievalResult],
    keyword_results: list[RetrievalResult],
    graph_results: list[RetrievalResult],
    semantic_weight: float = 0.5,
    keyword_weight: float = 0.3,
    graph_weight: float = 0.2,
    top_k: int = 30,
) -> list[RetrievalResult]:
    scores: dict[str, float] = {}
    chunk_map: dict[str, RetrievalResult] = {}

    max_semantic = max((r.score for r in semantic_results), default=1.0) or 1.0
    max_keyword = max((r.score for r in keyword_results), default=1.0) or 1.0
    max_graph = max((r.score for r in graph_results), default=1.0) or 1.0

    for r in semantic_results:
        if r.chunk:
            cid = r.chunk.id
            norm_score = r.score / max_semantic
            scores[cid] = scores.get(cid, 0) + norm_score * semantic_weight
            if cid not in chunk_map:
                chunk_map[cid] = RetrievalResult(chunk=r.chunk, score=0, source="merged")

    for r in keyword_results:
        if r.chunk:
            cid = r.chunk.id
            norm_score = r.score / max_keyword
            scores[cid] = scores.get(cid, 0) + norm_score * keyword_weight
            if cid not in chunk_map:
                chunk_map[cid] = RetrievalResult(chunk=r.chunk, score=0, source="merged")

    for r in graph_results:
        if r.chunk:
            cid = r.chunk.id
            norm_score = r.score / max_graph
            scores[cid] = scores.get(cid, 0) + norm_score * graph_weight
            if cid not in chunk_map:
                chunk_map[cid] = RetrievalResult(chunk=r.chunk, score=0, source="merged")

    for cid, score in scores.items():
        if cid in chunk_map:
            chunk_map[cid].score = score

    merged = sorted(chunk_map.values(), key=lambda x: x.score, reverse=True)
    return merged[:top_k]
