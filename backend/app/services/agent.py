"""The agent loop: the model thinks, calls tools, sees the results, continues.

Runs until the model stops emitting tool calls or `max_steps` is reached.
Every step is recorded so the UI can visualise the trace.
"""

import logging
import time
from dataclasses import dataclass, field
from typing import Any, Awaitable, Callable

from ..openrouter import OpenRouterClient, OpenRouterError
from . import agent_tools, assertions as assertions_service
from .sandbox import DockerSandbox, SandboxConfig, SandboxError

log = logging.getLogger("arena.agent")

StepCallback = Callable[[list[dict[str, Any]]], Awaitable[None]]

DEFAULT_MAX_STEPS = 12
MAX_STEPS_CEILING = 60

AGENT_SYSTEM_SUFFIX = (
    "\n\nYou are working in a Linux sandbox at /workspace and have tools available. "
    "Use them instead of claiming results: actually write the files, actually run the "
    "code, and check the output. When you are done, reply without any further tool "
    "call, summarising briefly what you built and how you verified it."
)


@dataclass
class AgentResult:
    output_text: str
    messages: list[dict[str, Any]]
    steps: list[dict[str, Any]]
    prompt_tokens: int = 0
    completion_tokens: int = 0
    reasoning_tokens: int = 0
    total_tokens: int = 0
    cost_usd: float | None = None
    finish_reason: str | None = None
    error: str | None = None
    workspace: list[dict[str, Any]] = field(default_factory=list)
    turns: int = 0
    # Results of the sandbox assertions; the output ones are added by the runner.
    sandbox_assertion_results: list[dict[str, Any]] = field(default_factory=list)


def sandbox_config_from(agent_config: dict[str, Any]) -> SandboxConfig:
    cfg = agent_config or {}
    return SandboxConfig(
        network=bool(cfg.get("network", False)),
        memory_mb=int(cfg.get("memory_mb") or 1024),
        cpus=float(cfg.get("cpus") or 2.0),
        command_timeout_s=float(cfg.get("command_timeout_s") or 60.0),
    )


def max_steps_from(agent_config: dict[str, Any]) -> int:
    raw = (agent_config or {}).get("max_steps") or DEFAULT_MAX_STEPS
    try:
        return max(1, min(int(raw), MAX_STEPS_CEILING))
    except (TypeError, ValueError):
        return DEFAULT_MAX_STEPS


async def run_agent(
    *,
    client: OpenRouterClient,
    model_id: str,
    base_messages: list[dict[str, Any]],
    params: dict[str, Any],
    agent_config: dict[str, Any],
    sandbox_assertions: list[dict[str, Any]] | None = None,
    on_step: StepCallback | None = None,
) -> AgentResult:
    tools = agent_tools.resolve_tools((agent_config or {}).get("tools"))
    schemas = agent_tools.schemas_for(tools)
    by_name = {tool.name: tool for tool in tools}
    max_steps = max_steps_from(agent_config)

    messages = _with_agent_instructions(base_messages)
    steps: list[dict[str, Any]] = []
    result = AgentResult(output_text="", messages=messages, steps=steps)

    async def publish() -> None:
        """Flush the current trace so the UI can follow along live."""
        if on_step is None:
            return
        try:
            await on_step(steps)
        except Exception as exc:  # pragma: no cover -- display must never fail a run
            log.warning("Step callback failed: %s", exc)

    sandbox = DockerSandbox(sandbox_config_from(agent_config))
    try:
        await sandbox.start()
    except SandboxError as exc:
        result.error = str(exc)
        result.finish_reason = "sandbox_error"
        return result

    try:
        seeded = await sandbox.seed_files((agent_config or {}).get("setup_files") or [])
        if seeded:
            steps.append(
                {
                    "index": len(steps),
                    "type": "setup",
                    "files": [p.removeprefix("/workspace/") for p in seeded],
                }
            )
            await publish()

        for turn in range(max_steps):
            payload = {
                "model": model_id,
                "messages": messages,
                "stream": False,
                "usage": {"include": True},
                "tools": schemas,
                "tool_choice": "auto",
                **params,
            }

            started = time.perf_counter()
            try:
                response = await client.chat_completion(payload)
            except OpenRouterError as exc:
                result.error = exc.message
                result.finish_reason = "model_error"
                break
            latency_ms = int((time.perf_counter() - started) * 1000)

            choice = (response.get("choices") or [{}])[0]
            message = choice.get("message") or {}
            _accumulate_usage(result, response.get("usage") or {})
            result.turns = turn + 1

            content = _content_to_text(message.get("content"))
            reasoning = message.get("reasoning")
            tool_calls = message.get("tool_calls") or []

            # The assistant message must go back into the history unchanged,
            # otherwise the tool_call_ids of the follow-up messages stop matching.
            assistant_message: dict[str, Any] = {"role": "assistant", "content": content or None}
            if tool_calls:
                assistant_message["tool_calls"] = tool_calls
            messages.append(assistant_message)

            steps.append(
                {
                    "index": len(steps),
                    "type": "assistant",
                    "turn": turn + 1,
                    "content": content,
                    "reasoning": reasoning if isinstance(reasoning, str) else None,
                    "tool_calls": [
                        {
                            "id": call.get("id"),
                            "name": (call.get("function") or {}).get("name"),
                            "arguments": agent_tools.parse_arguments(
                                (call.get("function") or {}).get("arguments")
                            ),
                        }
                        for call in tool_calls
                    ],
                    "latency_ms": latency_ms,
                    "finish_reason": choice.get("finish_reason"),
                }
            )

            await publish()

            if not tool_calls:
                result.output_text = content
                result.finish_reason = choice.get("finish_reason") or "stop"
                break

            for call in tool_calls:
                await _handle_tool_call(call, by_name, sandbox, messages, steps)
                await publish()
        else:
            # Loop ran to completion -- the model never finished on its own.
            result.finish_reason = "max_steps"
            result.output_text = _last_assistant_text(steps)
            if not result.output_text:
                result.output_text = (
                    f"The agent hit the limit of {max_steps} steps without "
                    "producing a final answer."
                )

        # Assertions run while the container is still alive -- that is the whole
        # point of `command_exit_zero`: verify in the workspace the agent left behind.
        if sandbox_assertions:
            result.sandbox_assertion_results = await assertions_service.evaluate_sandbox(
                sandbox_assertions, sandbox
            )

        try:
            result.workspace = await sandbox.collect_workspace()
        except Exception as exc:  # pragma: no cover
            log.warning("Could not collect workspace: %s", exc)

    finally:
        await sandbox.stop()

    result.messages = messages
    result.steps = steps
    return result


async def _handle_tool_call(
    call: dict[str, Any],
    by_name: dict[str, agent_tools.Tool],
    sandbox: DockerSandbox,
    messages: list[dict[str, Any]],
    steps: list[dict[str, Any]],
) -> None:
    function = call.get("function") or {}
    name = function.get("name") or ""
    arguments = agent_tools.parse_arguments(function.get("arguments"))
    call_id = call.get("id") or name

    started = time.perf_counter()
    tool = by_name.get(name)
    if tool is None:
        outcome = agent_tools.ToolOutcome(
            f"Error: unknown tool '{name}'. Available: {', '.join(by_name)}.",
            ok=False,
        )
    else:
        outcome = await agent_tools.execute(tool, sandbox, arguments)
    duration_ms = int((time.perf_counter() - started) * 1000)

    messages.append(
        {
            "role": "tool",
            "tool_call_id": call_id,
            "name": name,
            "content": outcome.content,
        }
    )
    steps.append(
        {
            "index": len(steps),
            "type": "tool_result",
            "tool_call_id": call_id,
            "name": name,
            "arguments": arguments,
            "output": outcome.content,
            "ok": outcome.ok,
            "meta": outcome.meta or {},
            "duration_ms": duration_ms,
        }
    )


def _with_agent_instructions(base_messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    messages = [dict(m) for m in base_messages]
    for message in messages:
        if message.get("role") == "system":
            message["content"] = f"{message.get('content', '')}{AGENT_SYSTEM_SUFFIX}"
            return messages
    messages.insert(0, {"role": "system", "content": AGENT_SYSTEM_SUFFIX.strip()})
    return messages


def _accumulate_usage(result: AgentResult, usage: dict[str, Any]) -> None:
    result.prompt_tokens += _as_int(usage.get("prompt_tokens")) or 0
    result.completion_tokens += _as_int(usage.get("completion_tokens")) or 0
    result.total_tokens += _as_int(usage.get("total_tokens")) or 0
    details = usage.get("completion_tokens_details") or {}
    result.reasoning_tokens += _as_int(details.get("reasoning_tokens")) or 0

    cost = usage.get("cost")
    if isinstance(cost, (int, float)):
        result.cost_usd = (result.cost_usd or 0.0) + float(cost)


def _last_assistant_text(steps: list[dict[str, Any]]) -> str:
    for step in reversed(steps):
        if step.get("type") == "assistant" and step.get("content"):
            return str(step["content"])
    return ""


def _content_to_text(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = []
        for part in content:
            if isinstance(part, dict) and isinstance(part.get("text"), str):
                parts.append(part["text"])
            elif isinstance(part, str):
                parts.append(part)
        return "".join(parts)
    return str(content)


def _as_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(value)
    return None
