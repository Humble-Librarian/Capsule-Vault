"""AST-based code chunking using tree-sitter."""
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional

try:
    import tree_sitter_languages
except ImportError:
    tree_sitter_languages = None

from models.schemas import CodeChunk
from config.settings import settings


# Language mapping for tree-sitter
LANG_MAP: dict[str, str] = {
    ".py": "python", ".js": "javascript", ".ts": "typescript",
    ".jsx": "javascript", ".tsx": "typescript", ".java": "java",
    ".go": "go", ".rs": "rust", ".c": "c", ".cpp": "cpp",
    ".h": "c", ".hpp": "cpp", ".cs": "c_sharp", ".rb": "ruby",
    ".php": "php", ".swift": "swift", ".kt": "kotlin",
}

# Node types to extract as chunks
CHUNK_NODE_TYPES = {
    "python": {"function_definition", "class_definition", "async_function_definition"},
    "javascript": {"function_declaration", "class_declaration", "export_statement", "arrow_function", "method_definition"},
    "typescript": {"function_declaration", "class_declaration", "export_statement", "arrow_function", "method_definition", "interface_declaration", "type_alias_declaration"},
    "java": {"class_declaration", "method_declaration", "interface_declaration"},
    "go": {"function_declaration", "method_declaration", "type_declaration"},
    "rust": {"function_item", "impl_item", "struct_item", "enum_item", "trait_item"},
    "c": {"function_definition", "struct_specifier"},
    "cpp": {"function_definition", "class_specifier", "struct_specifier"},
}

# Map node types to our chunk types
NODE_TO_CHUNK_TYPE: dict[str, str] = {
    "function_definition": "function",
    "function_declaration": "function",
    "async_function_definition": "function",
    "method_declaration": "function",
    "method_definition": "function",
    "function_item": "function",
    "arrow_function": "function",
    "class_definition": "class",
    "class_declaration": "class",
    "class_specifier": "class",
    "struct_item": "class",
    "struct_specifier": "class",
    "struct_declaration": "class",
    "interface_declaration": "interface",
    "enum_item": "enum",
    "trait_item": "interface",
    "type_declaration": "type",
    "type_alias_declaration": "type",
    "export_statement": "module",
}


def _get_parser(language: str):
    if tree_sitter_languages is None:
        raise ImportError("tree-sitter-languages not installed. Run: pip install tree-sitter-languages")
    return tree_sitter_languages.get_parser(language)


def _extract_name(node, source: bytes) -> str:
    for child in node.children:
        if child.type == "name" or child.type == "identifier":
            return source[child.start_byte:child.end_byte].decode("utf-8", errors="replace")
        if child.type == "property_name":
            return source[child.start_byte:child.end_byte].decode("utf-8", errors="replace")
    return "<anonymous>"


def _extract_dependencies(node, source: bytes) -> list[str]:
    deps = []
    for child in node.children:
        if child.type == "call":
            for arg in child.children:
                if arg.type == "identifier":
                    deps.append(source[arg.start_byte:arg.end_byte].decode("utf-8", errors="replace"))
        if child.type == "attribute":
            for attr_child in child.children:
                if attr_child.type == "identifier":
                    name = source[attr_child.start_byte:attr_child.end_byte].decode("utf-8", errors="replace")
                    if name != "self" and name != "cls":
                        deps.append(name)
    return list(set(deps))


def _walk_tree(node, source: bytes, language: str, file_path: str) -> list[CodeChunk]:
    chunks = []
    target_types = CHUNK_NODE_TYPES.get(language, set())

    if node.type in target_types:
        chunk_type = NODE_TO_CHUNK_TYPE.get(node.type, "function")
        name = _extract_name(node, source)
        code = source[node.start_byte:node.end_byte].decode("utf-8", errors="replace")
        deps = _extract_dependencies(node, source)

        chunk = CodeChunk(
            type=chunk_type,
            name=name,
            file_path=file_path,
            code=code,
            start_line=node.start_point[0] + 1,
            end_line=node.end_point[0] + 1,
            language=language,
            dependencies=deps,
        )
        chunks.append(chunk)

    for child in node.children:
        chunks.extend(_walk_tree(child, source, language, file_path))

    return chunks


def _fallback_chunk(content: str, file_path: str, language: str) -> list[CodeChunk]:
    chunks = []
    lines = content.split("\n")
    chunk_size = 50

    for i in range(0, len(lines), chunk_size):
        end = min(i + chunk_size, len(lines))
        chunk_code = "\n".join(lines[i:end])
        if chunk_code.strip():
            chunk = CodeChunk(
                type="module",
                name=f"{Path(file_path).stem}_part_{i // chunk_size}",
                file_path=file_path,
                code=chunk_code,
                start_line=i + 1,
                end_line=end,
                language=language,
            )
            chunks.append(chunk)

    return chunks


def chunk_file(file_path: str, content: Optional[str] = None) -> list[CodeChunk]:
    path = Path(file_path)
    ext = path.suffix.lower()
    language = LANG_MAP.get(ext)

    if not language:
        return []

    if content is None:
        try:
            with open(file_path, "r", encoding="utf-8", errors="replace") as f:
                content = f.read()
        except (OSError, IOError):
            return []

    if not content.strip():
        return []

    source = content.encode("utf-8")

    try:
        parser = _get_parser(language)
        tree = parser.parse(source)
        chunks = _walk_tree(tree.root_node, source, language, str(path))

        if not chunks:
            chunks = _fallback_chunk(content, str(path), language)

        if not chunks:
            chunk = CodeChunk(
                type="file",
                name=path.stem,
                file_path=str(path),
                code=content,
                language=language,
            )
            chunks = [chunk]

        return chunks
    except Exception:
        return _fallback_chunk(content, str(path), language)


def chunk_directory(
    root_dir: str,
    extensions: Optional[list[str]] = None,
    ignore_dirs: Optional[list[str]] = None,
) -> list[CodeChunk]:
    extensions = extensions or settings.chunk_extensions
    ignore_dirs = ignore_dirs or settings.ignore_dirs
    root = Path(root_dir)
    all_chunks: list[CodeChunk] = []

    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in ignore_dirs]

        for fname in filenames:
            fpath = Path(dirpath) / fname
            if fpath.suffix.lower() in extensions:
                chunks = chunk_file(str(fpath))
                all_chunks.extend(chunks)

    return all_chunks


def extract_imports(content: str, language: str) -> list[str]:
    imports = []
    lines = content.split("\n")
    for line in lines:
        stripped = line.strip()
        if language == "python":
            if stripped.startswith("import ") or stripped.startswith("from "):
                imports.append(stripped)
        elif language in ("javascript", "typescript"):
            if stripped.startswith("import ") or stripped.startswith("require("):
                imports.append(stripped)
        elif language == "java":
            if stripped.startswith("import "):
                imports.append(stripped)
        elif language == "go":
            if stripped.startswith("import"):
                imports.append(stripped)
    return imports
