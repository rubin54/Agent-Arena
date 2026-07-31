from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from ..config import get_settings
from ..db import get_session
from ..openrouter import OpenRouterError
from ..schemas import ConnectionCheck, SettingsOut, SettingsUpdate
from ..services import settings_store

router = APIRouter(prefix="/api/settings", tags=["settings"])


async def _current(session: AsyncSession) -> SettingsOut:
    cfg = get_settings()
    key, source = await settings_store.resolve_api_key(session)
    override = await settings_store.get_setting(session, settings_store.API_KEY_SETTING)
    return SettingsOut(
        api_key_source=source,  # type: ignore[arg-type]
        api_key_masked=settings_store.mask_key(key),
        has_override=bool(override),
        base_url=cfg.openrouter_base_url,
        site_url=cfg.openrouter_site_url,
        app_name=cfg.openrouter_app_name,
        run_concurrency=cfg.run_concurrency,
        request_timeout_s=cfg.request_timeout_s,
        catalog_ttl_minutes=cfg.catalog_ttl_minutes,
    )


@router.get("", response_model=SettingsOut)
async def read_settings(session: AsyncSession = Depends(get_session)) -> SettingsOut:
    return await _current(session)


@router.put("", response_model=SettingsOut)
async def update_settings(
    payload: SettingsUpdate, session: AsyncSession = Depends(get_session)
) -> SettingsOut:
    if payload.openrouter_api_key is not None:
        value = payload.openrouter_api_key.strip()
        if value:
            await settings_store.set_setting(session, settings_store.API_KEY_SETTING, value)
        else:
            # An empty string clears the override, so the .env takes over again.
            await settings_store.delete_setting(session, settings_store.API_KEY_SETTING)
    return await _current(session)


@router.post("/check", response_model=ConnectionCheck)
async def check_connection(session: AsyncSession = Depends(get_session)) -> ConnectionCheck:
    key, source = await settings_store.resolve_api_key(session)
    if not key:
        return ConnectionCheck(
            ok=False,
            message="No API key configured (neither in backend/.env nor as an override).",
        )

    client = await settings_store.build_client(session)
    try:
        response = await client.chat_completion(
            {
                "model": "openai/gpt-4o-mini",
                "messages": [{"role": "user", "content": "ping"}],
                "max_tokens": 1,
                "usage": {"include": True},
            }
        )
    except OpenRouterError as exc:
        return ConnectionCheck(
            ok=False,
            message=f"Connection failed: {exc.message}",
            detail={"status": exc.status, "source": source},
        )

    return ConnectionCheck(
        ok=True,
        message=f"Connection ok (key from '{source}').",
        detail={"model": response.get("model"), "id": response.get("id")},
    )
