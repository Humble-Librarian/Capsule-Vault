"""Global settings and configuration."""
from __future__ import annotations

import json
import os
from pathlib import Path
from dataclasses import dataclass, field, asdict
from typing import Optional


def _load_dotenv(path: str = ".env") -> None:
    p = Path(path)
    if not p.exists():
        return
    with open(p) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line:
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip().strip("'\"")
                if key and key not in os.environ:
                    os.environ[key] = value


_load_dotenv()


@dataclass
class EmbeddingConfig:
    model_name: str = "sentence-transformers/all-MiniLM-L6-v2"
    dimension: int = 384
    batch_size: int = 64
    device: str = "cpu"


@dataclass
class RerankerConfig:
    model_name: str = "cross-encoder/ms-marco-MiniLM-L-6-v2"
    top_k: int = 30
    output_k: int = 8


@dataclass
class VectorDBConfig:
    backend: str = "faiss"
    persist_dir: str = ".contextvault/vectors"
    ef_construction: int = 128
    M: int = 16


@dataclass
class GraphDBConfig:
    backend: str = "json"
    persist_path: str = ".contextvault/graph.json"


@dataclass
class MemoryConfig:
    persist_path: str = ".contextvault/memory"
    max_entries: int = 10000
    importance_decay: float = 0.95
    recency_weight: float = 0.3
    frequency_weight: float = 0.3
    impact_weight: float = 0.4


@dataclass
class LLMConfig:
    provider: str = "groq"
    model: str = "llama-3.3-70b-versatile"
    fallback_provider: str = "ollama"
    fallback_model: str = "codellama"
    temperature: float = 0.1
    max_tokens: int = 4096
    api_key_env: str = "GROQ_API_KEY"
    base_url: str = "https://api.groq.com/openai/v1"


@dataclass
class RetrievalConfig:
    semantic_top_k: int = 30
    keyword_top_k: int = 20
    graph_expansion_hops: int = 2
    merged_top_k: int = 30
    final_top_k: int = 8


@dataclass
class Settings:
    project_root: str = "."
    embedding: EmbeddingConfig = field(default_factory=EmbeddingConfig)
    reranker: RerankerConfig = field(default_factory=RerankerConfig)
    vector_db: VectorDBConfig = field(default_factory=VectorDBConfig)
    graph_db: GraphDBConfig = field(default_factory=GraphDBConfig)
    memory: MemoryConfig = field(default_factory=MemoryConfig)
    llm: LLMConfig = field(default_factory=LLMConfig)
    retrieval: RetrievalConfig = field(default_factory=RetrievalConfig)
    chunk_extensions: list[str] = field(
        default_factory=lambda: [
            ".py", ".js", ".ts", ".jsx", ".tsx", ".java", ".go", ".rs",
            ".c", ".cpp", ".h", ".hpp", ".cs", ".rb", ".php", ".swift",
            ".kt", ".scala", ".sh", ".yaml", ".yml", ".toml", ".json",
        ]
    )
    ignore_dirs: list[str] = field(
        default_factory=lambda: [
            "node_modules", ".git", "__pycache__", ".venv", "venv",
            "dist", "build", ".contextvault", "vendor", ".next",
            "target", ".tox", ".mypy_cache",
        ]
    )

    @classmethod
    def load(cls, path: str = ".contextvault/config.json") -> "Settings":
        p = Path(path)
        if p.exists():
            with open(p) as f:
                data = json.load(f)
            return cls(**data)
        return cls()

    def save(self, path: str = ".contextvault/config.json") -> None:
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        with open(p, "w") as f:
            json.dump(asdict(self), f, indent=2)


settings = Settings()
