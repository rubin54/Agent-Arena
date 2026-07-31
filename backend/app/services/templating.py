import re
from typing import Any

VARIABLE_PATTERN = re.compile(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}")


def extract_variables(*texts: str) -> list[str]:
    """Alle {{variablen}} in Reihenfolge des ersten Auftretens."""
    seen: list[str] = []
    for text in texts:
        for match in VARIABLE_PATTERN.finditer(text or ""):
            name = match.group(1)
            if name not in seen:
                seen.append(name)
    return seen


def render(template: str, values: dict[str, Any]) -> str:
    """Ersetzt {{name}} durch den Wert. Unbekannte Platzhalter bleiben unverändert stehen,
    damit ein Tippfehler im Template sichtbar wird statt still zu verschwinden."""
    if not template:
        return ""

    def _sub(match: re.Match[str]) -> str:
        name = match.group(1)
        if name in values and values[name] is not None:
            return str(values[name])
        return match.group(0)

    return VARIABLE_PATTERN.sub(_sub, template)


def resolve_values(
    variables: list[dict[str, Any]], provided: dict[str, Any], template_names: list[str]
) -> dict[str, Any]:
    """Defaults aus der Task-Definition mit den übergebenen Werten mergen."""
    values: dict[str, Any] = {}
    for name in template_names:
        values.setdefault(name, "")
    for var in variables or []:
        name = var.get("name")
        if name:
            values[name] = var.get("default", "")
    for key, val in (provided or {}).items():
        values[key] = val
    return values
