"""Main orchestrator - ties all components together."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from config.settings import settings, Settings
from models.schemas import (
    CodeChunk, QueryRewrite, RetrievalResult, ContextBlock,
    MemoryEntry, AgentResponse
)
from core.ingestion.ast_chunker import chunk_directory
from core.ingestion.dependency_graph import DependencyGraph
from core.ingestion.summarizer import summarize_chunks
from core.ingestion.embedder import CodeEmbedder
from core.retrieval.query_rewriter import rewrite_query
from core.retrieval.semantic_search import VectorStore
from core.retrieval.keyword_search import BM25Index
from core.retrieval.graph_search import GraphSearcher
from core.retrieval.merger import merge_results
from core.ranking.reranker import Reranker
from core.context_builder.builder import ContextBuilder
from core.agent.llm import LLMProvider, create_llm_call
from core.agent.reasoner import Reasoner
from core.actions.file_editor import FileEditor
from core.actions.command_runner import CommandRunner
from core.memory.store import MemoryStore


class Orchestrator:
    def __init__(self, project_root: str = ".", config: Optional[Settings] = None):
        self.project_root = Path(project_root).resolve()
        self.config = config or settings
        self.config.project_root = str(self.project_root)

        self._vector_store: Optional[VectorStore] = None
        self._bm25_index: Optional[BM25Index] = None
        self._dependency_graph: Optional[DependencyGraph] = None
        self._embedder: Optional[CodeEmbedder] = None
        self._reranker: Optional[Reranker] = None
        self._llm: Optional[LLMProvider] = None
        self._reasoner: Optional[Reasoner] = None
        self._editor: Optional[FileEditor] = None
        self._runner: Optional[CommandRunner] = None
        self._memory: Optional[MemoryStore] = None
        self._chunks: list[CodeChunk] = []

    @property
    def vector_store(self) -> VectorStore:
        if self._vector_store is None:
            persist_dir = str(self.project_root / settings.vector_db.persist_dir)
            self._vector_store = VectorStore.load(persist_dir)
        return self._vector_store

    @property
    def bm25(self) -> BM25Index:
        if self._bm25_index is None:
            self._bm25_index = BM25Index()
        return self._bm25_index

    @property
    def dependency_graph(self) -> DependencyGraph:
        if self._dependency_graph is None:
            graph_path = str(self.project_root / settings.graph_db.persist_path)
            if Path(graph_path).exists():
                self._dependency_graph = DependencyGraph.load(graph_path)
            else:
                self._dependency_graph = DependencyGraph()
        return self._dependency_graph

    @property
    def embedder(self) -> CodeEmbedder:
        if self._embedder is None:
            self._embedder = CodeEmbedder()
        return self._embedder

    @property
    def reranker(self) -> Reranker:
        if self._reranker is None:
            self._reranker = Reranker()
        return self._reranker

    @property
    def llm(self) -> LLMProvider:
        if self._llm is None:
            self._llm = LLMProvider()
        return self._llm

    @property
    def reasoner(self) -> Reasoner:
        if self._reasoner is None:
            self._reasoner = Reasoner(self.llm)
        return self._reasoner

    @property
    def editor(self) -> FileEditor:
        if self._editor is None:
            self._editor = FileEditor(str(self.project_root))
        return self._editor

    @property
    def runner(self) -> CommandRunner:
        if self._runner is None:
            self._runner = CommandRunner(str(self.project_root))
        return self._runner

    @property
    def memory(self) -> MemoryStore:
        if self._memory is None:
            persist_path = str(self.project_root / settings.memory.persist_path)
            self._memory = MemoryStore(persist_path)
        return self._memory

    def init_project(self, progress_callback=None) -> dict:
        if progress_callback:
            progress_callback("Scanning codebase...")

        self._chunks = chunk_directory(
            str(self.project_root),
            settings.chunk_extensions,
            settings.ignore_dirs,
        )

        if progress_callback:
            progress_callback(f"Found {len(self._chunks)} code chunks")

        if progress_callback:
            progress_callback("Building dependency graph...")

        self.dependency_graph.build(self._chunks)

        if progress_callback:
            progress_callback("Generating summaries...")

        llm_call = create_llm_call() if self.config.llm.provider else None
        self._chunks = summarize_chunks(self._chunks, llm_call)

        if progress_callback:
            progress_callback("Generating embeddings...")

        self._chunks = self.embedder.embed_chunks(self._chunks)

        if progress_callback:
            progress_callback("Building search indices...")

        self.vector_store.add_chunks(self._chunks)
        self.bm25.add_chunks(self._chunks)

        persist_dir = str(self.project_root / settings.vector_db.persist_dir)
        self.vector_store.save(persist_dir)

        graph_path = str(self.project_root / settings.graph_db.persist_path)
        self.dependency_graph.save(graph_path)

        chunk_data = {c.id: c.to_dict() for c in self._chunks}
        chunks_path = str(self.project_root / ".contextvault" / "chunks.json")
        Path(chunks_path).parent.mkdir(parents=True, exist_ok=True)
        with open(chunks_path, "w") as f:
            json.dump(chunk_data, f, indent=2)

        stats = {
            "total_chunks": len(self._chunks),
            "files_indexed": len(set(c.file_path for c in self._chunks)),
            "dependencies": len(list(self.dependency_graph.adjacency.values())),
        }

        if progress_callback:
            progress_callback(f"Indexing complete: {stats}")

        return stats

    def _ensure_indexed(self) -> None:
        if not self._chunks:
            chunks_path = self.project_root / ".contextvault" / "chunks.json"
            if chunks_path.exists():
                with open(chunks_path) as f:
                    data = json.load(f)
                self._chunks = [CodeChunk.from_dict(v) for v in data.values()]
                self.bm25.add_chunks(self._chunks)
            else:
                raise RuntimeError("Project not indexed. Run 'init' first.")

    def ask(self, query: str) -> AgentResponse:
        self._ensure_indexed()

        query_rewrite = rewrite_query(query, create_llm_call() if self.config.llm.provider else None)

        semantic_results = self.vector_store.search(
            query_rewrite.rewritten,
            top_k=settings.retrieval.semantic_top_k,
        )

        keyword_results = self.bm25.search(
            query_rewrite.rewritten,
            top_k=settings.retrieval.keyword_top_k,
        )

        top_chunk_ids = [r.chunk.id for r in semantic_results[:10] if r.chunk]
        graph_searcher = GraphSearcher(self.dependency_graph, {c.id: c for c in self._chunks})
        graph_results = graph_searcher.expand(top_chunk_ids, hops=settings.retrieval.graph_expansion_hops)

        merged = merge_results(semantic_results, keyword_results, graph_results)

        reranked = self.reranker.rerank(query_rewrite.rewritten, merged)

        memory_entries = self.memory.search(query, top_k=5)

        context_builder = ContextBuilder()
        blocks = context_builder.build(reranked, query_rewrite, memory_entries)
        blocks = context_builder.compress(blocks)
        context_text = context_builder.render(blocks)

        response = self.reasoner.multi_step_reason(query, context_text)

        self.memory.add(
            decision=f"Q: {query}",
            reason=response.answer[:200],
            files=[r.chunk.file_path for r in reranked[:3] if r.chunk],
            tags=["query", "ask"],
        )

        return response

    def do(self, task_description: str) -> AgentResponse:
        self._ensure_indexed()

        plan = self.reasoner.plan_action(task_description, self._build_project_context())

        self.memory.add(
            decision=f"Action: {task_description}",
            reason=plan.answer[:200],
            tags=["action", "do"],
        )

        return plan

    def why(self, topic: str) -> AgentResponse:
        memory_entries = self.memory.search(topic, top_k=10)
        file_entries = []
        for entry in self.memory.entries.values():
            if any(t in topic.lower() for t in entry.decision.lower().split()):
                file_entries.append(entry)

        all_entries = list({e.id: e for e in memory_entries + file_entries}.values())
        all_entries.sort(key=lambda e: e.importance, reverse=True)

        if not all_entries:
            return AgentResponse(
                answer=f"No memory found about: {topic}",
                reasoning_steps=["Searched memory store, no relevant entries found"],
            )

        context = "Past decisions and context:\n\n"
        for entry in all_entries[:5]:
            context += f"- {entry.decision}\n"
            if entry.reason:
                context += f"  Reason: {entry.reason}\n"
            if entry.files:
                context += f"  Files: {', '.join(entry.files)}\n"
            context += "\n"

        response = self.reasoner.analyze(
            f"Explain the reasoning behind: {topic}",
            context,
        )

        for entry in all_entries[:5]:
            self.memory.touch(entry.id)

        return response

    def undo(self) -> Optional[dict]:
        record = self.editor.undo()
        if record:
            self.memory.add(
                decision=f"Undone: {record.description}",
                reason="User requested undo",
                files=record.files_changed,
                tags=["undo"],
            )
            return {
                "action_id": record.action_id,
                "files_reverted": record.files_changed,
                "description": record.description,
            }
        return None

    def status(self) -> dict:
        chunks_path = self.project_root / ".contextvault" / "chunks.json"
        indexed = chunks_path.exists()

        stats = {
            "project_root": str(self.project_root),
            "indexed": indexed,
            "memory_entries": self.memory.count(),
            "memory_stats": self.memory.get_stats(),
        }

        if indexed:
            with open(chunks_path) as f:
                data = json.load(f)
            stats["total_chunks"] = len(data)
            stats["files_indexed"] = len(set(
                v.get("file_path", "") for v in data.values()
            ))

        return stats

    def _build_project_context(self) -> str:
        if not self._chunks:
            self._ensure_indexed()

        file_map: dict[str, list[str]] = {}
        for chunk in self._chunks:
            if chunk.file_path not in file_map:
                file_map[chunk.file_path] = []
            file_map[chunk.file_path].append(f"{chunk.type}: {chunk.name}")

        parts = ["Project structure:"]
        for fp, items in sorted(file_map.items()):
            parts.append(f"\n{fp}:")
            for item in items[:10]:
                parts.append(f"  - {item}")

        return "\n".join(parts)
