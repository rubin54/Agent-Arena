from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from ..db import get_session
from ..openrouter import OpenRouterError
from ..schemas import CatalogOut, ModelOut
from ..services import catalog

router = APIRouter(prefix="/api/models", tags=["models"])


@router.get("", response_model=CatalogOut)
async def list_models(
    refresh: bool = False,
    session: AsyncSession = Depends(get_session),
) -> CatalogOut:
    count, fetched_at = await catalog.get_catalog_meta(session)

    # Leerer oder abgelaufener Cache wird automatisch nachgeladen.
    if refresh or count == 0 or catalog.is_stale(fetched_at):
        try:
            await catalog.refresh_catalog(session)
            count, fetched_at = await catalog.get_catalog_meta(session)
        except OpenRouterError as exc:
            if count == 0:
                raise HTTPException(status_code=502, detail=exc.message) from exc
            # Cache ist da, nur veraltet -- lieber alte Daten als gar keine.

    entries = await catalog.list_models(session)
    return CatalogOut(
        models=[ModelOut.model_validate(e) for e in entries],
        fetched_at=fetched_at,
        stale=catalog.is_stale(fetched_at),
        count=count,
    )


@router.post("/refresh", response_model=CatalogOut)
async def refresh_models(session: AsyncSession = Depends(get_session)) -> CatalogOut:
    try:
        await catalog.refresh_catalog(session)
    except OpenRouterError as exc:
        raise HTTPException(status_code=502, detail=exc.message) from exc

    count, fetched_at = await catalog.get_catalog_meta(session)
    entries = await catalog.list_models(session)
    return CatalogOut(
        models=[ModelOut.model_validate(e) for e in entries],
        fetched_at=fetched_at,
        stale=False,
        count=count,
    )


@router.get("/{model_id:path}", response_model=ModelOut)
async def get_model(model_id: str, session: AsyncSession = Depends(get_session)) -> ModelOut:
    entry = await catalog.get_model(session, model_id)
    if entry is None:
        raise HTTPException(status_code=404, detail="Modell nicht im Katalog")
    return ModelOut.model_validate(entry)
