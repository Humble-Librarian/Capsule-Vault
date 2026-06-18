"""Core data schemas."""
from __future__ import annotations

import time
import uuid
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class CodeChunk:
    id: str = field(default_factory=lambda: f"chunk_{uuid.uuid4().hex[:12]}")
    type: str = "function"
    name: str = ""
    file_path: str = ""
    code: str = ""
    summary: str = ""
    dependencies: list[str] = field(default_factory=list)
    start_line: int = 0
    end_line: int = 0
    language: str = ""
    embedding: Optional[list[float]] = None

    def to_dict(self) -> dict:
        d = {
            "id": self.id,
            "type": self.type,
            "name": self.name,
            "file_path": self.file_path,
            "code": self.code,
            "summary": self.summary,
            "dependencies": self.dependencies,
            "start_line": self.start_line,
            "end_line": self.end_line,
            "language": self.language,
        }
        return d

    @classmethod
    def from_dict(cls, d: dict) -> "CodeChunk":
        return cls(
            id=d.get("id", ""),
            type=d.get("type", "function"),
            name=d.get("name", ""),
            file_path=d.get("file_path", ""),
            code=d.get("code", ""),
            summary=d.get("summary", ""),
            dependencies=d.get("dependencies", []),
            start_line=d.get("start_line", 0),
            end_line=d.get("end_line", 0),
            language=d.get("language", ""),
            embedding=d.get("embedding"),
        )


@dataclass
class Dependency:
    source: str = ""
    target: str = ""
    relationship: str = "calls"

    def to_dict(self) -> dict:
        return {"source": self.source, "target": self.target, "relationship": self.relationship}


@dataclass
class MemoryEntry:
    id: str = field(default_factory=lambda: f"mem_{uuid.uuid4().hex[:12]}")
    decision: str = ""
    reason: str = ""
    files: list[str] = field(default_factory=list)
    timestamp: float = field(default_factory=time.time)
    importance: float = 0.5
    access_count: int = 0
    tags: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "decision": self.decision,
            "reason": self.reason,
            "files": self.files,
            "timestamp": self.timestamp,
            "importance": self.importance,
            "access_count": self.access_count,
            "tags": self.tags,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "MemoryEntry":
        return cls(
            id=d.get("id", ""),
            decision=d.get("decision", ""),
            reason=d.get("reason", ""),
            files=d.get("files", []),
            timestamp=d.get("timestamp", 0),
            importance=d.get("importance", 0.5),
            access_count=d.get("access_count", 0),
            tags=d.get("tags", []),
        )


@dataclass
class QueryRewrite:
    original: str = ""
    rewritten: str = ""
    keywords: list[str] = field(default_factory=list)


@dataclass
class RetrievalResult:
    chunk: Optional[CodeChunk] = None
    score: float = 0.0
    source: str = ""

    def to_dict(self) -> dict:
        return {
            "chunk": self.chunk.to_dict() if self.chunk else None,
            "score": self.score,
            "source": self.source,
        }


@dataclass
class ContextBlock:
    header: str = ""
    content: str = ""
    block_type: str = "code"

    def render(self) -> str:
        return f"[{self.block_type.upper()}: {self.header}]\n{self.content}\n"


@dataclass
class UndoRecord:
    action_id: str = field(default_factory=lambda: uuid.uuid4().hex[:12])
    timestamp: float = field(default_factory=time.time)
    files_changed: list[str] = field(default_factory=list)
    previous_states: dict[str, str] = field(default_factory=dict)
    description: str = ""


@dataclass
class AgentResponse:
    answer: str = ""
    reasoning_steps: list[str] = field(default_factory=list)
    actions_taken: list[str] = field(default_factory=list)
    context_used: list[str] = field(default_factory=list)
