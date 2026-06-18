"""Query rewriting for better retrieval."""
from __future__ import annotations

import re
from typing import Optional

from models.schemas import QueryRewrite


STOP_WORDS = {
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
    "have", "has", "had", "do", "does", "did", "will", "would", "could",
    "should", "may", "might", "shall", "can", "need", "dare", "ought",
    "used", "to", "of", "in", "for", "on", "with", "at", "by", "from",
    "up", "about", "into", "through", "during", "before", "after",
    "above", "below", "between", "out", "off", "over", "under", "again",
    "further", "then", "once", "here", "there", "when", "where", "why",
    "how", "all", "both", "each", "few", "more", "most", "other", "some",
    "such", "no", "nor", "not", "only", "own", "same", "so", "than",
    "too", "very", "just", "because", "as", "until", "while", "it",
    "its", "this", "that", "these", "those", "and", "but", "if", "or",
    "what", "which", "who", "whom", "i", "me", "my", "we", "our",
    "you", "your", "he", "him", "his", "she", "her", "they", "them",
    "their",
}

CODE_SYNONYMS = {
    "bug": ["error", "exception", "crash", "fault", "issue", "broken"],
    "fix": ["repair", "resolve", "patch", "correct", "solve"],
    "auth": ["authentication", "login", "signin", "session", "jwt", "token"],
    "api": ["endpoint", "route", "handler", "controller", "rest"],
    "db": ["database", "sql", "query", "table", "schema"],
    "ui": ["view", "component", "page", "template", "render"],
    "config": ["configuration", "settings", "env", "environment"],
    "test": ["spec", "test", "assertion", "mock"],
    "error": ["exception", "throw", "catch", "try", "error"],
    "async": ["promise", "await", "async", "future", "concurrent"],
}

INTENT_PATTERNS = {
    "explain": ["why", "how", "explain", "describe", "what does", "what is"],
    "find": ["find", "locate", "where is", "search for", "look for"],
    "fix": ["fix", "repair", "debug", "solve", "broken", "not working"],
    "create": ["create", "add", "new", "write", "implement", "build"],
    "modify": ["change", "update", "modify", "edit", "refactor", "improve"],
    "delete": ["delete", "remove", "clean", "purge"],
}


def rewrite_query(query: str, llm_call=None) -> QueryRewrite:
    if llm_call:
        prompt = f"""Rewrite this code-related query for better search retrieval.
Expand abbreviations, add technical synonyms, and extract key terms.

Query: {query}

Provide:
1. Rewritten query (2-3 sentences with expanded terms)
2. Key search terms (comma-separated)

Format:
REWRITE: <rewritten query>
KEYS: <term1>, <term2>, <term3>"""
        try:
            result = llm_call(prompt)
            if result:
                return _parse_llm_rewrite(query, result)
        except Exception:
            pass

    return _rule_based_rewrite(query)


def _parse_llm_rewrite(original: str, result: str) -> QueryRewrite:
    rewrite = ""
    keys = []

    for line in result.split("\n"):
        line = line.strip()
        if line.upper().startswith("REWRITE:"):
            rewrite = line[8:].strip()
        elif line.upper().startswith("KEYS:"):
            keys = [k.strip() for k in line[5:].split(",") if k.strip()]

    if not rewrite:
        rewrite = original
    if not keys:
        keys = _extract_keywords(original)

    return QueryRewrite(original=original, rewritten=rewrite, keywords=keys)


def _rule_based_rewrite(query: str) -> QueryRewrite:
    keywords = _extract_keywords(query)
    expanded = _expand_query(query, keywords)
    return QueryRewrite(original=query, rewritten=expanded, keywords=keywords)


def _extract_keywords(text: str) -> list[str]:
    words = re.findall(r"[a-zA-Z_][a-zA-Z0-9_]*", text.lower())
    keywords = [w for w in words if w not in STOP_WORDS and len(w) > 1]

    seen = set()
    unique = []
    for kw in keywords:
        if kw not in seen:
            seen.add(kw)
            unique.append(kw)

    expanded = []
    for kw in unique:
        expanded.append(kw)
        for syn_key, synonyms in CODE_SYNONYMS.items():
            if kw == syn_key or kw in synonyms:
                for s in synonyms:
                    if s != kw and s not in seen:
                        expanded.append(s)
                        seen.add(s)
                break

    return expanded[:20]


def _expand_query(query: str, keywords: list[str]) -> str:
    parts = [query.strip()]

    code_keywords = [k for k in keywords if any(
        k in syns or k == syn_key
        for syn_key, syns in CODE_SYNONYMS.items()
    )]
    if code_keywords:
        parts.append(" ".join(code_keywords[:5]))

    intent = _detect_intent(query)
    if intent:
        parts.append(intent)

    return " ".join(parts)


def _detect_intent(query: str) -> str:
    query_lower = query.lower()
    for intent, patterns in INTENT_PATTERNS.items():
        for pattern in patterns:
            if pattern in query_lower:
                return intent
    return ""
