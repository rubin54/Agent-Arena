from typing import Any

import httpx


class OpenRouterError(Exception):
    """Error talking to OpenRouter. `status` is None for network/timeout failures."""

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
                "No OpenRouter API key configured. Set OPENROUTER_API_KEY in "
                "backend/.env or provide it under Settings."
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
        """The full model catalog. Works without an API key."""
        url = f"{self.base_url}/models"
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                resp = await client.get(url, headers=self._headers(require_key=False))
        except httpx.HTTPError as exc:
            raise OpenRouterError(f"Model catalog unreachable: {exc}") from exc

        if resp.status_code >= 400:
            raise OpenRouterError(
                f"Could not load the model catalog (HTTP {resp.status_code})",
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
            raise OpenRouterError(f"Timed out after {self.timeout:.0f}s") from exc
        except httpx.HTTPError as exc:
            raise OpenRouterError(f"Network error: {exc}") from exc

        body = _safe_json(resp)
        if resp.status_code >= 400:
            raise OpenRouterError(
                _extract_error_message(body) or f"HTTP {resp.status_code}",
                status=resp.status_code,
                payload=body,
            )
        if not isinstance(body, dict):
            raise OpenRouterError("Unexpected response from OpenRouter", payload=body)

        # OpenRouter sometimes reports upstream errors in the body with HTTP 200.
        if "error" in body and not body.get("choices"):
            raise OpenRouterError(
                _extract_error_message(body) or "Unknown error",
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
