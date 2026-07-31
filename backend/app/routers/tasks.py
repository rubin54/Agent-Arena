import uuid

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..models import Task
from ..schemas import TaskCreate, TaskOut, TaskUpdate
from ..services import templating

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


class PreviewRequest(BaseModel):
    system_prompt: str = ""
    prompt_template: str = ""
    variable_values: dict[str, str] = {}


class PreviewResponse(BaseModel):
    detected_variables: list[str]
    system_prompt: str
    user_prompt: str


@router.get("", response_model=list[TaskOut])
async def list_tasks(session: AsyncSession = Depends(get_session)) -> list[TaskOut]:
    result = await session.execute(select(Task).order_by(Task.updated_at.desc()))
    return [TaskOut.model_validate(t) for t in result.scalars().all()]


@router.post("", response_model=TaskOut, status_code=201)
async def create_task(payload: TaskCreate, session: AsyncSession = Depends(get_session)) -> TaskOut:
    data = payload.model_dump()
    data["variables"] = [v for v in data.get("variables", [])]
    task = Task(**data)
    session.add(task)
    await session.commit()
    await session.refresh(task)
    return TaskOut.model_validate(task)


@router.get("/{task_id}", response_model=TaskOut)
async def get_task(task_id: uuid.UUID, session: AsyncSession = Depends(get_session)) -> TaskOut:
    task = await session.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task nicht gefunden")
    return TaskOut.model_validate(task)


@router.patch("/{task_id}", response_model=TaskOut)
async def update_task(
    task_id: uuid.UUID, payload: TaskUpdate, session: AsyncSession = Depends(get_session)
) -> TaskOut:
    task = await session.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task nicht gefunden")

    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(task, field, value)
    await session.commit()
    await session.refresh(task)
    return TaskOut.model_validate(task)


@router.post("/{task_id}/duplicate", response_model=TaskOut, status_code=201)
async def duplicate_task(
    task_id: uuid.UUID, session: AsyncSession = Depends(get_session)
) -> TaskOut:
    task = await session.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task nicht gefunden")

    clone = Task(
        name=f"{task.name} (Kopie)",
        description=task.description,
        kind=task.kind,
        system_prompt=task.system_prompt,
        prompt_template=task.prompt_template,
        variables=task.variables,
        render_mode=task.render_mode,
        code_language=task.code_language,
        json_schema=task.json_schema,
        params=task.params,
        agent_config=task.agent_config,
        default_model_ids=task.default_model_ids,
    )
    session.add(clone)
    await session.commit()
    await session.refresh(clone)
    return TaskOut.model_validate(clone)


@router.delete("/{task_id}", status_code=204)
async def delete_task(task_id: uuid.UUID, session: AsyncSession = Depends(get_session)) -> None:
    task = await session.get(Task, task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task nicht gefunden")
    await session.delete(task)
    await session.commit()


@router.post("/preview", response_model=PreviewResponse)
async def preview_prompt(payload: PreviewRequest) -> PreviewResponse:
    """Rendert das Template mit den übergebenen Werten -- ohne ein Modell anzufragen."""
    detected = templating.extract_variables(payload.system_prompt, payload.prompt_template)
    return PreviewResponse(
        detected_variables=detected,
        system_prompt=templating.render(payload.system_prompt, payload.variable_values),
        user_prompt=templating.render(payload.prompt_template, payload.variable_values),
    )
