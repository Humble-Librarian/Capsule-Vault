"""BM25 keyword search."""
from __future__ import annotations

import math
import re
from collections import Counter, defaultdict
from typing import Optional

from models.schemas import CodeChunk, RetrievalResult


def _tokenize(text: str) -> list[str]:
    text = text.lower()
    tokens = re.findall(r"[a-z0-9_]+", text)
    return [t for t in tokens if len(t) > 1]


class BM25Index:
    def __init__(self, k1: float = 1.5, b: float = 0.75):
        self.k1 = k1
        self.b = b
        self.chunks: dict[str, CodeChunk] = {}
        self.doc_lengths: dict[str, int] = {}
        self.avg_doc_length: float = 0.0
        self.doc_count: int = 0
        self.term_freqs: dict[str, Counter] = defaultdict(Counter)
        self.doc_freqs: Counter = Counter()
        self.total_terms: int = 0

    def add_chunks(self, chunks: list[CodeChunk]) -> None:
        for chunk in chunks:
            self.add_chunk(chunk)

    def add_chunk(self, chunk: CodeChunk) -> None:
        self.chunks[chunk.id] = chunk

        text = f"{chunk.name} {chunk.summary} {chunk.code} {chunk.file_path}"
        tokens = _tokenize(text)
        self.doc_lengths[chunk.id] = len(tokens)
        self.doc_count += 1
        self.total_terms += len(tokens)

        tf = Counter(tokens)
        self.term_freqs[chunk.id] = tf

        seen_tokens = set()
        for token in tokens:
            if token not in seen_tokens:
                self.doc_freqs[token] += 1
                seen_tokens.add(token)

        if self.doc_count > 0:
            self.avg_doc_length = self.total_terms / self.doc_count

    def _idf(self, term: str) -> float:
        df = self.doc_freqs.get(term, 0)
        if df == 0:
            return 0.0
        return math.log((self.doc_count - df + 0.5) / (df + 0.5) + 1.0)

    def _score(self, doc_id: str, query_tokens: list[str]) -> float:
        score = 0.0
        tf = self.term_freqs.get(doc_id, Counter())
        doc_len = self.doc_lengths.get(doc_id, 0)

        for token in query_tokens:
            if token not in tf:
                continue
            term_freq = tf[token]
            idf = self._idf(token)
            numerator = term_freq * (self.k1 + 1)
            denominator = term_freq + self.k1 * (1 - self.b + self.b * doc_len / max(self.avg_doc_length, 1))
            score += idf * (numerator / denominator)

        return score

    def search(self, query: str, top_k: int = 20) -> list[RetrievalResult]:
        query_tokens = _tokenize(query)
        if not query_tokens:
            return []

        scores = []
        for doc_id in self.chunks:
            score = self._score(doc_id, query_tokens)
            if score > 0:
                scores.append((doc_id, score))

        scores.sort(key=lambda x: x[1], reverse=True)

        results = []
        for doc_id, score in scores[:top_k]:
            chunk = self.chunks.get(doc_id)
            if chunk:
                results.append(RetrievalResult(chunk=chunk, score=score, source="keyword"))

        return results

    def clear(self) -> None:
        self.chunks.clear()
        self.doc_lengths.clear()
        self.term_freqs.clear()
        self.doc_freqs.clear()
        self.doc_count = 0
        self.total_terms = 0
        self.avg_doc_length = 0.0
