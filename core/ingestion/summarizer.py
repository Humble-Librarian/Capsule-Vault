"""Code summarization using LLM."""
from __future__ import annotations

from typing import Optional
from models.schemas import CodeChunk
from config.settings import settings


def _extract_signature(code: str, chunk_type: str) -> str:
    lines = code.strip().split("\n")
    if chunk_type == "function":
        for line in lines[:3]:
            stripped = line.strip()
            if stripped.startswith("def ") or stripped.startswith("function ") or stripped.startswith("async "):
                return stripped
        return lines[0] if lines else ""
    elif chunk_type == "class":
        for line in lines[:3]:
            stripped = line.strip()
            if stripped.startswith("class "):
                return stripped
        return lines[0] if lines else ""
    return lines[0] if lines else ""


def _rule_based_summary(chunk: CodeChunk) -> str:
    sig = _extract_signature(chunk.code, chunk.type)
    lines = chunk.code.strip().split("\n")
    line_count = len(lines)

    parts = []
    if chunk.type == "function":
        parts.append(f"Function `{chunk.name}`")
    elif chunk.type == "class":
        parts.append(f"Class `{chunk.name}`")
    else:
        parts.append(f"Module `{chunk.name}`")

    parts.append(f"in `{chunk.file_path}` ({line_count} lines)")

    if chunk.dependencies:
        parts.append(f"uses: {', '.join(chunk.dependencies[:5])}")

    has_return = any("return " in line for line in lines)
    if has_return:
        parts.append("has return values")

    is_async = any("async " in line for line in lines[:3])
    if is_async:
        parts.append("async")

    has_loop = any(kw in chunk.code for kw in ["for ", "while ", "map(", "forEach("])
    if has_loop:
        parts.append("contains loops")

    has_condition = any(kw in chunk.code for kw in ["if ", "switch ", "match "])
    if has_condition:
        parts.append("has conditional logic")

    return ". ".join(parts) + "."


def summarize_chunk(chunk: CodeChunk, llm_call=None) -> str:
    if llm_call:
        prompt = f"""Summarize this code chunk concisely. Include:
1. Purpose (1 sentence)
2. Inputs/Outputs
3. Side effects (if any)

Type: {chunk.type}
Name: {chunk.name}
File: {chunk.file_path}

```{chunk.language}
{chunk.code[:2000]}
```

Summary:"""
        try:
            result = llm_call(prompt)
            if result and len(result) > 10:
                return result.strip()
        except Exception:
            pass

    return _rule_based_summary(chunk)


def summarize_chunks(
    chunks: list[CodeChunk],
    llm_call=None,
    batch_size: int = 20,
) -> list[CodeChunk]:
    for i, chunk in enumerate(chunks):
        chunk.summary = summarize_chunk(chunk, llm_call)
    return chunks


def generate_file_summary(chunks: list[CodeChunk], file_path: str) -> str:
    file_chunks = [c for c in chunks if c.file_path == file_path]
    if not file_chunks:
        return ""

    type_counts: dict[str, int] = {}
    for c in file_chunks:
        type_counts[c.type] = type_counts.get(c.type, 0) + 1

    parts = [f"File `{file_path}` contains:"]
    for t, count in type_counts.items():
        parts.append(f"  - {count} {t}(s)")

    names = [c.name for c in file_chunks if c.name]
    if names:
        parts.append(f"Key items: {', '.join(names[:10])}")

    return "\n".join(parts)
