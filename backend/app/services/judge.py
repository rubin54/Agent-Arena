"""LLM-as-judge: a second model scores an answer against explicit criteria.

Deliberately blind -- the judge never learns which model produced the answer, so
it cannot fall back on reputation instead of reading the text. For the same
reason the overall score is computed here as the mean of the criterion scores
rather than asked for; models are noticeably better at scoring one dimension at
a time than at aggregating.
"""

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any

from ..openrouter import OpenRouterClient, OpenRouterError

log = logging.getLogger("arena.judge")

DEFAULT_MODEL = "openai/gpt-4o-mini"
DEFAULT_SCALE_MAX = 5
MAX_ANSWER_CHARS = 24_000

SYSTEM_PROMPT = (
    "You are a strict, impartial evaluator. You score a response against each given "
    "criterion on an integer scale from 1 to {scale_max}, where 1 is unusable and "
    "{scale_max} is excellent.\n\n"
    "Rules:\n"
    "- Judge only what is in front of you. Do not reward length, confidence or formatting flourish.\n"
    "- A response that ignores the instructions cannot score above 2 on any criterion.\n"
    "- Give one short, concrete reason per criterion, citing what is actually there.\n"
    "- Answer with JSON only, no prose around it."
)

CRITERION_PRESETS: list[dict[str, str]] = [
    {
        "key": "correctness",
        "label": "Correctness",
        "description": "Is the content factually and technically right?",
    },
    {
        "key": "instruction_following",
        "label": "Instruction following",
        "description": "Does it do what the prompt actually asked for, including format?",
    },
    {
        "key": "completeness",
        "label": "Completeness",
        "description": "Are all required parts covered, with nothing important missing?",
    },
    {
        "key": "clarity",
        "label": "Clarity",
        "description": "Is it well structured and easy to follow for the intended audience?",
    },
    {
        "key": "conciseness",
        "label": "Conciseness",
        "description": "Does it get to the point without padding or repetition?",
    },
    {
        "key": "code_quality",
        "label": "Code quality",
        "description": "Readability, edge cases, idiomatic style, absence of obvious bugs.",
    },
    {
        "key": "design",
        "label": "Design",
        "description": "Visual hierarchy, spacing, typography and overall craft.",
    },
]

DEFAULT_CRITERIA = ["correctness", "instruction_following", "clarity"]


@dataclass
class JudgeVerdict:
    score: float | None = None
    criteria: list[dict[str, Any]] = field(default_factory=list)
    summary: str = ""
    model: str = ""
    cost_usd: float | None = None
    error: str | None = None
    scale_max: int = DEFAULT_SCALE_MAX

    def to_dict(self) -> dict[str, Any]:
        return {
            "score": self.score,
            "criteria": self.criteria,
            "summary": self.summary,
            "model": self.model,
            "cost_usd": self.cost_usd,
            "error": self.error,
            "scale_max": self.scale_max,
        }


def is_enabled(judge_config: dict[str, Any] | None) -> bool:
    return bool((judge_config or {}).get("enabled"))


def resolve_criteria(judge_config: dict[str, Any] | None) -> list[dict[str, str]]:
    """Custom criteria win; otherwise fall back to the preset defaults."""
    configured = (judge_config or {}).get("criteria") or []
    resolved: list[dict[str, str]] = []
    presets = {c["key"]: c for c in CRITERION_PRESETS}

    for entry in configured:
        if isinstance(entry, str):
            preset = presets.get(entry)
            if preset:
                resolved.append(dict(preset))
            continue
        if isinstance(entry, dict) and entry.get("key"):
            preset = presets.get(entry["key"], {})
            resolved.append(
                {
                    "key": entry["key"],
                    "label": entry.get("label") or preset.get("label") or entry["key"],
                    "description": entry.get("description") or preset.get("description") or "",
                }
            )

    if not resolved:
        resolved = [dict(presets[k]) for k in DEFAULT_CRITERIA]
    return resolved


def scale_max_of(judge_config: dict[str, Any] | None) -> int:
    raw = (judge_config or {}).get("scale_max") or DEFAULT_SCALE_MAX
    try:
        return max(2, min(int(raw), 10))
    except (TypeError, ValueError):
        return DEFAULT_SCALE_MAX


def model_of(judge_config: dict[str, Any] | None) -> str:
    return (judge_config or {}).get("model") or DEFAULT_MODEL


def _response_schema(criteria: list[dict[str, str]], scale_max: int) -> dict[str, Any]:
    return {
        "type": "object",
        "properties": {
            "criteria": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "key": {"type": "string", "enum": [c["key"] for c in criteria]},
                        "score": {"type": "integer", "minimum": 1, "maximum": scale_max},
                        "reason": {"type": "string"},
                    },
                    "required": ["key", "score", "reason"],
                    "additionalProperties": False,
                },
            },
            "summary": {"type": "string"},
        },
        "required": ["criteria", "summary"],
        "additionalProperties": False,
    }


def _build_prompt(
    *, task_prompt: str, answer: str, criteria: list[dict[str, str]], scale_max: int
) -> list[dict[str, str]]:
    lines = "\n".join(f"- {c['key']}: {c['label']} — {c['description']}" for c in criteria)
    trimmed = answer[:MAX_ANSWER_CHARS]
    if len(answer) > MAX_ANSWER_CHARS:
        trimmed += f"\n\n[truncated, {len(answer)} characters total]"

    user = (
        "## Task that was given\n"
        f"{task_prompt.strip() or '(no prompt recorded)'}\n\n"
        "## Response to evaluate\n"
        f"{trimmed}\n\n"
        "## Criteria\n"
        f"{lines}\n\n"
        f"Score every criterion from 1 to {scale_max} and add a one-sentence overall summary."
    )
    return [
        {"role": "system", "content": SYSTEM_PROMPT.format(scale_max=scale_max)},
        {"role": "user", "content": user},
    ]


async def evaluate(
    *,
    client: OpenRouterClient,
    judge_config: dict[str, Any],
    task_prompt: str,
    answer: str,
) -> JudgeVerdict:
    criteria = resolve_criteria(judge_config)
    scale_max = scale_max_of(judge_config)
    model = model_of(judge_config)
    verdict = JudgeVerdict(model=model, scale_max=scale_max)

    if not (answer or "").strip():
        verdict.error = "Nothing to judge -- the model produced no answer."
        return verdict

    payload = {
        "model": model,
        # Note: no mention of which model wrote the answer. The judgement stays blind.
        "messages": _build_prompt(
            task_prompt=task_prompt, answer=answer, criteria=criteria, scale_max=scale_max
        ),
        "stream": False,
        "usage": {"include": True},
        "temperature": 0,
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": "judgement",
                "strict": True,
                "schema": _response_schema(criteria, scale_max),
            },
        },
    }

    try:
        response = await client.chat_completion(payload)
    except OpenRouterError as exc:
        verdict.error = f"Judge model failed: {exc.message}"
        return verdict

    usage = response.get("usage") or {}
    cost = usage.get("cost")
    verdict.cost_usd = float(cost) if isinstance(cost, (int, float)) else None

    content = _content_text(((response.get("choices") or [{}])[0].get("message") or {}).get("content"))
    parsed = _parse_json(content)
    if parsed is None:
        verdict.error = "Judge did not return valid JSON."
        verdict.summary = content[:500]
        return verdict

    by_key = {c["key"]: c for c in criteria}
    scored: list[dict[str, Any]] = []
    for entry in parsed.get("criteria") or []:
        key = entry.get("key")
        meta = by_key.get(key)
        if meta is None:
            continue
        try:
            score = max(1, min(int(entry.get("score")), scale_max))
        except (TypeError, ValueError):
            continue
        scored.append(
            {
                "key": key,
                "label": meta["label"],
                "score": score,
                "reason": str(entry.get("reason") or "")[:600],
            }
        )

    if not scored:
        verdict.error = "Judge returned no usable scores."
        return verdict

    verdict.criteria = scored
    # Mean of the criterion scores -- computed here, not asked of the model.
    verdict.score = round(sum(c["score"] for c in scored) / len(scored), 2)
    verdict.summary = str(parsed.get("summary") or "")[:1000]
    return verdict


def _content_text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "".join(
            part.get("text", "") for part in content if isinstance(part, dict)
        )
    return ""


_FENCE_RE = re.compile(r"```(?:json)?\s*([\s\S]*?)```")


def _parse_json(text: str) -> dict[str, Any] | None:
    """Models wrap JSON in fences or prose often enough to be worth handling."""
    for candidate in _candidates(text):
        try:
            parsed = json.loads(candidate)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
    return None


def _candidates(text: str) -> list[str]:
    stripped = (text or "").strip()
    out = [stripped]
    fence = _FENCE_RE.search(stripped)
    if fence:
        out.append(fence.group(1).strip())
    start, end = stripped.find("{"), stripped.rfind("}")
    if start != -1 and end > start:
        out.append(stripped[start : end + 1])
    return out
