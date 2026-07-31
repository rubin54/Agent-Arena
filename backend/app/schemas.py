import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

RenderMode = Literal["auto", "text", "markdown", "html", "json", "code"]
TaskKind = Literal["one_shot", "agent"]


class ORMBase(BaseModel):
    model_config = ConfigDict(from_attributes=True, protected_namespaces=())


# --------------------------------------------------------------------------- Catalog


class ModelOut(ORMBase):
    id: str
    name: str
    description: str
    provider: str
    canonical_slug: str | None = None
    created_ts: int | None = None
    context_length: int | None = None
    max_completion_tokens: int | None = None
    is_moderated: bool | None = None
    price_prompt: float | None = None
    price_completion: float | None = None
    price_request: float | None = None
    price_image: float | None = None
    price_web_search: float | None = None
    price_internal_reasoning: float | None = None
    price_cache_read: float | None = None
    price_cache_write: float | None = None
    modality: str | None = None
    input_modalities: list[str] = []
    output_modalities: list[str] = []
    tokenizer: str | None = None
    instruct_type: str | None = None
    supported_parameters: list[str] = []
    fetched_at: datetime


class CatalogOut(BaseModel):
    models: list[ModelOut]
    fetched_at: datetime | None = None
    stale: bool = False
    count: int = 0


# --------------------------------------------------------------------------- Tasks


class TaskVariable(BaseModel):
    name: str
    description: str = ""
    default: str = ""


class TaskBase(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    name: str = Field(min_length=1, max_length=255)
    description: str = ""
    kind: TaskKind = "one_shot"
    system_prompt: str = ""
    prompt_template: str = ""
    variables: list[TaskVariable] = []
    render_mode: RenderMode = "auto"
    code_language: str | None = None
    json_schema: dict[str, Any] | None = None
    params: dict[str, Any] = {}
    agent_config: dict[str, Any] = {}
    default_model_ids: list[str] = []


class TaskCreate(TaskBase):
    pass


class TaskUpdate(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = None
    kind: TaskKind | None = None
    system_prompt: str | None = None
    prompt_template: str | None = None
    variables: list[TaskVariable] | None = None
    render_mode: RenderMode | None = None
    code_language: str | None = None
    json_schema: dict[str, Any] | None = None
    params: dict[str, Any] | None = None
    agent_config: dict[str, Any] | None = None
    default_model_ids: list[str] | None = None


class TaskOut(ORMBase, TaskBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime


# --------------------------------------------------------------------------- Runs


class RunCreate(BaseModel):
    model_config = ConfigDict(protected_namespaces=())

    task_id: uuid.UUID
    model_ids: list[str] = Field(min_length=1)
    variable_values: dict[str, Any] = {}
    label: str = ""
    # Overrides the task parameters for this run only.
    params_override: dict[str, Any] | None = None


class RunItemOut(ORMBase):
    id: uuid.UUID
    position: int
    model_id: str
    model_name: str
    status: str
    output_text: str | None = None
    reasoning_text: str | None = None
    finish_reason: str | None = None
    error: str | None = None
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    reasoning_tokens: int | None = None
    total_tokens: int | None = None
    cost_usd: float | None = None
    latency_ms: int | None = None
    started_at: datetime | None = None
    finished_at: datetime | None = None
    # Step trace for agent runs; empty for one-shot runs.
    steps: list[dict[str, Any]] = []


class RunItemDetail(RunItemOut):
    messages: list[dict[str, Any]] = []
    raw_response: dict[str, Any] | None = None


class RunSummary(ORMBase):
    id: uuid.UUID
    task_id: uuid.UUID | None = None
    label: str
    status: str
    error: str | None = None
    created_at: datetime
    started_at: datetime | None = None
    finished_at: datetime | None = None
    task_name: str = ""
    item_count: int = 0
    completed_count: int = 0
    failed_count: int = 0
    total_cost_usd: float = 0.0


class RunDetail(RunSummary):
    task_snapshot: dict[str, Any] = {}
    variable_values: dict[str, Any] = {}
    items: list[RunItemOut] = []


# --------------------------------------------------------------------------- Settings


class SettingsOut(BaseModel):
    api_key_source: Literal["override", "env", "none"]
    api_key_masked: str | None = None
    has_override: bool
    base_url: str
    site_url: str | None = None
    app_name: str
    run_concurrency: int
    request_timeout_s: float
    catalog_ttl_minutes: int


class SettingsUpdate(BaseModel):
    # None = leave unchanged, "" = delete the override
    openrouter_api_key: str | None = None


class ConnectionCheck(BaseModel):
    ok: bool
    message: str
    detail: dict[str, Any] | None = None
