"""Context compression utilities."""
from __future__ import annotations

import re
from models.schemas import CodeChunk


def compress_code(code: str, max_lines: int = 50) -> str:
    lines = code.split("\n")
    if len(lines) <= max_lines:
        return code

    half = max_lines // 2
    header = lines[:half]
    footer = lines[-half:]
    return "\n".join(header) + f"\n... [{len(lines) - max_lines} lines compressed] ...\n" + "\n".join(footer)


def remove_comments(code: str, language: str = "python") -> str:
    lines = code.split("\n")
    cleaned = []
    for line in lines:
        stripped = line.strip()
        if language == "python" and stripped.startswith("#"):
            continue
        if language in ("javascript", "typescript", "java", "c", "cpp", "go", "rust", "swift", "kotlin"):
            if stripped.startswith("//") or stripped.startswith("/*") or stripped.startswith("*"):
                continue
        cleaned.append(line)
    return "\n".join(cleaned)


def deduplicate_chunks(chunks: list[CodeChunk]) -> list[CodeChunk]:
    seen = set()
    unique = []
    for chunk in chunks:
        key = (chunk.file_path, chunk.name, chunk.start_line)
        if key not in seen:
            seen.add(key)
            unique.append(chunk)
    return unique


def extract_imports_only(code: str, language: str) -> str:
    lines = code.split("\n")
    imports = []
    for line in lines:
        stripped = line.strip()
        if language == "python":
            if stripped.startswith("import ") or stripped.startswith("from "):
                imports.append(line)
        elif language in ("javascript", "typescript"):
            if stripped.startswith("import ") or stripped.startswith("require("):
                imports.append(line)
        elif language == "java":
            if stripped.startswith("import "):
                imports.append(line)
        elif language == "go":
            if stripped.startswith("import"):
                imports.append(line)
    return "\n".join(imports)
