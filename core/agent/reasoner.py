"""Multi-step reasoning engine."""
from __future__ import annotations

from typing import Optional

from models.schemas import AgentResponse
from core.agent.llm import LLMProvider
from core.agent.prompts import (
    SYSTEM_ANALYZE, SYSTEM_PLAN, SYSTEM_CRITIQUE, SYSTEM_MISSING_INFO,
)
from config.settings import settings


class Reasoner:
    def __init__(self, llm: Optional[LLMProvider] = None):
        self.llm = llm or LLMProvider()

    def analyze(self, query: str, context: str) -> AgentResponse:
        prompt = f"""<context>
{context}
</context>

Query: {query}"""

        try:
            response_text = self.llm.generate(prompt, system=SYSTEM_ANALYZE)
            return AgentResponse(
                answer=response_text,
                reasoning_steps=self._extract_steps(response_text),
                context_used=[query],
            )
        except Exception as e:
            return AgentResponse(
                answer=f"Error during analysis: {str(e)}",
                reasoning_steps=["Failed to generate response"],
            )

    def plan_action(self, query: str, context: str) -> AgentResponse:
        prompt = f"""<context>
{context}
</context>

Task: {query}"""

        try:
            response_text = self.llm.generate(prompt, system=SYSTEM_PLAN)
            return AgentResponse(
                answer=response_text,
                reasoning_steps=self._extract_steps(response_text),
                actions_taken=self._extract_actions(response_text),
            )
        except Exception as e:
            return AgentResponse(
                answer=f"Error during planning: {str(e)}",
                reasoning_steps=["Failed to generate plan"],
            )

    def self_critique(self, query: str, context: str, initial_answer: str) -> str:
        prompt = f"""<context>
{context}
</context>

Query: {query}

Initial answer:
{initial_answer}"""

        try:
            improved = self.llm.generate(prompt, system=SYSTEM_CRITIQUE)
            return improved if improved else initial_answer
        except Exception:
            return initial_answer

    def multi_step_reason(self, query: str, context: str) -> AgentResponse:
        step1 = self.analyze(query, context)

        missing_prompt = f"""Query: {query}

Analysis so far:
{step1.answer}

What information is missing?"""

        try:
            missing_info = self.llm.generate(missing_prompt, system=SYSTEM_MISSING_INFO)
        except Exception:
            missing_info = ""

        final_answer = self.self_critique(query, context, step1.answer)

        return AgentResponse(
            answer=final_answer,
            reasoning_steps=step1.reasoning_steps + [f"Gap analysis: {missing_info}"],
            context_used=step1.context_used,
        )

    def _extract_steps(self, text: str) -> list[str]:
        steps = []
        lines = text.split("\n")
        for line in lines:
            stripped = line.strip()
            if stripped and (stripped[0].isdigit() or stripped.startswith("-") or stripped.startswith("*")):
                steps.append(stripped)
        return steps[:10]

    def _extract_actions(self, text: str) -> list[str]:
        actions = []
        lines = text.split("\n")
        in_actions = False
        for line in lines:
            stripped = line.strip()
            if "action" in stripped.lower():
                in_actions = True
                continue
            if in_actions and stripped:
                if stripped.startswith("-") or stripped.startswith("*") or stripped[0].isdigit():
                    actions.append(stripped.lstrip("-* 0123456789."))
                elif not stripped.startswith("#"):
                    in_actions = False
        return actions[:10]
