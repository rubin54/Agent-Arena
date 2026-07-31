import re
from typing import Any

VARIABLE_PATTERN = re.compile(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}")


def extract_variables(*texts: str) -> list[str]:
    """All {{variables}} in order of first appearance."""
    seen: list[str] = []
    for text in texts:
        for match in VARIABLE_PATTERN.finditer(text or ""):
            name = match.group(1)
            if name not in seen:
                seen.append(name)
    return seen


def render(template: str, values: dict[str, Any]) -> str:
    """Replace {{name}} with its value. Unknown placeholders are left untouched so a
    typo in the template stays visible instead of silently disappearing."""
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
    """Merge the task defaults with the values supplied by the caller."""
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
