from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from typing import Literal

from ..config import get_settings
from ..services import agent_tools, assertions, judge, sandbox

router = APIRouter(prefix="/api/agent", tags=["agent"])


class ToolInfo(BaseModel):
    name: str
    label: str
    description: str


class AssertionType(BaseModel):
    type: str
    label: str
    description: str
    fields: list[str]
    # 'agent' types are only offered for agent tasks.
    scope: Literal["any", "agent"]


class SandboxStatus(BaseModel):
    docker_available: bool
    image_ready: bool
    image: str
    message: str


@router.get("/tools", response_model=list[ToolInfo])
async def list_tools() -> list[ToolInfo]:
    return [
        ToolInfo(name=tool.name, label=tool.label, description=tool.description)
        for tool in agent_tools.TOOLS.values()
    ]


class JudgeCriterion(BaseModel):
    key: str
    label: str
    description: str


@router.get("/assertion-types", response_model=list[AssertionType])
async def list_assertion_types() -> list[AssertionType]:
    return [AssertionType(**entry) for entry in assertions.CATALOG]


@router.get("/judge-criteria", response_model=list[JudgeCriterion])
async def list_judge_criteria() -> list[JudgeCriterion]:
    return [JudgeCriterion(**entry) for entry in judge.CRITERION_PRESETS]


@router.get("/sandbox", response_model=SandboxStatus)
async def sandbox_status() -> SandboxStatus:
    image = get_settings().sandbox_image
    try:
        ready = await sandbox.image_exists()
    except sandbox.SandboxError as exc:
        return SandboxStatus(
            docker_available=False, image_ready=False, image=image, message=str(exc)
        )
    except Exception as exc:
        return SandboxStatus(
            docker_available=False,
            image_ready=False,
            image=image,
            message=f"Docker unreachable: {exc}",
        )

    return SandboxStatus(
        docker_available=True,
        image_ready=ready,
        image=image,
        message=(
            "Sandbox ready."
            if ready
            else "Docker is running, the image is still missing -- it is built on the first agent run."
        ),
    )


@router.post("/sandbox/build", response_model=SandboxStatus)
async def build_image() -> SandboxStatus:
    """Build the image up front so the first agent run does not stall for minutes."""
    image = get_settings().sandbox_image
    try:
        await sandbox.ensure_image()
    except sandbox.SandboxError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return SandboxStatus(
        docker_available=True, image_ready=True, image=image, message="Sandbox image built."
    )
