"""Memory storage with importance scoring."""
from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Optional

from models.schemas import MemoryEntry
from config.settings import settings


class MemoryStore:
    def __init__(self, persist_path: Optional[str] = None):
        self.persist_path = Path(persist_path or settings.memory.persist_path)
        self.entries: dict[str, MemoryEntry] = {}
        self._load()

    def _load(self) -> None:
        entries_file = self.persist_path / "entries.json"
        if entries_file.exists():
            with open(entries_file) as f:
                data = json.load(f)
            self.entries = {k: MemoryEntry.from_dict(v) for k, v in data.items()}

    def _save(self) -> None:
        self.persist_path.mkdir(parents=True, exist_ok=True)
        entries_file = self.persist_path / "entries.json"
        data = {k: e.to_dict() for k, e in self.entries.items()}
        with open(entries_file, "w") as f:
            json.dump(data, f, indent=2)

    def add(
        self,
        decision: str,
        reason: str = "",
        files: Optional[list[str]] = None,
        importance: float = 0.5,
        tags: Optional[list[str]] = None,
    ) -> MemoryEntry:
        entry = MemoryEntry(
            decision=decision,
            reason=reason,
            files=files or [],
            importance=importance,
            tags=tags or [],
        )
        self.entries[entry.id] = entry
        self._enforce_limit()
        self._save()
        return entry

    def search(self, query: str, top_k: int = 5) -> list[MemoryEntry]:
        query_lower = query.lower()
        query_tokens = set(query_lower.split())

        scored = []
        for entry in self.entries.values():
            score = self._score_entry(entry, query_tokens)
            if score > 0:
                scored.append((entry, score))

        scored.sort(key=lambda x: x[1], reverse=True)
        return [entry for entry, _ in scored[:top_k]]

    def search_by_files(self, file_path: str) -> list[MemoryEntry]:
        results = []
        for entry in self.entries.values():
            if file_path in entry.files:
                results.append(entry)
        results.sort(key=lambda e: e.timestamp, reverse=True)
        return results

    def search_by_tags(self, tags: list[str]) -> list[MemoryEntry]:
        tag_set = set(tags)
        results = []
        for entry in self.entries.values():
            if tag_set.intersection(entry.tags):
                results.append(entry)
        return results

    def get_recent(self, limit: int = 10) -> list[MemoryEntry]:
        sorted_entries = sorted(
            self.entries.values(),
            key=lambda e: e.timestamp,
            reverse=True,
        )
        return sorted_entries[:limit]

    def get_important(self, limit: int = 10) -> list[MemoryEntry]:
        for entry in self.entries.values():
            entry.importance = self._recalculate_importance(entry)

        sorted_entries = sorted(
            self.entries.values(),
            key=lambda e: e.importance,
            reverse=True,
        )
        return sorted_entries[:limit]

    def update_importance(self, entry_id: str, importance: float) -> Optional[MemoryEntry]:
        entry = self.entries.get(entry_id)
        if entry:
            entry.importance = max(0.0, min(1.0, importance))
            self._save()
        return entry

    def touch(self, entry_id: str) -> Optional[MemoryEntry]:
        entry = self.entries.get(entry_id)
        if entry:
            entry.access_count += 1
            self._save()
        return entry

    def delete(self, entry_id: str) -> bool:
        if entry_id in self.entries:
            del self.entries[entry_id]
            self._save()
            return True
        return False

    def count(self) -> int:
        return len(self.entries)

    def _score_entry(self, entry: MemoryEntry, query_tokens: set[str]) -> float:
        text = f"{entry.decision} {entry.reason} {' '.join(entry.tags)}".lower()
        text_tokens = set(text.split())

        token_overlap = len(query_tokens & text_tokens)
        if token_overlap == 0:
            for qt in query_tokens:
                for tt in text_tokens:
                    if qt in tt or tt in qt:
                        token_overlap += 0.5

        recency = self._recency_score(entry)
        frequency = min(entry.access_count / 10.0, 1.0)

        score = (
            token_overlap * settings.memory.impact_weight +
            recency * settings.memory.recency_weight +
            frequency * settings.memory.frequency_weight
        )

        return score

    def _recency_score(self, entry: MemoryEntry) -> float:
        age_hours = (time.time() - entry.timestamp) / 3600
        decay = settings.memory.importance_decay
        return decay ** (age_hours / 24)

    def _recalculate_importance(self, entry: MemoryEntry) -> float:
        base = entry.importance
        recency = self._recency_score(entry)
        frequency = min(entry.access_count / 10.0, 1.0)

        return (
            base * 0.4 +
            recency * 0.3 +
            frequency * 0.3
        )

    def _enforce_limit(self) -> None:
        if len(self.entries) <= settings.memory.max_entries:
            return

        sorted_entries = sorted(
            self.entries.items(),
            key=lambda x: self._recalculate_importance(x[1]),
        )

        to_remove = len(self.entries) - settings.memory.max_entries
        for i in range(to_remove):
            entry_id = sorted_entries[i][0]
            del self.entries[entry_id]

    def clear(self) -> None:
        self.entries.clear()
        self._save()

    def get_stats(self) -> dict:
        entries = list(self.entries.values())
        if not entries:
            return {"count": 0}

        return {
            "count": len(entries),
            "avg_importance": sum(e.importance for e in entries) / len(entries),
            "total_accesses": sum(e.access_count for e in entries),
            "files_referenced": len(set(f for e in entries for f in e.files)),
            "tags_used": len(set(t for e in entries for t in e.tags)),
        }
