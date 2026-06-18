"""Dependency graph construction and traversal."""
from __future__ import annotations

import json
from pathlib import Path
from collections import defaultdict
from typing import Optional

from models.schemas import CodeChunk, Dependency


class DependencyGraph:
    def __init__(self):
        self.adjacency: dict[str, list[Dependency]] = defaultdict(list)
        self.reverse_adj: dict[str, list[Dependency]] = defaultdict(list)
        self._all_chunks: dict[str, CodeChunk] = {}

    def build(self, chunks: list[CodeChunk]) -> None:
        self.adjacency.clear()
        self.reverse_adj.clear()
        self._all_chunks.clear()

        for chunk in chunks:
            self._all_chunks[chunk.id] = chunk

        name_to_ids: dict[str, list[str]] = defaultdict(list)
        for chunk in chunks:
            name_to_ids[chunk.name].append(chunk.id)
            file_stem = Path(chunk.file_path).stem
            name_to_ids[file_stem].append(chunk.id)

        for chunk in chunks:
            for dep_name in chunk.dependencies:
                target_ids = name_to_ids.get(dep_name, [])
                for target_id in target_ids:
                    if target_id != chunk.id:
                        dep = Dependency(source=chunk.id, target=target_id, relationship="calls")
                        self.adjacency[chunk.id].append(dep)
                        self.reverse_adj[target_id].append(dep)

    def add_file_imports(self, file_path: str, imports: list[str], chunks: list[CodeChunk]) -> None:
        file_chunks = [c for c in chunks if c.file_path == file_path]
        if not file_chunks:
            return

        for imp in imports:
            for chunk in chunks:
                if chunk.name in imp or Path(chunk.file_path).stem in imp:
                    for fc in file_chunks:
                        if fc.id != chunk.id:
                            dep = Dependency(source=fc.id, target=chunk.id, relationship="imports")
                            self.adjacency[fc.id].append(dep)
                            self.reverse_adj[chunk.id].append(dep)

    def get_dependencies(self, chunk_id: str, depth: int = 1) -> list[str]:
        visited = set()
        result = []
        queue = [(chunk_id, 0)]

        while queue:
            current, d = queue.pop(0)
            if current in visited or d > depth:
                continue
            visited.add(current)

            if current != chunk_id:
                result.append(current)

            for dep in self.adjacency.get(current, []):
                if dep.target not in visited:
                    queue.append((dep.target, d + 1))

        return result

    def get_dependents(self, chunk_id: str, depth: int = 1) -> list[str]:
        visited = set()
        result = []
        queue = [(chunk_id, 0)]

        while queue:
            current, d = queue.pop(0)
            if current in visited or d > depth:
                continue
            visited.add(current)

            if current != chunk_id:
                result.append(current)

            for dep in self.reverse_adj.get(current, []):
                if dep.source not in visited:
                    queue.append((dep.source, d + 1))

        return result

    def get_all_dependencies(self, chunk_id: str) -> list[str]:
        return self.get_dependencies(chunk_id, depth=10)

    def get_all_dependents(self, chunk_id: str) -> list[str]:
        return self.get_dependents(chunk_id, depth=10)

    def get_related_chunks(self, chunk_id: str) -> list[str]:
        deps = set(self.get_dependencies(chunk_id, depth=2))
        dependents = set(self.get_dependents(chunk_id, depth=2))
        return list(deps | dependents)

    def get_topological_order(self) -> list[str]:
        in_degree: dict[str, int] = defaultdict(int)
        all_nodes = set(self._all_chunks.keys())

        for node in all_nodes:
            for dep in self.adjacency.get(node, []):
                in_degree[dep.target] += 1

        queue = [n for n in all_nodes if in_degree[n] == 0]
        order = []

        while queue:
            node = queue.pop(0)
            order.append(node)
            for dep in self.adjacency.get(node, []):
                in_degree[dep.target] -= 1
                if in_degree[dep.target] == 0:
                    queue.append(dep.target)

        for node in all_nodes:
            if node not in order:
                order.append(node)

        return order

    def save(self, path: str) -> None:
        data = {
            "adjacency": {
                k: [d.to_dict() for d in v]
                for k, v in self.adjacency.items()
            },
            "reverse_adj": {
                k: [d.to_dict() for d in v]
                for k, v in self.reverse_adj.items()
            },
        }
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        with open(p, "w") as f:
            json.dump(data, f, indent=2)

    @classmethod
    def load(cls, path: str) -> "DependencyGraph":
        graph = cls()
        with open(path) as f:
            data = json.load(f)

        for k, deps in data.get("adjacency", {}).items():
            graph.adjacency[k] = [Dependency(**d) for d in deps]
        for k, deps in data.get("reverse_adj", {}).items():
            graph.reverse_adj[k] = [Dependency(**d) for d in deps]

        return graph
