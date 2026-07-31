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
from . import settings_store, templating

log = logging.getLogger("arena.runner")

# Nur Parameter, die wir bewusst durchreichen. Alles andere im Task-`params`-Objekt
# landet unverändert im Payload (z. B. `reasoning`, `provider`, `transforms`).
_RESERVED_PARAM_KEYS = {"model", "messages", "stream"}

_running: dict[uuid.UUID, asyncio.Task[None]] = {}


def is_running(run_id: uuid.UUID) -> bool:
    task = _running.get(run_id)
    return task is not None and not task.done()


def start_run(run_id: uuid.UUID) -> None:
    """Run im Hintergrund starten. Der HTTP-Request kehrt sofort zurück."""
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


# --------------------------------------------------------------------------- Ausführung


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

        semaphore = asyncio.Semaphore(max(1, settings.run_concurrency))
        await asyncio.gather(
            *(_execute_item(item_id, snapshot, values, semaphore) for item_id in item_ids)
        )
        await _finalize(run_id)
    except asyncio.CancelledError:
        await _mark_cancelled(run_id)
        raise
    except Exception as exc:  # pragma: no cover - Sicherheitsnetz
        log.exception("Run %s abgebrochen", run_id)
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
            payload = _build_payload(snapshot, item.model_id, messages)

            started = time.perf_counter()
            try:
                response = await client.chat_completion(payload)
            except OpenRouterError as exc:
                item.status = "failed"
                item.error = exc.message
                item.raw_response = exc.payload if isinstance(exc.payload, dict) else None
                item.latency_ms = int((time.perf_counter() - started) * 1000)
                item.finished_at = datetime.now(timezone.utc)
                item.messages = messages
                await session.commit()
                return
            except Exception as exc:  # pragma: no cover
                item.status = "failed"
                item.error = f"{type(exc).__name__}: {exc}"
                item.latency_ms = int((time.perf_counter() - started) * 1000)
                item.finished_at = datetime.now(timezone.utc)
                item.messages = messages
                await session.commit()
                return

            latency_ms = int((time.perf_counter() - started) * 1000)
            _apply_response(item, response, messages, pricing, latency_ms)
            await session.commit()


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

    # OpenRouter liefert bei `usage: {include: true}` die echten Kosten mit.
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
        item.error = "Modell hat keinen Text zurückgegeben."
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
        # Liefert `usage.cost` -- die tatsächlich abgerechneten Kosten.
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
        # Multimodale Antworten kommen als Liste von Parts.
        parts: list[str] = []
        for part in content:
            if isinstance(part, dict):
                if isinstance(part.get("text"), str):
                    parts.append(part["text"])
            elif isinstance(part, str):
                parts.append(part)
        return "".join(parts)
    return json.dumps(content, ensure_ascii=False)


# --------------------------------------------------------------------------- Kosten


def _pricing_from_entry(entry: ModelCatalogEntry | None) -> dict[str, float | None]:
    if entry is None:
        return {"prompt": None, "completion": None}
    return {"prompt": entry.price_prompt, "completion": entry.price_completion}


def _estimate_cost(
    prompt_tokens: int | None, completion_tokens: int | None, pricing: dict[str, float | None]
) -> float | None:
    p_price, c_price = pricing.get("prompt"), pricing.get("completion")
    # -1 bedeutet bei OpenRouter "variabel" -- daraus lässt sich nichts rechnen.
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


# --------------------------------------------------------------------------- Abschluss


async def _finalize(run_id: uuid.UUID) -> None:
    async with SessionLocal() as session:
        run = await session.get(Run, run_id)
        if run is None:
            return
        statuses = await _item_statuses(session, run_id)
        if statuses and all(s == "failed" for s in statuses):
            run.status = "failed"
            run.error = "Alle Modelle sind fehlgeschlagen."
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
    # Bewusst ohne await auf den (gerade gecancelten) Task: eigene Session, eigener Shield.
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
    """Vorschau der tatsächlich gesendeten Nachrichten -- fürs UI."""
    return {"messages": _build_messages(snapshot, values)}


__all__ = [
    "start_run",
    "cancel_run",
    "is_running",
    "build_client_preview",
    "OpenRouterClient",
]
