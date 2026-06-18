"""ContextVault CLI - Context-aware coding agent."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

# Add project root to path
_project_root = str(Path(__file__).parent.parent)
if _project_root not in sys.path:
    sys.path.insert(0, _project_root)

from core.agent.orchestrator import Orchestrator
from config.settings import Settings


def format_response(response, verbose: bool = False) -> str:
    parts = []
    parts.append(response.answer)

    if verbose and response.reasoning_steps:
        parts.append("\n--- Reasoning Steps ---")
        for step in response.reasoning_steps:
            parts.append(f"  {step}")

    if verbose and response.actions_taken:
        parts.append("\n--- Actions ---")
        for action in response.actions_taken:
            parts.append(f"  {action}")

    return "\n".join(parts)


def cmd_init(args):
    project_root = args.path or "."
    print(f"Initializing ContextVault for: {project_root}")

    def progress(msg):
        print(f"  {msg}")

    orch = Orchestrator(project_root)
    stats = orch.init_project(progress_callback=progress)

    print(f"\nDone! Indexed {stats['total_chunks']} chunks from {stats['files_indexed']} files.")
    print(f"Graph has {stats['dependencies']} dependency edges.")


def cmd_ask(args):
    orch = Orchestrator(args.path or ".")
    print(f"Query: {args.question}\n")

    response = orch.ask(args.question)
    print(format_response(response, verbose=args.verbose))


def cmd_do(args):
    orch = Orchestrator(args.path or ".")
    print(f"Task: {args.task}\n")

    response = orch.do(args.task)
    print(format_response(response, verbose=args.verbose))


def cmd_why(args):
    orch = Orchestrator(args.path or ".")
    print(f"Topic: {args.topic}\n")

    response = orch.why(args.topic)
    print(format_response(response, verbose=args.verbose))


def cmd_undo(args):
    orch = Orchestrator(args.path or ".")
    result = orch.undo()

    if result:
        print(f"Undone: {result['description']}")
        print(f"Files reverted: {', '.join(result['files_reverted'])}")
    else:
        print("Nothing to undo.")


def cmd_status(args):
    orch = Orchestrator(args.path or ".")
    status = orch.status()

    print("ContextVault Status")
    print("=" * 40)
    print(f"Project root: {status['project_root']}")
    print(f"Indexed: {status['indexed']}")

    if status["indexed"]:
        print(f"Total chunks: {status.get('total_chunks', 0)}")
        print(f"Files indexed: {status.get('files_indexed', 0)}")

    print(f"Memory entries: {status['memory_entries']}")

    mem_stats = status.get("memory_stats", {})
    if mem_stats.get("count", 0) > 0:
        print(f"  Avg importance: {mem_stats.get('avg_importance', 0):.2f}")
        print(f"  Total accesses: {mem_stats.get('total_accesses', 0)}")
        print(f"  Files referenced: {mem_stats.get('files_referenced', 0)}")


def main():
    parser = argparse.ArgumentParser(
        prog="contextvault",
        description="Context-Aware CLI Coding Agent",
    )
    parser.add_argument("--path", "-p", default=".", help="Project root path")

    subparsers = parser.add_subparsers(dest="command", help="Available commands")

    init_parser = subparsers.add_parser("init", help="Index the codebase")
    init_parser.add_argument("path", nargs="?", default=".", help="Project root")

    ask_parser = subparsers.add_parser("ask", help="Ask a question about the codebase")
    ask_parser.add_argument("question", help="Your question")
    ask_parser.add_argument("--verbose", "-v", action="store_true", help="Show reasoning steps")
    ask_parser.add_argument("--path", "-p", default=".", help="Project root")

    do_parser = subparsers.add_parser("do", help="Perform a task")
    do_parser.add_argument("task", help="Task description")
    do_parser.add_argument("--verbose", "-v", action="store_true", help="Show reasoning steps")
    do_parser.add_argument("--path", "-p", default=".", help="Project root")

    why_parser = subparsers.add_parser("why", help="Explain a past decision")
    why_parser.add_argument("topic", help="What to explain")
    why_parser.add_argument("--path", "-p", default=".", help="Project root")

    subparsers.add_parser("undo", help="Revert the last action")
    subparsers.add_parser("status", help="Show system status")

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    commands = {
        "init": cmd_init,
        "ask": cmd_ask,
        "do": cmd_do,
        "why": cmd_why,
        "undo": cmd_undo,
        "status": cmd_status,
    }

    cmd_func = commands.get(args.command)
    if cmd_func:
        cmd_func(args)
    else:
        parser.print_help()
        sys.exit(1)


if __name__ == "__main__":
    main()
