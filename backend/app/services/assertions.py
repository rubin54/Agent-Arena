"""Checkable conditions that turn a comparison into a benchmark.

Two families:

* output assertions -- pure functions over the final answer and the run metrics.
* sandbox assertions -- need the agent's container and therefore run while it is
  still alive, before `DockerSandbox.stop()`.

Every assertion evaluates to one result dict:
`{"type", "label", "passed", "detail"}`. An assertion that cannot be evaluated
(wrong task kind, missing data) counts as failed with an explanatory detail --
silently passing would make a benchmark lie.
"""

import json
import re
from typing import Any

import jsonschema

from .sandbox import DockerSandbox, SandboxError, resolve_path

# Assertions that need a live container.
SANDBOX_TYPES = {"file_exists", "file_contains", "command_exit_zero"}

OUTPUT_TYPES = {
    "contains",
    "not_contains",
    "regex",
    "is_json",
    "json_schema",
    "min_length",
    "max_length",
    "max_cost_usd",
    "max_latency_ms",
    "max_steps",
}

ALL_TYPES = SANDBOX_TYPES | OUTPUT_TYPES

# Shown in the UI so the editor can build a form per type.
CATALOG: list[dict[str, Any]] = [
    {
        "type": "contains",
        "label": "Output contains",
        "fields": ["value", "case_sensitive"],
        "scope": "any",
        "description": "The final answer contains the given text.",
    },
    {
        "type": "not_contains",
        "label": "Output does not contain",
        "fields": ["value", "case_sensitive"],
        "scope": "any",
        "description": "The final answer must not contain the given text.",
    },
    {
        "type": "regex",
        "label": "Output matches regex",
        "fields": ["pattern"],
        "scope": "any",
        "description": "A Python regular expression matches the final answer.",
    },
    {
        "type": "is_json",
        "label": "Output is valid JSON",
        "fields": [],
        "scope": "any",
        "description": "The answer parses as JSON; a single ```json fence is unwrapped first.",
    },
    {
        "type": "json_schema",
        "label": "Output matches the JSON schema",
        "fields": [],
        "scope": "any",
        "description": "Validates against the JSON schema defined on the task.",
    },
    {
        "type": "min_length",
        "label": "Minimum length",
        "fields": ["value"],
        "scope": "any",
        "description": "The answer has at least this many characters.",
    },
    {
        "type": "max_length",
        "label": "Maximum length",
        "fields": ["value"],
        "scope": "any",
        "description": "The answer has at most this many characters.",
    },
    {
        "type": "max_cost_usd",
        "label": "Cost budget (USD)",
        "fields": ["value"],
        "scope": "any",
        "description": "The run item cost at most this much.",
    },
    {
        "type": "max_latency_ms",
        "label": "Latency budget (ms)",
        "fields": ["value"],
        "scope": "any",
        "description": "The run item finished within this time.",
    },
    {
        "type": "max_steps",
        "label": "Maximum agent steps",
        "fields": ["value"],
        "scope": "agent",
        "description": "The agent needed at most this many turns.",
    },
    {
        "type": "file_exists",
        "label": "File exists",
        "fields": ["path"],
        "scope": "agent",
        "description": "The file exists in the workspace when the agent is done.",
    },
    {
        "type": "file_contains",
        "label": "File contains",
        "fields": ["path", "value"],
        "scope": "agent",
        "description": "The file exists and contains the given text.",
    },
    {
        "type": "command_exit_zero",
        "label": "Command exits 0",
        "fields": ["command"],
        "scope": "agent",
        "description": "Runs the command in the finished workspace and requires exit code 0.",
    },
]

_FENCE_RE = re.compile(r"^\s*```[a-zA-Z0-9_+-]*\r?\n([\s\S]*?)\r?\n?```\s*$")


def _unwrap_fence(text: str) -> str:
    match = _FENCE_RE.match(text or "")
    return match.group(1) if match else (text or "")


def describe(assertion: dict[str, Any]) -> str:
    """Short human-readable label, used in the UI and in results."""
    kind = assertion.get("type")
    value = assertion.get("value")
    path = assertion.get("path")
    match kind:
        case "contains":
            return f"contains {value!r}"
        case "not_contains":
            return f"does not contain {value!r}"
        case "regex":
            return f"matches /{assertion.get('pattern')}/"
        case "is_json":
            return "is valid JSON"
        case "json_schema":
            return "matches the JSON schema"
        case "min_length":
            return f"at least {value} characters"
        case "max_length":
            return f"at most {value} characters"
        case "max_cost_usd":
            return f"costs at most ${value}"
        case "max_latency_ms":
            return f"finishes within {value} ms"
        case "max_steps":
            return f"uses at most {value} steps"
        case "file_exists":
            return f"{path} exists"
        case "file_contains":
            return f"{path} contains {value!r}"
        case "command_exit_zero":
            return f"`{assertion.get('command')}` exits 0"
        case _:
            return f"unknown assertion {kind!r}"


def _result(assertion: dict[str, Any], passed: bool, detail: str = "") -> dict[str, Any]:
    return {
        "type": assertion.get("type"),
        "label": assertion.get("label") or describe(assertion),
        "passed": passed,
        "detail": detail,
    }


def split(assertions: list[dict[str, Any]]) -> tuple[list[dict], list[dict]]:
    """(output assertions, sandbox assertions) in their original order."""
    output, sandbox = [], []
    for assertion in assertions or []:
        (sandbox if assertion.get("type") in SANDBOX_TYPES else output).append(assertion)
    return output, sandbox


# --------------------------------------------------------------------- Output


def evaluate_output(
    assertions: list[dict[str, Any]],
    *,
    output_text: str | None,
    json_schema: dict[str, Any] | None = None,
    cost_usd: float | None = None,
    latency_ms: int | None = None,
    steps_used: int | None = None,
) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    text = output_text or ""

    for assertion in assertions or []:
        kind = assertion.get("type")
        value = assertion.get("value")
        try:
            match kind:
                case "contains" | "not_contains":
                    needle = str(value or "")
                    haystack = text
                    if not assertion.get("case_sensitive"):
                        needle, haystack = needle.lower(), haystack.lower()
                    found = needle in haystack
                    want = kind == "contains"
                    results.append(
                        _result(
                            assertion,
                            found is want,
                            "found" if found else "not found",
                        )
                    )

                case "regex":
                    pattern = str(assertion.get("pattern") or "")
                    match = re.search(pattern, text, re.MULTILINE)
                    results.append(
                        _result(
                            assertion,
                            match is not None,
                            f"matched {match.group(0)[:80]!r}" if match else "no match",
                        )
                    )

                case "is_json":
                    parsed = _try_json(text)
                    results.append(
                        _result(
                            assertion,
                            parsed is not None,
                            "parsed" if parsed is not None else "not parseable as JSON",
                        )
                    )

                case "json_schema":
                    if not json_schema:
                        results.append(
                            _result(assertion, False, "the task defines no JSON schema")
                        )
                    else:
                        parsed = _try_json(text)
                        if parsed is None:
                            results.append(_result(assertion, False, "output is not JSON"))
                        else:
                            try:
                                jsonschema.validate(parsed, json_schema)
                                results.append(_result(assertion, True, "valid"))
                            except jsonschema.ValidationError as exc:
                                path = "/".join(str(p) for p in exc.absolute_path) or "(root)"
                                results.append(
                                    _result(assertion, False, f"{path}: {exc.message[:200]}")
                                )

                case "min_length":
                    results.append(
                        _result(assertion, len(text) >= int(value), f"{len(text)} characters")
                    )

                case "max_length":
                    results.append(
                        _result(assertion, len(text) <= int(value), f"{len(text)} characters")
                    )

                case "max_cost_usd":
                    if cost_usd is None:
                        results.append(_result(assertion, False, "no cost reported"))
                    else:
                        results.append(
                            _result(assertion, cost_usd <= float(value), f"${cost_usd:.5f}")
                        )

                case "max_latency_ms":
                    if latency_ms is None:
                        results.append(_result(assertion, False, "no latency recorded"))
                    else:
                        results.append(
                            _result(assertion, latency_ms <= int(value), f"{latency_ms} ms")
                        )

                case "max_steps":
                    if steps_used is None:
                        results.append(
                            _result(assertion, False, "only available for agent tasks")
                        )
                    else:
                        results.append(
                            _result(assertion, steps_used <= int(value), f"{steps_used} steps")
                        )

                case _:
                    results.append(_result(assertion, False, f"unknown type {kind!r}"))

        except (TypeError, ValueError, re.error) as exc:
            results.append(_result(assertion, False, f"invalid assertion: {exc}"))

    return results


def _try_json(text: str) -> Any | None:
    candidate = _unwrap_fence(text).strip()
    if not candidate:
        return None
    try:
        return json.loads(candidate)
    except json.JSONDecodeError:
        return None


# --------------------------------------------------------------------- Sandbox


async def evaluate_sandbox(
    assertions: list[dict[str, Any]], sandbox: DockerSandbox
) -> list[dict[str, Any]]:
    """Run the container-dependent checks. Must happen before the sandbox stops."""
    results: list[dict[str, Any]] = []

    for assertion in assertions or []:
        kind = assertion.get("type")
        path = str(assertion.get("path") or "")
        try:
            match kind:
                case "file_exists":
                    target = resolve_path(path)
                    check = await sandbox.exec(f'test -f "{target}" && echo yes || echo no', timeout=20)
                    ok = check.stdout.strip() == "yes"
                    results.append(_result(assertion, ok, "exists" if ok else "missing"))

                case "file_contains":
                    needle = str(assertion.get("value") or "")
                    try:
                        content = await sandbox.read_file(path)
                    except SandboxError as exc:
                        results.append(_result(assertion, False, str(exc)))
                        continue
                    found = needle in content
                    results.append(
                        _result(assertion, found, "found" if found else "not found in file")
                    )

                case "command_exit_zero":
                    command = str(assertion.get("command") or "")
                    if not command.strip():
                        results.append(_result(assertion, False, "no command given"))
                        continue
                    run = await sandbox.exec(command)
                    detail = f"exit {run.exit_code}"
                    tail = (run.stderr or run.stdout or "").strip().splitlines()
                    if tail:
                        detail += f" — {tail[-1][:160]}"
                    results.append(_result(assertion, run.exit_code == 0, detail))

                case _:
                    results.append(_result(assertion, False, f"unknown type {kind!r}"))

        except SandboxError as exc:
            results.append(_result(assertion, False, f"sandbox error: {exc}"))

    return results


def overall(results: list[dict[str, Any]]) -> bool | None:
    """None when nothing was checked -- that is not the same as 'passed'."""
    if not results:
        return None
    return all(r.get("passed") for r in results)


def reorder(
    assertions: list[dict[str, Any]], results_by_assertion: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Restore the task's original assertion order after the split."""
    remaining = list(results_by_assertion)
    ordered: list[dict[str, Any]] = []
    for assertion in assertions or []:
        label = assertion.get("label") or describe(assertion)
        for index, result in enumerate(remaining):
            if result.get("label") == label and result.get("type") == assertion.get("type"):
                ordered.append(remaining.pop(index))
                break
    ordered.extend(remaining)
    return ordered
