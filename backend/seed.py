"""Create a few example tasks that showcase the different render modes.

    python seed.py

Tasks whose name already exists are skipped.
"""

import asyncio

from sqlalchemy import select

from app.db import SessionLocal, init_db
from app.models import Task

EXAMPLES: list[dict] = [
    {
        "name": "Write an explanation (Markdown)",
        "description": "Classic one-shot prompt; the result is rendered as Markdown.",
        "system_prompt": "You are a precise technical writer.",
        "prompt_template": (
            "Explain {{topic}} to {{audience}}.\n\n"
            "Structure:\n"
            "1. Core idea in two sentences\n"
            "2. How it works (bullet points)\n"
            "3. One concrete example\n"
            "4. The most common misconception\n\n"
            "300 words maximum."
        ),
        "variables": [
            {"name": "topic", "description": "What to explain", "default": "vector embeddings"},
            {
                "name": "audience",
                "description": "Prior knowledge of the readers",
                "default": "backend developers with no ML background",
            },
        ],
        "render_mode": "markdown",
        "params": {"temperature": 0.4, "max_tokens": 900},
    },
    {
        "name": "Build a landing page (HTML)",
        "description": "Probes design and frontend skills. The result runs in a sandboxed iframe.",
        "system_prompt": (
            "You return exactly one complete HTML file -- no prose, no explanation. "
            "Everything needed (CSS, and JS if any) is inline in the document. No external requests."
        ),
        "prompt_template": (
            "Build a landing page for {{product}}.\n\n"
            "Audience: {{audience}}\n"
            "Tone: {{tone}}\n\n"
            "Required: a hero with a clear value proposition, three feature blocks, "
            "a pricing section and one call to action. Responsive, dark theme, "
            "modern typography."
        ),
        "variables": [
            {
                "name": "product",
                "description": "What is being advertised",
                "default": "a CLI tool that cleans up stale Docker images",
            },
            {
                "name": "audience",
                "description": "Who is being addressed",
                "default": "DevOps teams at small companies",
            },
            {
                "name": "tone",
                "description": "Style of the copy",
                "default": "factual, technical, no marketing fluff",
            },
        ],
        "render_mode": "html",
        "params": {"temperature": 0.8, "max_tokens": 8000},
    },
    {
        "name": "Extract data (JSON)",
        "description": "Structured output -- tests how reliably a model sticks to a schema.",
        "system_prompt": "You extract data and answer with JSON only.",
        "prompt_template": (
            "Extract the structured data from the following text:\n\n---\n{{text}}\n---"
        ),
        "variables": [
            {
                "name": "text",
                "description": "Raw text to extract from",
                "default": (
                    "Invoice 2024-0815 dated 2024-03-12. Customer: Meier GmbH, Hamburg. "
                    "Line items: 3x server maintenance at 450.00 EUR, 1x emergency callout 890.50 EUR. "
                    "Payable by 2024-03-26."
                ),
            }
        ],
        "render_mode": "json",
        "assertions": [
            {"type": "is_json"},
            {"type": "json_schema"},
            {"type": "contains", "value": "2024-0815"},
        ],
        "json_schema": {
            "type": "object",
            "properties": {
                "invoice_number": {"type": "string"},
                "date": {"type": "string"},
                "customer": {"type": "string"},
                "line_items": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "description": {"type": "string"},
                            "quantity": {"type": "number"},
                            "unit_price_eur": {"type": "number"},
                        },
                        "required": ["description", "quantity", "unit_price_eur"],
                        "additionalProperties": False,
                    },
                },
                "total_eur": {"type": "number"},
                "due_date": {"type": "string"},
            },
            "required": [
                "invoice_number",
                "date",
                "customer",
                "line_items",
                "total_eur",
                "due_date",
            ],
            "additionalProperties": False,
        },
        "params": {"temperature": 0, "max_tokens": 1500},
    },
    {
        "name": "Implement an algorithm (Code)",
        "description": "Compares code quality on an identical brief.",
        "system_prompt": "Answer with exactly one code block, no preamble and no epilogue.",
        "prompt_template": (
            "Implement in {{language}}: {{task}}\n\n"
            "Requirements: typed, edge cases covered, short docstrings, no external dependencies."
        ),
        "variables": [
            {"name": "language", "description": "Programming language", "default": "Python"},
            {
                "name": "task",
                "description": "What to implement",
                "default": "an LRU cache with O(1) get and put",
            },
        ],
        "render_mode": "code",
        "code_language": "python",
        "assertions": [
            {"type": "regex", "pattern": r"(?m)^\s*(def|class)\s+\w+"},
            {"type": "min_length", "value": 200},
        ],
        "params": {"temperature": 0.2, "max_tokens": 2000},
    },
    {
        "name": "Agent: find and fix a bug",
        "description": "Agent task -- the agent has to run the tests, find the bug and fix it.",
        "kind": "agent",
        "system_prompt": "You are a careful software engineer.",
        "prompt_template": (
            "The workspace contains `stats.py` and `test_stats.py`. The tests fail.\n\n"
            "Find the cause, fix it in `stats.py` and prove with a test run that every "
            "test passes. Do not modify the tests."
        ),
        "variables": [],
        "render_mode": "markdown",
        "params": {"temperature": 0.3},
        # The point of the whole exercise: the tests either pass or they do not.
        "assertions": [
            {"type": "command_exit_zero", "command": "python3 test_stats.py"},
            {"type": "file_contains", "path": "stats.py", "value": "def median"},
            {"type": "max_steps", "value": 12},
        ],
        "agent_config": {
            "max_steps": 15,
            "network": False,
            "command_timeout_s": 60,
            "memory_mb": 1024,
            "cpus": 2,
            "tools": ["bash", "read_file", "write_file", "list_files"],
            "setup_files": [
                {
                    "path": "stats.py",
                    "content": (
                        "def median(values):\n"
                        '    """Median of a list of numbers."""\n'
                        "    if not values:\n"
                        "        raise ValueError('empty list')\n"
                        "    ordered = sorted(values)\n"
                        "    middle = len(ordered) // 2\n"
                        "    # Bug: for an even count the mean of the two middle\n"
                        "    # values must be returned.\n"
                        "    return ordered[middle]\n"
                    ),
                },
                {
                    "path": "test_stats.py",
                    "content": (
                        "from stats import median\n\n\n"
                        "def test_odd():\n"
                        "    assert median([3, 1, 2]) == 2\n\n\n"
                        "def test_even():\n"
                        "    assert median([4, 1, 3, 2]) == 2.5\n\n\n"
                        "def test_single_value():\n"
                        "    assert median([7]) == 7\n\n\n"
                        "if __name__ == '__main__':\n"
                        "    test_odd()\n"
                        "    test_even()\n"
                        "    test_single_value()\n"
                        "    print('all tests pass')\n"
                    ),
                },
            ],
        },
    },
]


async def main() -> None:
    await init_db()
    async with SessionLocal() as session:
        existing = set((await session.execute(select(Task.name))).scalars().all())
        added = 0
        for example in EXAMPLES:
            if example["name"] in existing:
                print(f"  skipped (already exists): {example['name']}")
                continue
            session.add(Task(**example))
            added += 1
            print(f"  created: {example['name']}")
        await session.commit()
    print(f"\n{added} task(s) created.")


if __name__ == "__main__":
    asyncio.run(main())
