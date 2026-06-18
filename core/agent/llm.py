"""LLM integration for reasoning, rewriting, and summarization."""
from __future__ import annotations

import os
from typing import Optional, Callable

from config.settings import settings


class LLMProvider:
    def __init__(self, provider: Optional[str] = None, model: Optional[str] = None):
        self.provider = provider or settings.llm.provider
        self.model = model or settings.llm.model
        self._client = None

    def _get_client(self):
        if self._client is not None:
            return self._client

        if self.provider in ("openai", "groq"):
            try:
                from openai import OpenAI
                api_key = os.environ.get(settings.llm.api_key_env, "")
                base_url = settings.llm.base_url if self.provider == "groq" else None
                kwargs = {"api_key": api_key}
                if base_url:
                    kwargs["base_url"] = base_url
                self._client = OpenAI(**kwargs)
            except ImportError:
                raise ImportError("openai package not installed. Run: pip install openai")
        elif self.provider == "ollama":
            try:
                import httpx
                self._client = httpx.Client(base_url="http://localhost:11434")
            except ImportError:
                raise ImportError("httpx package not installed. Run: pip install httpx")
        else:
            raise ValueError(f"Unknown provider: {self.provider}")

        return self._client

    def generate(self, prompt: str, system: str = "", temperature: float = None) -> str:
        temperature = temperature or settings.llm.temperature

        if self.provider in ("openai", "groq"):
            return self._openai_compatible_generate(prompt, system, temperature)
        elif self.provider == "ollama":
            return self._ollama_generate(prompt, system, temperature)
        return ""

    def _openai_compatible_generate(self, prompt: str, system: str, temperature: float) -> str:
        client = self._get_client()
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        response = client.chat.completions.create(
            model=self.model,
            messages=messages,
            temperature=temperature,
            max_tokens=settings.llm.max_tokens,
        )
        return response.choices[0].message.content or ""

    def _ollama_generate(self, prompt: str, system: str, temperature: float) -> str:
        client = self._get_client()
        data = {
            "model": self.model,
            "messages": [],
            "stream": False,
            "options": {"temperature": temperature},
        }
        if system:
            data["messages"].append({"role": "system", "content": system})
        data["messages"].append({"role": "user", "content": prompt})

        response = client.post("/api/chat", json=data)
        result = response.json()
        return result.get("message", {}).get("content", "")


def create_llm_call(provider: Optional[str] = None, model: Optional[str] = None) -> Callable[[str], str]:
    llm = LLMProvider(provider, model)

    def llm_call(prompt: str) -> str:
        try:
            return llm.generate(prompt)
        except Exception:
            return ""

    return llm_call


def get_fallback_llm_call() -> Callable[[str], str]:
    return create_llm_call(settings.llm.fallback_provider, settings.llm.fallback_model)
