"""Build structured context from retrieval results."""
from __future__ import annotations

from typing import Optional

from models.schemas import (
    CodeChunk, RetrievalResult, ContextBlock, MemoryEntry, QueryRewrite
)
from config.settings import settings


class ContextBuilder:
    def __init__(self, max_tokens: int = 8000):
        self.max_tokens = max_tokens
        self._current_tokens = 0

    def _estimate_tokens(self, text: str) -> int:
        return len(text) // 4

    def build(
        self,
        results: list[RetrievalResult],
        query_rewrite: Optional[QueryRewrite] = None,
        memory_entries: Optional[list[MemoryEntry]] = None,
    ) -> list[ContextBlock]:
        blocks: list[ContextBlock] = []
        self._current_tokens = 0

        if query_rewrite:
            block = ContextBlock(
                header="Query Analysis",
                content=f"Original: {query_rewrite.original}\nRewritten: {query_rewrite.rewritten}\nKeywords: {', '.join(query_rewrite.keywords)}",
                block_type="meta",
            )
            blocks.append(block)
            self._current_tokens += self._estimate_tokens(block.content)

        if memory_entries:
            mem_block = self._build_memory_block(memory_entries)
            if mem_block:
                blocks.append(mem_block)
                self._current_tokens += self._estimate_tokens(mem_block.content)

        seen_files = set()
        for result in results:
            if not result.chunk:
                continue
            if self._current_tokens >= self.max_tokens:
                break

            block = self._chunk_to_block(result)
            if block:
                blocks.append(block)
                self._current_tokens += self._estimate_tokens(block.content)
                seen_files.add(result.chunk.file_path)

        return blocks

    def _chunk_to_block(self, result: RetrievalResult) -> Optional[ContextBlock]:
        chunk = result.chunk
        if not chunk:
            return None

        header = f"{chunk.file_path}::{chunk.name}"
        content_parts = []

        content_parts.append(f"Type: {chunk.type}")
        content_parts.append(f"Name: {chunk.name}")
        content_parts.append(f"File: {chunk.file_path}")
        content_parts.append(f"Lines: {chunk.start_line}-{chunk.end_line}")

        if chunk.summary:
            content_parts.append(f"\nSummary: {chunk.summary}")

        if chunk.dependencies:
            content_parts.append(f"\nDependencies: {', '.join(chunk.dependencies)}")

        code = chunk.code
        if self._estimate_tokens(code) > 2000:
            lines = code.split("\n")
            half = len(lines) // 2
            code = "\n".join(lines[:half]) + "\n... [truncated] ...\n" + "\n".join(lines[-half:])

        content_parts.append(f"\n```{chunk.language}\n{code}\n```")

        source_label = f" [relevance: {result.score:.2f}, source: {result.source}]"
        content_parts.append(source_label)

        return ContextBlock(
            header=header,
            content="\n".join(content_parts),
            block_type="code",
        )

    def _build_memory_block(self, entries: list[MemoryEntry]) -> Optional[ContextBlock]:
        if not entries:
            return None

        parts = []
        for entry in entries[:5]:
            parts.append(f"[{entry.decision}]")
            if entry.reason:
                parts.append(f"  Reason: {entry.reason}")
            if entry.files:
                parts.append(f"  Files: {', '.join(entry.files)}")

        return ContextBlock(
            header="Past Decisions & Memory",
            content="\n".join(parts),
            block_type="memory",
        )

    def render(self, blocks: list[ContextBlock]) -> str:
        parts = []
        for block in blocks:
            parts.append(block.render())
        return "\n---\n".join(parts)

    def compress(self, blocks: list[ContextBlock]) -> list[ContextBlock]:
        if self._estimate_tokens(self.render(blocks)) <= self.max_tokens:
            return blocks

        compressed = []
        current_tokens = 0

        for block in blocks:
            block_tokens = self._estimate_tokens(block.content)
            if current_tokens + block_tokens <= self.max_tokens:
                compressed.append(block)
                current_tokens += block_tokens
            elif block.block_type == "code":
                lines = block.content.split("\n")
                max_lines = (self.max_tokens - current_tokens) * 4
                if max_lines > 10:
                    truncated = "\n".join(lines[:int(max_lines // 2)]) + "\n... [compressed] ...\n" + "\n".join(lines[-int(max_lines // 2):])
                    compressed.append(ContextBlock(
                        header=block.header,
                        content=truncated,
                        block_type=block.block_type,
                    ))
                break
            elif block.block_type == "memory":
                if current_tokens + 200 <= self.max_tokens:
                    compressed.append(block)
                    current_tokens += 200
                break

        return compressed
