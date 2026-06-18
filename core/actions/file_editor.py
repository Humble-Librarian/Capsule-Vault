"""Safe file editing with diff application and formatting preservation."""
from __future__ import annotations

import difflib
import json
from pathlib import Path
from typing import Optional

from models.schemas import UndoRecord


class FileEditor:
    def __init__(self, project_root: str = "."):
        self.project_root = Path(project_root)
        self.undo_stack: list[UndoRecord] = []

    def read_file(self, file_path: str) -> str:
        full_path = self.project_root / file_path
        if not full_path.exists():
            raise FileNotFoundError(f"File not found: {file_path}")
        with open(full_path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()

    def write_file(self, file_path: str, content: str) -> UndoRecord:
        full_path = self.project_root / file_path
        previous_state = ""
        if full_path.exists():
            with open(full_path, "r", encoding="utf-8", errors="replace") as f:
                previous_state = f.read()

        full_path.parent.mkdir(parents=True, exist_ok=True)
        with open(full_path, "w", encoding="utf-8") as f:
            f.write(content)

        record = UndoRecord(
            files_changed=[file_path],
            previous_states={file_path: previous_state},
            description=f"Write to {file_path}",
        )
        self.undo_stack.append(record)
        return record

    def apply_diff(self, file_path: str, diff: str) -> UndoRecord:
        current = self.read_file(file_path)
        new_content = self._apply_unified_diff(current, diff)

        record = self.write_file(file_path, new_content)
        record.description = f"Apply diff to {file_path}"
        return record

    def replace_in_file(self, file_path: str, old_text: str, new_text: str) -> UndoRecord:
        current = self.read_file(file_path)
        if old_text not in current:
            raise ValueError(f"Text not found in {file_path}")

        new_content = current.replace(old_text, new_text, 1)
        return self.write_file(file_path, new_content)

    def insert_at_line(self, file_path: str, line_number: int, text: str) -> UndoRecord:
        current = self.read_file(file_path)
        lines = current.split("\n")
        insert_idx = max(0, min(line_number - 1, len(lines)))
        new_lines = lines[:insert_idx] + text.split("\n") + lines[insert_idx:]
        return self.write_file(file_path, "\n".join(new_lines))

    def delete_lines(self, file_path: str, start_line: int, end_line: int) -> UndoRecord:
        current = self.read_file(file_path)
        lines = current.split("\n")
        new_lines = lines[:start_line - 1] + lines[end_line:]
        return self.write_file(file_path, "\n".join(new_lines))

    def undo(self) -> Optional[UndoRecord]:
        if not self.undo_stack:
            return None

        record = self.undo_stack.pop()
        for file_path, previous_state in record.previous_states.items():
            full_path = self.project_root / file_path
            full_path.parent.mkdir(parents=True, exist_ok=True)
            with open(full_path, "w", encoding="utf-8") as f:
                f.write(previous_state)

        return record

    def generate_diff(self, old_content: str, new_content: str, file_path: str = "") -> str:
        old_lines = old_content.splitlines(keepends=True)
        new_lines = new_content.splitlines(keepends=True)
        diff = difflib.unified_diff(
            old_lines, new_lines,
            fromfile=f"a/{file_path}",
            tofile=f"b/{file_path}",
        )
        return "".join(diff)

    def _apply_unified_diff(self, original: str, diff: str) -> str:
        original_lines = original.splitlines(keepends=True)
        diff_lines = diff.splitlines(keepends=True)

        result = []
        orig_idx = 0

        for line in diff_lines:
            if line.startswith("@@"):
                continue
            elif line.startswith("+"):
                result.append(line[1:])
            elif line.startswith("-"):
                if orig_idx < len(original_lines):
                    orig_idx += 1
            else:
                if orig_idx < len(original_lines):
                    result.append(original_lines[orig_idx])
                    orig_idx += 1

        while orig_idx < len(original_lines):
            result.append(original_lines[orig_idx])
            orig_idx += 1

        return "".join(result)

    def get_undo_history(self) -> list[dict]:
        return [
            {
                "action_id": r.action_id,
                "timestamp": r.timestamp,
                "files_changed": r.files_changed,
                "description": r.description,
            }
            for r in self.undo_stack
        ]
