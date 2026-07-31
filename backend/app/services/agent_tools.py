"""Tools an agent is allowed to call inside the sandbox.

The schemas are sent to OpenRouter as `tools` (OpenAI function format). Every tool
returns text -- exactly what goes back to the model as a `role: "tool"` message.
"""

import json
from dataclasses import dataclass
from typing import Any, Awaitable, Callable

from .sandbox import DockerSandbox, SandboxError

ToolHandler = Callable[[DockerSandbox, dict[str, Any]], Awaitable["ToolOutcome"]]


@dataclass
class ToolOutcome:
    content: str
    ok: bool = True
    meta: dict[str, Any] | None = None


@dataclass
class Tool:
    name: str
    label: str
    description: str
    parameters: dict[str, Any]
    handler: ToolHandler

    def schema(self) -> dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }


# --------------------------------------------------------------------- Handler


async def _bash(sandbox: DockerSandbox, args: dict[str, Any]) -> ToolOutcome:
    command = args.get("command")
    if not isinstance(command, str) or not command.strip():
        return ToolOutcome("Error: 'command' is missing or empty.", ok=False)

    timeout = args.get("timeout_seconds")
    result = await sandbox.exec(
        command, timeout=float(timeout) if isinstance(timeout, (int, float)) else None
    )

    parts = [f"exit_code: {result.exit_code}"]
    if result.stdout.strip():
        parts.append(f"stdout:\n{result.stdout.rstrip()}")
    if result.stderr.strip():
        parts.append(f"stderr:\n{result.stderr.rstrip()}")
    if not result.stdout.strip() and not result.stderr.strip():
        parts.append("(no output)")

    return ToolOutcome(
        "\n\n".join(parts),
        ok=result.ok,
        meta={
            "exit_code": result.exit_code,
            "timed_out": result.timed_out,
            "command": command,
        },
    )


async def _read_file(sandbox: DockerSandbox, args: dict[str, Any]) -> ToolOutcome:
    path = args.get("path")
    if not isinstance(path, str) or not path.strip():
        return ToolOutcome("Error: 'path' is missing.", ok=False)
    try:
        content = await sandbox.read_file(path)
    except SandboxError as exc:
        return ToolOutcome(f"Error: {exc}", ok=False, meta={"path": path})
    return ToolOutcome(content or "(file is empty)", meta={"path": path})


async def _write_file(sandbox: DockerSandbox, args: dict[str, Any]) -> ToolOutcome:
    path = args.get("path")
    content = args.get("content")
    if not isinstance(path, str) or not path.strip():
        return ToolOutcome("Error: 'path' is missing.", ok=False)
    if not isinstance(content, str):
        return ToolOutcome("Error: 'content' must be a string.", ok=False)
    try:
        target = await sandbox.write_file(path, content)
    except SandboxError as exc:
        return ToolOutcome(f"Error: {exc}", ok=False, meta={"path": path})
    lines = content.count("\n") + 1 if content else 0
    return ToolOutcome(
        f"Wrote {target} ({len(content)} characters, {lines} lines).",
        meta={"path": path, "bytes": len(content.encode('utf-8'))},
    )


async def _list_files(sandbox: DockerSandbox, args: dict[str, Any]) -> ToolOutcome:
    path = args.get("path") or "."
    try:
        listing = await sandbox.list_files(str(path))
    except SandboxError as exc:
        return ToolOutcome(f"Error: {exc}", ok=False, meta={"path": path})
    return ToolOutcome(listing, meta={"path": path})


# --------------------------------------------------------------------- Registry

TOOLS: dict[str, Tool] = {
    "bash": Tool(
        name="bash",
        label="Shell",
        description=(
            "Run a shell command in the sandbox (working directory /workspace). "
            "Available tools include python3, node, npm, git, curl, jq and rg. "
            "Returns exit_code, stdout and stderr."
        ),
        parameters={
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "The command to run, e.g. 'python3 main.py'.",
                },
                "timeout_seconds": {
                    "type": "number",
                    "description": "Optional time limit for this command.",
                },
            },
            "required": ["command"],
        },
        handler=_bash,
    ),
    "read_file": Tool(
        name="read_file",
        label="Read file",
        description="Read a file from the workspace and return its contents.",
        parameters={
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Path relative to /workspace, e.g. 'src/main.py'.",
                }
            },
            "required": ["path"],
        },
        handler=_read_file,
    ),
    "write_file": Tool(
        name="write_file",
        label="Write file",
        description=(
            "Write a file in the workspace, creating missing directories. "
            "Overwrites an existing file completely."
        ),
        parameters={
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "Path relative to /workspace."},
                "content": {"type": "string", "description": "The complete file contents."},
            },
            "required": ["path", "content"],
        },
        handler=_write_file,
    ),
    "list_files": Tool(
        name="list_files",
        label="List files",
        description=(
            "List the contents of a directory recursively. "
            "node_modules, .git, __pycache__ and .venv are skipped."
        ),
        parameters={
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Directory relative to /workspace, defaults to '.'.",
                }
            },
        },
        handler=_list_files,
    ),
}

DEFAULT_TOOLS = ["bash", "read_file", "write_file", "list_files"]


def resolve_tools(names: list[str] | None) -> list[Tool]:
    selected = [n for n in (names or DEFAULT_TOOLS) if n in TOOLS]
    return [TOOLS[name] for name in (selected or DEFAULT_TOOLS)]


def schemas_for(tools: list[Tool]) -> list[dict[str, Any]]:
    return [tool.schema() for tool in tools]


def parse_arguments(raw: Any) -> dict[str, Any]:
    """Models return `arguments` sometimes as a JSON string, sometimes as an object."""
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        if not raw.strip():
            return {}
        try:
            parsed = json.loads(raw)
        except json.JSONDecodeError:
            return {"__parse_error__": raw}
        return parsed if isinstance(parsed, dict) else {"value": parsed}
    return {}


async def execute(tool: Tool, sandbox: DockerSandbox, arguments: dict[str, Any]) -> ToolOutcome:
    if "__parse_error__" in arguments:
        return ToolOutcome(
            "Error: the arguments were not valid JSON. Please send them again.",
            ok=False,
        )
    try:
        return await tool.handler(sandbox, arguments)
    except SandboxError as exc:
        return ToolOutcome(f"Sandbox error: {exc}", ok=False)
    except Exception as exc:  # pragma: no cover -- a tool failure must not kill the loop
        return ToolOutcome(f"Unexpected error in tool '{tool.name}': {exc}", ok=False)
