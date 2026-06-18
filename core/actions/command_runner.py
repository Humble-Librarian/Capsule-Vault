"""Safe command execution with output capture."""
from __future__ import annotations

import subprocess
import os
import time
from dataclasses import dataclass
from typing import Optional
from pathlib import Path


@dataclass
class CommandResult:
    command: str
    stdout: str
    stderr: str
    returncode: int
    duration: float
    cwd: str

    @property
    def success(self) -> bool:
        return self.returncode == 0

    def to_dict(self) -> dict:
        return {
            "command": self.command,
            "stdout": self.stdout[-2000:],
            "stderr": self.stderr[-2000:],
            "returncode": self.returncode,
            "duration": self.duration,
            "cwd": self.cwd,
        }


class CommandRunner:
    def __init__(self, project_root: str = ".", timeout: int = 60):
        self.project_root = Path(project_root).resolve()
        self.timeout = timeout
        self.history: list[CommandResult] = []

    def run(
        self,
        command: str,
        cwd: Optional[str] = None,
        timeout: Optional[int] = None,
        env: Optional[dict[str, str]] = None,
    ) -> CommandResult:
        timeout = timeout or self.timeout
        working_dir = str(Path(cwd) if cwd else self.project_root)

        full_env = os.environ.copy()
        if env:
            full_env.update(env)

        start = time.time()
        try:
            result = subprocess.run(
                command,
                shell=True,
                cwd=working_dir,
                capture_output=True,
                text=True,
                timeout=timeout,
                env=full_env,
            )
            duration = time.time() - start

            cmd_result = CommandResult(
                command=command,
                stdout=result.stdout,
                stderr=result.stderr,
                returncode=result.returncode,
                duration=duration,
                cwd=working_dir,
            )
        except subprocess.TimeoutExpired:
            duration = time.time() - start
            cmd_result = CommandResult(
                command=command,
                stdout="",
                stderr=f"Command timed out after {timeout}s",
                returncode=-1,
                duration=duration,
                cwd=working_dir,
            )
        except Exception as e:
            duration = time.time() - start
            cmd_result = CommandResult(
                command=command,
                stdout="",
                stderr=str(e),
                returncode=-1,
                duration=duration,
                cwd=working_dir,
            )

        self.history.append(cmd_result)
        return cmd_result

    def run_safe(self, command: str, allowed_commands: Optional[list[str]] = None, **kwargs) -> CommandResult:
        if allowed_commands:
            base_cmd = command.split()[0] if command.split() else ""
            if base_cmd not in allowed_commands:
                return CommandResult(
                    command=command,
                    stdout="",
                    stderr=f"Command '{base_cmd}' not in allowed list: {allowed_commands}",
                    returncode=-1,
                    duration=0,
                    cwd=str(self.project_root),
                )

        dangerous = ["rm -rf", "sudo", "mkfs", "dd if=", "> /dev/"]
        for pattern in dangerous:
            if pattern in command.lower():
                return CommandResult(
                    command=command,
                    stdout="",
                    stderr=f"Blocked dangerous command pattern: {pattern}",
                    returncode=-1,
                    duration=0,
                    cwd=str(self.project_root),
                )

        return self.run(command, **kwargs)

    def get_history(self) -> list[dict]:
        return [r.to_dict() for r in self.history]
