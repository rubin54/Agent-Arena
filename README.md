# Agent Arena

A local dashboard for comparing LLMs through [OpenRouter](https://openrouter.ai): the full model
catalog with prices and context lengths, self-defined tasks, and one-shot runs executed against as
many models as you like in parallel — including rendered results, cost and latency.

**Stack:** React 18 + TypeScript + Vite + Tailwind v4 · FastAPI + SQLAlchemy (async) · PostgreSQL

---

## Quick start

Requirements: Python 3.12+, Node 20+, Docker.

```bash
docker compose up -d
```

**Backend**

```bash
cd backend && python -m venv .venv && .venv/Scripts/python.exe -m pip install -r requirements.txt
```

Set the API key — either in `backend/.env` as `OPENROUTER_API_KEY=sk-or-v1-…` or later in the UI
under *Settings*.

```bash
cd backend && .venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000
```

**Frontend**

```bash
cd frontend && npm install && npm run dev
```

Dashboard: <http://localhost:5173> · API docs: <http://localhost:8000/docs>

Optionally create five example tasks (Markdown, HTML, JSON, code, agent):

```bash
cd backend && .venv/Scripts/python.exe seed.py
```

---

## What the app does

**Model catalog** — every model available on OpenRouter as a card, with input/output price (per 1M
tokens), context length, max output, modalities and capabilities (tool calling, reasoning,
structured output). Filterable by provider, capability, modality, minimum context and price ceiling;
sortable by price, context and recency. The catalog is cached locally and refreshed automatically
once the TTL expires.

**Tasks** — reusable prompt definitions with a system prompt, a user template and `{{placeholders}}`
that are detected as variables automatically. Each task defines how its result is rendered and sets
model parameters (temperature, max tokens, top P, plus arbitrary extras as JSON, e.g.
`{"reasoning": {"effort": "high"}}`).

**Runs** — one task against N models at once. Requests run in parallel (semaphore, 6 by default) and
the UI fills in live. For every model the response, reasoning text, token usage, actual cost
(`usage.cost` from OpenRouter) and latency are recorded. Results can be sorted by speed, cost or
answer length and placed side by side in one or two columns.

**Result rendering** — depending on the task:

| Mode | Rendering |
| --- | --- |
| `markdown` | GitHub-flavored Markdown including tables and syntax highlighting |
| `html` | Live preview in a `sandbox` iframe without `allow-same-origin` |
| `json` | Collapsible tree; optionally enforced as structured output via a JSON schema |
| `code` | Syntax highlighting in the chosen language |
| `auto` | Detects JSON, complete HTML documents and code fences on its own |

**Agent harness** — tasks of type *agent* hand the model a set of tools and let it work in a loop
until it is done or `max_steps` is reached. Every step is recorded and shown live in the UI: what the
model reasoned, which tool it called with which arguments, and what came back.

| Tool | Effect |
| --- | --- |
| `bash` | Shell command in the sandbox; returns exit_code, stdout and stderr |
| `read_file` | Read a file from the workspace |
| `write_file` | Write a file, creating missing directories |
| `list_files` | List a directory recursively |

Configurable per task: tool selection, maximum number of steps, per-command timeout, RAM, CPUs,
network access, and starter files placed in the workspace before the first step. Models without tool
calling are filtered out before launch and rejected with a clear message at run time.

**Checks** — a task can define checkable conditions that are evaluated automatically after every
run. A model passes only when every check passes, which turns the side-by-side comparison into a
pass/fail benchmark: the run list shows `passed/evaluated`, results can be sorted passed-first.

| Check | Applies to | Passes when |
| --- | --- | --- |
| `contains` / `not_contains` | any | the answer does (not) contain the text |
| `regex` | any | a regular expression matches |
| `is_json` | any | the answer parses as JSON (a single ```json fence is unwrapped) |
| `json_schema` | any | the answer validates against the task's JSON schema |
| `min_length` / `max_length` | any | the answer length is within bounds |
| `max_cost_usd` / `max_latency_ms` | any | the item stayed within budget |
| `max_steps` | agent | the agent needed at most N turns |
| `file_exists` / `file_contains` | agent | the file is present / contains the text |
| `command_exit_zero` | agent | the command exits 0 in the finished workspace |

The last one is the interesting one: after the agent reports it is done, the command runs in the
container it left behind, before the sandbox is torn down. For the seeded task *„Agent: find and fix
a bug"* that means `python3 test_stats.py` — exit 0 or it did not work, no room for interpretation.

A check that cannot be evaluated (no JSON schema defined, no cost reported, sandbox unavailable)
counts as failed rather than silently passing, and a model whose run errored out never passes.

**Judge** — for everything a mechanical check cannot decide, a second model scores each answer
against explicit criteria (correctness, instruction following, clarity, conciseness, completeness,
code quality, design, or your own). The judge is **blind**: it never learns which model wrote the
answer, so it cannot go by reputation. The overall score is the mean of the criterion scores,
computed locally rather than asked for — models are noticeably better at scoring one dimension at a
time than at aggregating.

Enable it per task to judge automatically after every result, or press *Judge* on a finished run.
Each judged answer is one extra request to the judge model and shows up as its own cost.

**Manual rating** — one to five stars plus an optional note per result, for what neither checks nor
a judge can settle. Clicking the active star clears the rating. The run list shows the mean of both
scores, and results can be sorted by judge score or by rating.

**History** — every run stores a snapshot of the task, so later prompt edits never distort old
results. Runs can be repeated with identical settings.

---

## Architecture

```
Agent-Arena/
├── docker-compose.yml          Postgres 16 on port 5433
├── backend/
│   ├── app/
│   │   ├── main.py             FastAPI app, CORS, schema init
│   │   ├── config.py           settings from .env
│   │   ├── models.py           SQLAlchemy: catalog, Task, Run, RunItem, AppSetting
│   │   ├── schemas.py          Pydantic schemas of the API
│   │   ├── openrouter.py       HTTP client including error normalisation
│   │   ├── routers/            /api/models, /api/tasks, /api/runs, /api/agent, /api/settings
│   │   └── services/
│   │       ├── catalog.py      fetch and cache the catalog
│   │       ├── runner.py       parallel execution, cost, cancellation
│   │       ├── agent.py        multi-turn agent loop
│   │       ├── agent_tools.py  tool registry and schemas
│   │       ├── sandbox.py      disposable Docker containers
│   │       ├── templating.py   {{variables}}
│   │       └── settings_store.py  key resolution (override beats .env)
│   ├── sandbox/Dockerfile      sandbox base image
│   └── seed.py                 example tasks
└── frontend/src/
    ├── api/                    fetch wrapper, types, React Query hooks
    ├── components/             UI primitives, model cards, result renderer, agent trace
    ├── lib/                    formatting, filter logic, templating
    ├── pages/                  models, tasks, runs, run detail, settings
    └── state/selection.tsx     cross-page model selection (survives reloads)
```

A run is created via `POST /api/runs` and continues as a background task; the frontend polls
`GET /api/runs/{id}` while the status is `running` or `pending`. The schema is created at startup via
`create_all` — deliberately without a migration framework for a local tool.

### Security

The API key lives exclusively in the backend. The frontend talks to relative `/api` URLs, which Vite
proxies to `127.0.0.1:8000` in development — the key never reaches the browser. An override set in
the UI is stored in plain text in the local database and takes precedence over the `.env`; for
everyday use the `.env` is the cleaner option. HTML output renders in an iframe with
`sandbox="allow-scripts"` and without `allow-same-origin`, so it can reach neither the app nor its
storage.

**Agent sandbox.** Every agent run gets its own disposable container, which is removed afterwards. It
has no mount onto your filesystem, no network by default, fixed limits for RAM, CPU and process
count, no Linux capabilities (`--cap-drop ALL`), `no-new-privileges`, and runs as an unprivileged
user. Tool paths are additionally constrained to `/workspace` so an agent cannot accidentally end up
outside its working directory.

The container's root filesystem stays writable on purpose — `read_only` would break `pip install` and
`npm install` without gaining security, since the container is discarded anyway. The isolation
boundary is the container, not the filesystem inside it.

Enabling network access for a task attaches the container to the default bridge network, which lets
it reach out. That is required for tasks that install packages or fetch data, but it does lift the
outbound isolation. On backend startup, containers left behind by crashed runs are collected via the
label `arena-sandbox=1`.

---

## Configuration

All values live in `backend/.env` (template: `.env.example`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | – | API key; can be overridden in the UI |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | API endpoint |
| `OPENROUTER_SITE_URL` / `_APP_NAME` | localhost / Agent Arena | `HTTP-Referer` and `X-Title` |
| `DATABASE_URL` | `…@localhost:5433/arena` | must match `docker-compose.yml` |
| `RUN_CONCURRENCY` | `6` | parallel model requests per one-shot run |
| `AGENT_CONCURRENCY` | `3` | parallel containers per agent run |
| `REQUEST_TIMEOUT_S` | `300` | timeout per model |
| `CATALOG_TTL_MINUTES` | `60` | when the catalog is refreshed automatically |
| `SANDBOX_IMAGE` | `agent-arena-sandbox:latest` | image used for the agent sandbox |
| `DOCKER_BINARY` | `docker` | path to the Docker CLI if it is not on PATH |

The sandbox image is built automatically on the first agent run. To build it up front:

```bash
docker build -t agent-arena-sandbox:latest backend/sandbox
```

It contains Python 3.12, Node, npm, git, curl, jq, ripgrep and tree.

---

## Status and next step

Implemented: catalog, tasks, parallel one-shot runs, agent harness with a Docker sandbox, rendering,
cost tracking, automatic checks, LLM-as-judge, manual rating, history.

**Open — variance.** Every result so far is a single sample, and models are not deterministic. N
repetitions per model would turn pass/fail into a success rate and a judge score into a mean with a
spread. All three scoring layers are already in place, so this is mostly a matter of running each
model k times and aggregating.

Further ideas: a leaderboard across runs, streaming instead of polling, CSV export, image inputs for
multimodal models.
