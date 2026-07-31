import asyncio
import json
import logging
import time
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..db import SessionLocal
from ..models import ModelCatalogEntry, Run, RunItem
from ..openrouter import OpenRouterClient, OpenRouterError
from . import agent, assertions as assertions_service, settings_store, templating

log = logging.getLogger("arena.runner")

# Keys a task may never override. Everything else in the task's `params` object
# is passed through verbatim (e.g. `reasoning`, `provider`, `transforms`).
_RESERVED_PARAM_KEYS = {"model", "messages", "stream"}

_running: dict[uuid.UUID, asyncio.Task[None]] = {}


def is_running(run_id: uuid.UUID) -> bool:
    task = _running.get(run_id)
    return task is not None and not task.done()


def start_run(run_id: uuid.UUID) -> None:
    """Start a run in the background. The HTTP request returns immediately."""
    if is_running(run_id):
        return
    task = asyncio.create_task(_execute_run(run_id), name=f"run-{run_id}")
    _running[run_id] = task
    task.add_done_callback(lambda _t: _running.pop(run_id, None))


def cancel_run(run_id: uuid.UUID) -> bool:
    task = _running.get(run_id)
    if task and not task.done():
        task.cancel()
        return True
    return False


# --------------------------------------------------------------------------- Execution


async def _execute_run(run_id: uuid.UUID) -> None:
    settings = get_settings()
    try:
        async with SessionLocal() as session:
            run = await session.get(Run, run_id)
            if run is None:
                return
            run.status = "running"
            run.started_at = datetime.now(timezone.utc)
            await session.commit()

            result = await session.execute(
                select(RunItem.id).where(RunItem.run_id == run_id).order_by(RunItem.position)
            )
            item_ids = list(result.scalars().all())
            snapshot = dict(run.task_snapshot or {})
            values = dict(run.variable_values or {})

        # Agent runs spin up a container each, so they run less broadly in parallel.
        limit = (
            settings.agent_concurrency
            if snapshot.get("kind") == "agent"
            else settings.run_concurrency
        )
        semaphore = asyncio.Semaphore(max(1, limit))
        await asyncio.gather(
            *(_execute_item(item_id, snapshot, values, semaphore) for item_id in item_ids)
        )
        await _finalize(run_id)
    except asyncio.CancelledError:
        await _mark_cancelled(run_id)
        raise
    except Exception as exc:  # pragma: no cover - safety net
        log.exception("Run %s aborted", run_id)
        await _fail_run(run_id, str(exc))


async def _execute_item(
    item_id: uuid.UUID,
    snapshot: dict[str, Any],
    values: dict[str, Any],
    semaphore: asyncio.Semaphore,
) -> None:
    async with semaphore:
        async with SessionLocal() as session:
            item = await session.get(RunItem, item_id)
            if item is None or item.status not in ("pending",):
                return
            item.status = "running"
            item.started_at = datetime.now(timezone.utc)
            await session.commit()

            client = await settings_store.build_client(session)
            catalog_entry = await session.get(ModelCatalogEntry, item.model_id)
            pricing = _pricing_from_entry(catalog_entry)
            messages = _build_messages(snapshot, values)

            started = time.perf_counter()
            extra_results: list[dict[str, Any]] = []
            steps_used: int | None = None
            try:
                if snapshot.get("kind") == "agent":
                    extra_results, steps_used = await _execute_agent(
                        item, client, snapshot, messages, catalog_entry, pricing, started, session
                    )
                else:
                    await _execute_one_shot(item, client, snapshot, messages, pricing, started)
            except Exception as exc:  # pragma: no cover -- per-model safety net
                log.exception("Item %s failed", item_id)
                item.status = "failed"
                item.error = f"{type(exc).__name__}: {exc}"
                item.latency_ms = int((time.perf_counter() - started) * 1000)
                item.finished_at = datetime.now(timezone.utc)
                item.messages = messages

            # Always evaluated, including for failed items -- a benchmark that
            # silently skips its checks on failure would report the wrong thing.
            _apply_assertions(item, snapshot, extra_results=extra_results, steps_used=steps_used)
            await session.commit()


async def _execute_one_shot(
    item: RunItem,
    client: OpenRouterClient,
    snapshot: dict[str, Any],
    messages: list[dict[str, Any]],
    pricing: dict[str, float | None],
    started: float,
) -> None:
    payload = _build_payload(snapshot, item.model_id, messages)
    try:
        response = await client.chat_completion(payload)
    except OpenRouterError as exc:
        item.status = "failed"
        item.error = exc.message
        item.raw_response = exc.payload if isinstance(exc.payload, dict) else None
        item.latency_ms = int((time.perf_counter() - started) * 1000)
        item.finished_at = datetime.now(timezone.utc)
        item.messages = messages
        return

    latency_ms = int((time.perf_counter() - started) * 1000)
    _apply_response(item, response, messages, pricing, latency_ms)


async def _execute_agent(
    item: RunItem,
    client: OpenRouterClient,
    snapshot: dict[str, Any],
    messages: list[dict[str, Any]],
    catalog_entry: ModelCatalogEntry | None,
    pricing: dict[str, float | None],
    started: float,
    session: AsyncSession,
) -> tuple[list[dict[str, Any]], int | None]:
    # An agent run is pointless without tool support -- fail fast with a clear message
    # instead of letting the model hallucinate an answer it never worked for.
    if catalog_entry is not None and not _supports_tools(catalog_entry):
        item.status = "failed"
        item.error = (
            f"{item.model_id} does not support tool calling and cannot run agent tasks. "
            "Filter the catalog by the \"Tool Calling\" capability."
        )
        item.latency_ms = int((time.perf_counter() - started) * 1000)
        item.finished_at = datetime.now(timezone.utc)
        item.messages = messages
        return [], None

    params = {
        k: v
        for k, v in (snapshot.get("params") or {}).items()
        if k not in _RESERVED_PARAM_KEYS and v is not None and v != ""
    }

    async def publish_steps(steps: list[dict[str, Any]]) -> None:
        item.steps = list(steps)
        await session.commit()

    _, sandbox_assertions = assertions_service.split(snapshot.get("assertions") or [])

    result = await agent.run_agent(
        client=client,
        model_id=item.model_id,
        base_messages=messages,
        params=params,
        agent_config=snapshot.get("agent_config") or {},
        sandbox_assertions=sandbox_assertions,
        on_step=publish_steps,
    )

    item.messages = result.messages
    item.steps = result.steps
    item.output_text = result.output_text or None
    item.finish_reason = result.finish_reason
    item.prompt_tokens = result.prompt_tokens or None
    item.completion_tokens = result.completion_tokens or None
    item.reasoning_tokens = result.reasoning_tokens or None
    item.total_tokens = result.total_tokens or _sum_or_none(
        result.prompt_tokens, result.completion_tokens
    )
    item.cost_usd = (
        result.cost_usd
        if result.cost_usd is not None
        else _estimate_cost(result.prompt_tokens, result.completion_tokens, pricing)
    )
    item.latency_ms = int((time.perf_counter() - started) * 1000)
    item.raw_response = {
        "turns": result.turns,
        "workspace": result.workspace,
        "finish_reason": result.finish_reason,
    }
    item.finished_at = datetime.now(timezone.utc)

    if result.error:
        item.status = "failed"
        item.error = result.error
    elif not item.output_text:
        item.status = "failed"
        item.error = "The agent did not produce a final answer."
    else:
        item.status = "completed"

    return result.sandbox_assertion_results, result.turns


def _apply_assertions(
    item: RunItem,
    snapshot: dict[str, Any],
    *,
    extra_results: list[dict[str, Any]],
    steps_used: int | None,
) -> None:
    """Evaluate the task's assertions and set `assertion_results` / `passed`."""
    declared = snapshot.get("assertions") or []
    if not declared:
        item.assertion_results = []
        item.passed = None
        return

    output_assertions, sandbox_assertions = assertions_service.split(declared)
    output_results = assertions_service.evaluate_output(
        output_assertions,
        output_text=item.output_text,
        json_schema=snapshot.get("json_schema"),
        cost_usd=item.cost_usd,
        latency_ms=item.latency_ms,
        steps_used=steps_used,
    )

    # If the sandbox never came up, its checks have no result -- record them as failed
    # rather than dropping them, so the count still matches the task definition.
    missing = [
        {
            "type": a.get("type"),
            "label": a.get("label") or assertions_service.describe(a),
            "passed": False,
            "detail": "not evaluated (sandbox unavailable)",
        }
        for a in sandbox_assertions
    ][len(extra_results) :]

    combined = assertions_service.reorder(declared, [*output_results, *extra_results, *missing])
    item.assertion_results = combined
    # A model that errored out has not passed, whatever the individual checks say.
    item.passed = assertions_service.overall(combined) and item.status == "completed"


def _supports_tools(entry: ModelCatalogEntry) -> bool:
    return "tools" in (entry.supported_parameters or [])


def _apply_response(
    item: RunItem,
    response: dict[str, Any],
    messages: list[dict[str, Any]],
    pricing: dict[str, float | None],
    latency_ms: int,
) -> None:
    choices = response.get("choices") or []
    choice = choices[0] if choices else {}
    message = choice.get("message") or {}

    item.output_text = _content_to_text(message.get("content"))
    reasoning = message.get("reasoning")
    item.reasoning_text = reasoning if isinstance(reasoning, str) and reasoning else None
    item.finish_reason = choice.get("finish_reason") or choice.get("native_finish_reason")

    usage = response.get("usage") or {}
    prompt_tokens = _as_int(usage.get("prompt_tokens"))
    completion_tokens = _as_int(usage.get("completion_tokens"))
    total_tokens = _as_int(usage.get("total_tokens"))
    details = usage.get("completion_tokens_details") or {}
    reasoning_tokens = _as_int(details.get("reasoning_tokens"))

    item.prompt_tokens = prompt_tokens
    item.completion_tokens = completion_tokens
    item.reasoning_tokens = reasoning_tokens
    item.total_tokens = total_tokens or _sum_or_none(prompt_tokens, completion_tokens)

    # With `usage: {include: true}` OpenRouter reports what was actually billed.
    cost = usage.get("cost")
    item.cost_usd = (
        float(cost)
        if isinstance(cost, (int, float))
        else _estimate_cost(prompt_tokens, completion_tokens, pricing)
    )

    item.latency_ms = latency_ms
    item.raw_response = response
    item.messages = messages + [
        {
            "role": "assistant",
            "content": item.output_text or "",
            **({"reasoning": item.reasoning_text} if item.reasoning_text else {}),
        }
    ]
    item.status = "completed" if item.output_text else "failed"
    if item.status == "failed" and not item.error:
        item.error = "The model returned no text."
    item.finished_at = datetime.now(timezone.utc)


# --------------------------------------------------------------------------- Payload


def _build_messages(snapshot: dict[str, Any], values: dict[str, Any]) -> list[dict[str, Any]]:
    system_prompt = templating.render(snapshot.get("system_prompt") or "", values).strip()
    user_prompt = templating.render(snapshot.get("prompt_template") or "", values)

    messages: list[dict[str, Any]] = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": user_prompt})
    return messages


def _build_payload(
    snapshot: dict[str, Any], model_id: str, messages: list[dict[str, Any]]
) -> dict[str, Any]:
    params = {k: v for k, v in (snapshot.get("params") or {}).items() if k not in _RESERVED_PARAM_KEYS}
    params = {k: v for k, v in params.items() if v is not None and v != ""}

    payload: dict[str, Any] = {
        "model": model_id,
        "messages": messages,
        "stream": False,
        # Yields `usage.cost` -- the amount actually billed.
        "usage": {"include": True},
        **params,
    }

    json_schema = snapshot.get("json_schema")
    if snapshot.get("render_mode") == "json" and isinstance(json_schema, dict) and json_schema:
        payload["response_format"] = {
            "type": "json_schema",
            "json_schema": {
                "name": "task_output",
                "strict": True,
                "schema": json_schema,
            },
        }
    return payload


def _content_to_text(content: Any) -> str:
    if content is None:
        return ""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        # Multimodal responses arrive as a list of parts.
        parts: list[str] = []
        for part in content:
            if isinstance(part, dict):
                if isinstance(part.get("text"), str):
                    parts.append(part["text"])
            elif isinstance(part, str):
                parts.append(part)
        return "".join(parts)
    return json.dumps(content, ensure_ascii=False)


# --------------------------------------------------------------------------- Cost


def _pricing_from_entry(entry: ModelCatalogEntry | None) -> dict[str, float | None]:
    if entry is None:
        return {"prompt": None, "completion": None}
    return {"prompt": entry.price_prompt, "completion": entry.price_completion}


def _estimate_cost(
    prompt_tokens: int | None, completion_tokens: int | None, pricing: dict[str, float | None]
) -> float | None:
    p_price, c_price = pricing.get("prompt"), pricing.get("completion")
    # In OpenRouter -1 means "variable", which cannot be turned into a number.
    if p_price is None or c_price is None or p_price < 0 or c_price < 0:
        return None
    if prompt_tokens is None and completion_tokens is None:
        return None
    return (prompt_tokens or 0) * p_price + (completion_tokens or 0) * c_price


def _as_int(value: Any) -> int | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return int(value)
    return None


def _sum_or_none(*values: int | None) -> int | None:
    present = [v for v in values if v is not None]
    return sum(present) if present else None


# --------------------------------------------------------------------------- Finalisation


async def _finalize(run_id: uuid.UUID) -> None:
    async with SessionLocal() as session:
        run = await session.get(Run, run_id)
        if run is None:
            return
        statuses = await _item_statuses(session, run_id)
        if statuses and all(s == "failed" for s in statuses):
            run.status = "failed"
            run.error = "All models failed."
        else:
            run.status = "completed"
        run.finished_at = datetime.now(timezone.utc)
        await session.commit()


async def _fail_run(run_id: uuid.UUID, error: str) -> None:
    async with SessionLocal() as session:
        run = await session.get(Run, run_id)
        if run is None:
            return
        run.status = "failed"
        run.error = error
        run.finished_at = datetime.now(timezone.utc)
        await session.commit()


async def _mark_cancelled(run_id: uuid.UUID) -> None:
    # Deliberately not awaiting the just-cancelled task: own session, own shield.
    async def _do() -> None:
        async with SessionLocal() as session:
            run = await session.get(Run, run_id)
            if run is None:
                return
            result = await session.execute(select(RunItem).where(RunItem.run_id == run_id))
            for item in result.scalars().all():
                if item.status in ("pending", "running"):
                    item.status = "cancelled"
                    item.finished_at = datetime.now(timezone.utc)
            run.status = "cancelled"
            run.finished_at = datetime.now(timezone.utc)
            await session.commit()

    await asyncio.shield(asyncio.create_task(_do()))


async def _item_statuses(session: AsyncSession, run_id: uuid.UUID) -> list[str]:
    result = await session.execute(select(RunItem.status).where(RunItem.run_id == run_id))
    return list(result.scalars().all())


def build_client_preview(
    snapshot: dict[str, Any], values: dict[str, Any]
) -> dict[str, Any]:
    """Preview of the messages that would actually be sent -- for the UI."""
    return {"messages": _build_messages(snapshot, values)}


__all__ = [
    "start_run",
    "cancel_run",
    "is_running",
    "build_client_preview",
    "OpenRouterClient",
]
