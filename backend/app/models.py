import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_uuid() -> uuid.UUID:
    return uuid.uuid4()


class ModelCatalogEntry(Base):
    """Ein Modell aus dem OpenRouter-Katalog, lokal gecacht.

    Die für Filter/Sortierung relevanten Felder sind ausgepackt, das komplette
    API-Objekt liegt zusätzlich in `raw`.
    """

    __tablename__ = "model_catalog"

    id: Mapped[str] = mapped_column(String(255), primary_key=True)
    name: Mapped[str] = mapped_column(String(512), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    provider: Mapped[str] = mapped_column(String(128), default="", index=True)
    canonical_slug: Mapped[str | None] = mapped_column(String(255), nullable=True)

    created_ts: Mapped[int | None] = mapped_column(Integer, nullable=True)
    context_length: Mapped[int | None] = mapped_column(Integer, nullable=True)
    max_completion_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    is_moderated: Mapped[bool | None] = mapped_column(Boolean, nullable=True)

    # USD pro Token (so wie OpenRouter es liefert). -1 == variabel/provider-abhängig.
    price_prompt: Mapped[float | None] = mapped_column(Float, nullable=True)
    price_completion: Mapped[float | None] = mapped_column(Float, nullable=True)
    price_request: Mapped[float | None] = mapped_column(Float, nullable=True)
    price_image: Mapped[float | None] = mapped_column(Float, nullable=True)
    price_web_search: Mapped[float | None] = mapped_column(Float, nullable=True)
    price_internal_reasoning: Mapped[float | None] = mapped_column(Float, nullable=True)
    price_cache_read: Mapped[float | None] = mapped_column(Float, nullable=True)
    price_cache_write: Mapped[float | None] = mapped_column(Float, nullable=True)

    modality: Mapped[str | None] = mapped_column(String(64), nullable=True)
    input_modalities: Mapped[list[str]] = mapped_column(JSONB, default=list)
    output_modalities: Mapped[list[str]] = mapped_column(JSONB, default=list)
    tokenizer: Mapped[str | None] = mapped_column(String(64), nullable=True)
    instruct_type: Mapped[str | None] = mapped_column(String(64), nullable=True)
    supported_parameters: Mapped[list[str]] = mapped_column(JSONB, default=list)

    raw: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    fetched_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class Task(Base):
    """Eine wiederverwendbare Aufgabe, die gegen beliebige Modelle laufen kann."""

    __tablename__ = "tasks"

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=new_uuid)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")
    # 'one_shot' heute, 'agent' sobald das Harness dazukommt.
    kind: Mapped[str] = mapped_column(String(32), default="one_shot")

    system_prompt: Mapped[str] = mapped_column(Text, default="")
    prompt_template: Mapped[str] = mapped_column(Text, default="")
    # [{"name": "topic", "description": "...", "default": "..."}]
    variables: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)

    # auto | text | markdown | html | json | code
    render_mode: Mapped[str] = mapped_column(String(32), default="auto")
    code_language: Mapped[str | None] = mapped_column(String(32), nullable=True)
    json_schema: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    # Wird in den chat/completions-Payload gemerged (temperature, max_tokens, reasoning, ...)
    params: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    # Platzhalter für das Agent-Harness (max_steps, tools, ...)
    agent_config: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)

    # Zuletzt für diese Task benutzte Modell-Auswahl, als Vorbelegung im UI.
    default_model_ids: Mapped[list[str]] = mapped_column(JSONB, default=list)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )

    runs: Mapped[list["Run"]] = relationship(back_populates="task", cascade="all, delete-orphan")


class Run(Base):
    """Eine Ausführung einer Task gegen N Modelle."""

    __tablename__ = "runs"

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=new_uuid)
    task_id: Mapped[uuid.UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("tasks.id", ondelete="SET NULL"), nullable=True
    )
    label: Mapped[str] = mapped_column(String(255), default="")
    # Kopie der Task zum Zeitpunkt des Runs -- spätere Task-Änderungen verfälschen die Historie nicht.
    task_snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    variable_values: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)

    # pending | running | completed | failed | cancelled
    status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    task: Mapped["Task | None"] = relationship(back_populates="runs")
    items: Mapped[list["RunItem"]] = relationship(
        back_populates="run", cascade="all, delete-orphan", order_by="RunItem.position"
    )


class RunItem(Base):
    """Das Ergebnis eines einzelnen Modells innerhalb eines Runs."""

    __tablename__ = "run_items"

    id: Mapped[uuid.UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=new_uuid)
    run_id: Mapped[uuid.UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("runs.id", ondelete="CASCADE"), index=True
    )
    position: Mapped[int] = mapped_column(Integer, default=0)

    model_id: Mapped[str] = mapped_column(String(255))
    model_name: Mapped[str] = mapped_column(String(512), default="")

    # pending | running | completed | failed | cancelled
    status: Mapped[str] = mapped_column(String(32), default="pending", index=True)
    output_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    reasoning_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    finish_reason: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)

    # Vollständiger Nachrichtenverlauf (inkl. Tool-Calls, sobald das Agent-Harness läuft).
    messages: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    steps: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    raw_response: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)

    prompt_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    completion_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reasoning_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_tokens: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cost_usd: Mapped[float | None] = mapped_column(Float, nullable=True)
    latency_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    run: Mapped["Run"] = relationship(back_populates="items")


class AppSetting(Base):
    """Key/Value-Overrides, die im UI gesetzt werden (z. B. der API-Key)."""

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    value: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=utcnow, onupdate=utcnow
    )
