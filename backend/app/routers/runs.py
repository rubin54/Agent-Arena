import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from ..db import get_session
from ..models import ModelCatalogEntry, Run, RunItem, Task
from ..schemas import (
    RatingUpdate,
    RunCreate,
    RunDetail,
    RunItemDetail,
    RunItemOut,
    RunSummary,
)
from ..services import judge as judge_service, runner, settings_store, templating

router = APIRouter(prefix="/api/runs", tags=["runs"])


def _summarize(run: Run, task_name: str) -> dict:
    items = run.items or []
    costs = [i.cost_usd for i in items if i.cost_usd is not None]
    return {
        "id": run.id,
        "task_id": run.task_id,
        "label": run.label,
        "status": run.status,
        "error": run.error,
        "created_at": run.created_at,
        "started_at": run.started_at,
        "finished_at": run.finished_at,
        "task_name": task_name,
        "item_count": len(items),
        "completed_count": sum(1 for i in items if i.status == "completed"),
        "failed_count": sum(1 for i in items if i.status == "failed"),
        "total_cost_usd": round(sum(costs), 6) if costs else 0.0,
        "evaluated_count": sum(1 for i in items if i.passed is not None),
        "passed_count": sum(1 for i in items if i.passed),
        "avg_judge_score": _mean([i.judge_score for i in items]),
        "avg_rating": _mean([i.rating for i in items]),
    }


def _mean(values: list[float | int | None]) -> float | None:
    present = [v for v in values if v is not None]
    return round(sum(present) / len(present), 2) if present else None


def _task_name(run: Run) -> str:
    if run.task is not None:
        return run.task.name
    return (run.task_snapshot or {}).get("name", "") or "(deleted task)"


@router.get("", response_model=list[RunSummary])
async def list_runs(
    limit: int = Query(default=50, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    task_id: uuid.UUID | None = None,
    session: AsyncSession = Depends(get_session),
) -> list[RunSummary]:
    stmt = (
        select(Run)
        .options(selectinload(Run.items), selectinload(Run.task))
        .order_by(Run.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    if task_id is not None:
        stmt = stmt.where(Run.task_id == task_id)

    result = await session.execute(stmt)
    return [RunSummary(**_summarize(run, _task_name(run))) for run in result.scalars().all()]


@router.post("", response_model=RunDetail, status_code=201)
async def create_run(payload: RunCreate, session: AsyncSession = Depends(get_session)) -> RunDetail:
    task = await session.get(Task, payload.task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")

    model_ids = list(dict.fromkeys(payload.model_ids))  # Duplikate raus, Reihenfolge bleibt
    if not model_ids:
        raise HTTPException(status_code=400, detail="Select at least one model")

    snapshot = {
        "name": task.name,
        "description": task.description,
        "kind": task.kind,
        "system_prompt": task.system_prompt,
        "prompt_template": task.prompt_template,
        "variables": task.variables,
        "render_mode": task.render_mode,
        "code_language": task.code_language,
        "json_schema": task.json_schema,
        "params": {**(task.params or {}), **(payload.params_override or {})},
        "agent_config": task.agent_config,
        "assertions": task.assertions,
        "judge_config": task.judge_config,
    }

    detected = templating.extract_variables(task.system_prompt or "", task.prompt_template or "")
    values = templating.resolve_values(task.variables or [], payload.variable_values, detected)

    run = Run(
        task_id=task.id,
        label=payload.label or task.name,
        task_snapshot=snapshot,
        variable_values=values,
        status="pending",
    )
    session.add(run)
    await session.flush()

    # Pull display names from the catalog so the history stays readable even if a
    # model disappears from the catalog later on.
    catalog_rows = await session.execute(
        select(ModelCatalogEntry.id, ModelCatalogEntry.name).where(
            ModelCatalogEntry.id.in_(model_ids)
        )
    )
    names = dict(catalog_rows.all())

    for position, model_id in enumerate(model_ids):
        session.add(
            RunItem(
                run_id=run.id,
                position=position,
                model_id=model_id,
                model_name=names.get(model_id, model_id),
                status="pending",
            )
        )

    task.default_model_ids = model_ids
    await session.commit()

    runner.start_run(run.id)

    return await _load_detail(session, run.id)


@router.get("/{run_id}", response_model=RunDetail)
async def get_run(run_id: uuid.UUID, session: AsyncSession = Depends(get_session)) -> RunDetail:
    return await _load_detail(session, run_id)


@router.get("/{run_id}/items/{item_id}", response_model=RunItemDetail)
async def get_run_item(
    run_id: uuid.UUID, item_id: uuid.UUID, session: AsyncSession = Depends(get_session)
) -> RunItemDetail:
    item = await session.get(RunItem, item_id)
    if item is None or item.run_id != run_id:
        raise HTTPException(status_code=404, detail="Run item not found")
    return RunItemDetail.model_validate(item)


@router.patch("/{run_id}/items/{item_id}/rating", response_model=RunItemOut)
async def set_rating(
    run_id: uuid.UUID,
    item_id: uuid.UUID,
    payload: RatingUpdate,
    session: AsyncSession = Depends(get_session),
) -> RunItemOut:
    item = await session.get(RunItem, item_id)
    if item is None or item.run_id != run_id:
        raise HTTPException(status_code=404, detail="Run item not found")

    if payload.rating is not None:
        # 0 is the UI's way of clearing a rating -- clicking the active star again.
        item.rating = payload.rating or None
        item.rated_at = datetime.now(timezone.utc) if item.rating else None
    if payload.rating_note is not None:
        item.rating_note = payload.rating_note.strip() or None

    await session.commit()
    await session.refresh(item)
    return RunItemOut.model_validate(item)


@router.post("/{run_id}/judge", response_model=RunDetail)
async def judge_run(
    run_id: uuid.UUID,
    force: bool = Query(default=False, description="Re-judge items that already have a verdict"),
    session: AsyncSession = Depends(get_session),
) -> RunDetail:
    """Judge a finished run on demand -- for runs whose task had the judge disabled."""
    run = await session.get(Run, run_id, options=[selectinload(Run.items)])
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
    if run.status in ("pending", "running"):
        raise HTTPException(status_code=400, detail="The run is still in progress")

    snapshot = dict(run.task_snapshot or {})
    config = snapshot.get("judge_config") or {}
    if not config.get("model") and not config.get("criteria"):
        config = {**config, "enabled": True}

    client = await settings_store.build_client(session)
    prompt = (snapshot.get("prompt_template") or "").strip()

    for item in run.items:
        if not item.output_text:
            continue
        if item.judge_result and not force:
            continue
        verdict = await judge_service.evaluate(
            client=client, judge_config=config, task_prompt=prompt, answer=item.output_text
        )
        item.judge_score = verdict.score
        item.judge_result = verdict.to_dict()

    await session.commit()
    return await _load_detail(session, run_id)


@router.post("/{run_id}/cancel", response_model=RunDetail)
async def cancel_run(run_id: uuid.UUID, session: AsyncSession = Depends(get_session)) -> RunDetail:
    run = await session.get(Run, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
    if run.status not in ("pending", "running"):
        raise HTTPException(status_code=400, detail=f"Run is already '{run.status}'")

    runner.cancel_run(run_id)

    # Leave the DB consistent whether or not the asyncio task is still alive.
    result = await session.execute(select(RunItem).where(RunItem.run_id == run_id))
    for item in result.scalars().all():
        if item.status in ("pending", "running"):
            item.status = "cancelled"
            item.finished_at = datetime.now(timezone.utc)
    run.status = "cancelled"
    run.finished_at = datetime.now(timezone.utc)
    await session.commit()

    return await _load_detail(session, run_id)


@router.post("/{run_id}/rerun", response_model=RunDetail, status_code=201)
async def rerun(run_id: uuid.UUID, session: AsyncSession = Depends(get_session)) -> RunDetail:
    """Same task, same models, same variable values -- a fresh run."""
    old = await session.get(Run, run_id, options=[selectinload(Run.items)])
    if old is None:
        raise HTTPException(status_code=404, detail="Run not found")

    new_run = Run(
        task_id=old.task_id,
        label=old.label,
        task_snapshot=old.task_snapshot,
        variable_values=old.variable_values,
        status="pending",
    )
    session.add(new_run)
    await session.flush()

    for position, item in enumerate(sorted(old.items, key=lambda i: i.position)):
        session.add(
            RunItem(
                run_id=new_run.id,
                position=position,
                model_id=item.model_id,
                model_name=item.model_name,
                status="pending",
            )
        )
    await session.commit()

    runner.start_run(new_run.id)
    return await _load_detail(session, new_run.id)


@router.delete("/{run_id}", status_code=204)
async def delete_run(run_id: uuid.UUID, session: AsyncSession = Depends(get_session)) -> None:
    run = await session.get(Run, run_id)
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")
    runner.cancel_run(run_id)
    await session.delete(run)
    await session.commit()


async def _load_detail(session: AsyncSession, run_id: uuid.UUID) -> RunDetail:
    result = await session.execute(
        select(Run)
        .options(selectinload(Run.items), selectinload(Run.task))
        .where(Run.id == run_id)
    )
    run = result.scalar_one_or_none()
    if run is None:
        raise HTTPException(status_code=404, detail="Run not found")

    return RunDetail(
        **_summarize(run, _task_name(run)),
        task_snapshot=run.task_snapshot or {},
        variable_values=run.variable_values or {},
        items=[RunItemOut.model_validate(i) for i in run.items],
    )
