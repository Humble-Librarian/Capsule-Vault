"""Graph-based context expansion."""
from __future__ import annotations

from models.schemas import CodeChunk, RetrievalResult
from core.ingestion.dependency_graph import DependencyGraph


class GraphSearcher:
    def __init__(self, graph: DependencyGraph, chunks: dict[str, CodeChunk]):
        self.graph = graph
        self.chunks = chunks

    def expand(self, chunk_ids: list[str], hops: int = 2) -> list[RetrievalResult]:
        expanded = set()
        results = []

        for cid in chunk_ids:
            related = self.graph.get_related_chunks(cid) if hops > 1 else self.graph.get_dependencies(cid)
            for rid in related:
                if rid not in expanded and rid not in chunk_ids:
                    expanded.add(rid)
                    chunk = self.chunks.get(rid)
                    if chunk:
                        results.append(RetrievalResult(
                            chunk=chunk,
                            score=0.5,
                            source="graph",
                        ))

        return results

    def get_impact_analysis(self, chunk_id: str) -> list[RetrievalResult]:
        dependents = self.graph.get_all_dependents(chunk_id)
        results = []
        for did in dependents:
            chunk = self.chunks.get(did)
            if chunk:
                results.append(RetrievalResult(
                    chunk=chunk,
                    score=0.8,
                    source="graph_impact",
                ))
        return results

    def get_change_impact(self, file_path: str) -> list[RetrievalResult]:
        file_chunks = [
            cid for cid, c in self.chunks.items()
            if c.file_path == file_path
        ]
        all_impacted = set()
        for cid in file_chunks:
            impacted = self.graph.get_all_dependents(cid)
            all_impacted.update(impacted)

        results = []
        for iid in all_impacted:
            chunk = self.chunks.get(iid)
            if chunk:
                results.append(RetrievalResult(
                    chunk=chunk,
                    score=0.7,
                    source="graph_change_impact",
                ))
        return results
