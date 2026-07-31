from typing import Any

import httpx


class OpenRouterError(Exception):
    """Fehler beim Sprechen mit OpenRouter. `status` ist None bei Netzwerk-/Timeout-Fehlern."""

    def __init__(self, message: str, status: int | None = None, payload: Any = None):
        super().__init__(message)
        self.message = message
        self.status = status
        self.payload = payload


class OpenRouterClient:
    def __init__(
        self,
        *,
        api_key: str | None,
        base_url: str,
        site_url: str | None = None,
        app_name: str | None = None,
        timeout: float = 300.0,
    ) -> None:
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.site_url = site_url
        self.app_name = app_name
        self.timeout = timeout

    def _headers(self, *, require_key: bool = True) -> dict[str, str]:
        if require_key and not self.api_key:
            raise OpenRouterError(
                "Kein OpenRouter-API-Key gesetzt. Trage ihn in backend/.env "
                "als OPENROUTER_API_KEY ein oder hinterlege ihn unter Einstellungen."
            )
        headers = {"Content-Type": "application/json"}
        if self.api_key:
            headers["Authorization"] = f"Bearer {self.api_key}"
        if self.site_url:
            headers["HTTP-Referer"] = self.site_url
        if self.app_name:
            headers["X-Title"] = self.app_name
        return headers

    async def list_models(self) -> list[dict[str, Any]]:
        """Kompletter Modell-Katalog. Funktioniert auch ohne API-Key."""
        url = f"{self.base_url}/models"
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.get(url, headers=self._headers(require_key=False))
        except httpx.HTTPError as exc:
            raise OpenRouterError(f"Modell-Katalog nicht erreichbar: {exc}") from exc

        if resp.status_code >= 400:
            raise OpenRouterError(
                f"Modell-Katalog konnte nicht geladen werden (HTTP {resp.status_code})",
                status=resp.status_code,
                payload=_safe_json(resp),
            )
        data = resp.json()
        return data.get("data", [])

    async def chat_completion(self, payload: dict[str, Any]) -> dict[str, Any]:
        url = f"{self.base_url}/chat/completions"
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                resp = await client.post(url, headers=self._headers(), json=payload)
        except httpx.TimeoutException as exc:
            raise OpenRouterError(f"Timeout nach {self.timeout:.0f}s") from exc
        except httpx.HTTPError as exc:
            raise OpenRouterError(f"Netzwerkfehler: {exc}") from exc

        body = _safe_json(resp)
        if resp.status_code >= 400:
            raise OpenRouterError(
                _extract_error_message(body) or f"HTTP {resp.status_code}",
                status=resp.status_code,
                payload=body,
            )
        if not isinstance(body, dict):
            raise OpenRouterError("Unerwartete Antwort von OpenRouter", payload=body)

        # OpenRouter liefert Upstream-Fehler teilweise mit HTTP 200 im Body.
        if "error" in body and not body.get("choices"):
            raise OpenRouterError(
                _extract_error_message(body) or "Unbekannter Fehler",
                status=body.get("error", {}).get("code"),
                payload=body,
            )
        return body


def _safe_json(resp: httpx.Response) -> Any:
    try:
        return resp.json()
    except ValueError:
        return {"raw_text": resp.text[:4000]}


def _extract_error_message(body: Any) -> str | None:
    if not isinstance(body, dict):
        return None
    err = body.get("error")
    if isinstance(err, dict):
        msg = err.get("message")
        meta = err.get("metadata")
        if isinstance(meta, dict) and meta.get("raw"):
            return f"{msg} ({str(meta['raw'])[:500]})"
        return msg
    if isinstance(err, str):
        return err
    return None
