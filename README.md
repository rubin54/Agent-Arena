# Agent Arena

Lokales Dashboard, um LLMs über [OpenRouter](https://openrouter.ai) zu vergleichen: kompletter
Modell-Katalog mit Preisen und Context-Längen, selbst definierte Aufgaben und One-Shot-Runs, die
parallel gegen beliebig viele Modelle laufen — inklusive gerenderter Ergebnisse, Kosten und Latenzen.

**Stack:** React 18 + TypeScript + Vite + Tailwind v4 · FastAPI + SQLAlchemy (async) · PostgreSQL

---

## Schnellstart

Voraussetzungen: Python 3.12+, Node 20+, Docker.

```bash
docker compose up -d
```

**Backend**

```bash
cd backend && python -m venv .venv && .venv/Scripts/python.exe -m pip install -r requirements.txt
```

API-Key eintragen — entweder in `backend/.env` als `OPENROUTER_API_KEY=sk-or-v1-…`
oder später im UI unter *Einstellungen*.

```bash
cd backend && .venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000
```

**Frontend**

```bash
cd frontend && npm install && npm run dev
```

Dashboard: <http://localhost:5173> · API-Docs: <http://localhost:8000/docs>

Optional vier Beispiel-Aufgaben anlegen (Markdown, HTML, JSON, Code):

```bash
cd backend && .venv/Scripts/python.exe seed.py
```

---

## Was die App kann

**Modell-Katalog** — alle bei OpenRouter verfügbaren Modelle als Kacheln mit Input-/Output-Preis
(pro 1M Token), Context-Länge, max. Output, Modalitäten und Fähigkeiten (Tool Calling, Reasoning,
Structured Output). Filterbar nach Anbieter, Fähigkeit, Modalität, Mindest-Context und Preisgrenze;
sortierbar nach Preis, Context, Aktualität. Der Katalog wird lokal gecacht und nach Ablauf der TTL
automatisch neu geladen.

**Aufgaben** — wiederverwendbare Prompt-Definitionen mit System-Prompt, User-Template und
`{{platzhaltern}}`, die automatisch als Variablen erkannt werden. Pro Aufgabe legst du fest, wie das
Ergebnis dargestellt wird, und setzt Modell-Parameter (Temperature, Max Tokens, Top P sowie beliebige
weitere als JSON, z. B. `{"reasoning": {"effort": "high"}}`).

**Runs** — eine Aufgabe gegen N Modelle gleichzeitig. Die Anfragen laufen parallel (Semaphore,
Standard 6), die Oberfläche füllt sich live. Pro Modell werden Antwort, Reasoning-Text,
Token-Verbrauch, tatsächliche Kosten (`usage.cost` von OpenRouter) und Latenz erfasst. Ergebnisse
lassen sich nach Geschwindigkeit, Kosten oder Antwortlänge sortieren und ein- oder zweispaltig
nebeneinanderlegen.

**Ergebnis-Rendering** — je nach Aufgabe:

| Modus | Darstellung |
| --- | --- |
| `markdown` | GitHub-Flavored Markdown inkl. Tabellen und Syntax-Highlighting |
| `html` | Live-Preview in einem `sandbox`-iframe ohne `allow-same-origin` |
| `json` | aufklappbarer Baum; optional per JSON-Schema als Structured Output erzwungen |
| `code` | Syntax-Highlighting in der gewählten Sprache |
| `auto` | erkennt JSON / vollständiges HTML / Code-Fences selbst |

**Historie** — jeder Run speichert einen Snapshot der Aufgabe. Spätere Änderungen am Prompt
verfälschen alte Ergebnisse nicht. Runs lassen sich mit identischen Einstellungen wiederholen.

---

## Architektur

```
Agent-Arena/
├── docker-compose.yml          Postgres 16 auf Port 5433
├── backend/
│   ├── app/
│   │   ├── main.py             FastAPI-App, CORS, Schema-Init
│   │   ├── config.py           Settings aus .env
│   │   ├── models.py           SQLAlchemy: Katalog, Task, Run, RunItem, AppSetting
│   │   ├── schemas.py          Pydantic-Schemas der API
│   │   ├── openrouter.py       HTTP-Client inkl. Fehler-Normalisierung
│   │   ├── routers/            /api/models, /api/tasks, /api/runs, /api/settings
│   │   └── services/
│   │       ├── catalog.py      Katalog laden und cachen
│   │       ├── runner.py       parallele Ausführung, Kosten, Abbruch
│   │       ├── templating.py   {{variablen}}
│   │       └── settings_store.py  Key-Auflösung (Override vor .env)
│   └── seed.py                 Beispiel-Aufgaben
└── frontend/src/
    ├── api/                    Fetch-Wrapper, Typen, React-Query-Hooks
    ├── components/             UI-Primitive, Modell-Karten, Ergebnis-Renderer
    ├── lib/                    Formatierung, Filterlogik, Templating
    ├── pages/                  Modelle, Aufgaben, Runs, Run-Detail, Einstellungen
    └── state/selection.tsx     modellübergreifende Auswahl (überlebt Reloads)
```

Ein Run wird per `POST /api/runs` angelegt und läuft als Hintergrund-Task weiter; das Frontend
pollt `GET /api/runs/{id}`, solange der Status `running` oder `pending` ist. Das Schema wird beim
Start via `create_all` angelegt — für ein lokales Tool bewusst ohne Migrations-Framework.

### Sicherheit

Der API-Key liegt ausschließlich im Backend. Das Frontend spricht relative `/api`-URLs an, die Vite
im Dev-Betrieb auf `127.0.0.1:8000` proxyt — der Key erreicht den Browser nie. Ein im UI gesetzter
Override landet im Klartext in der lokalen Datenbank und sticht die `.env`; für den Dauerbetrieb ist
die `.env` die sauberere Variante. HTML-Ausgaben laufen in einem iframe mit `sandbox="allow-scripts"`
ohne `allow-same-origin`, haben also keinen Zugriff auf die App oder deren Storage.

---

## Konfiguration

Alle Werte in `backend/.env` (Vorlage: `.env.example`):

| Variable | Default | Bedeutung |
| --- | --- | --- |
| `OPENROUTER_API_KEY` | – | Key; im UI überschreibbar |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | API-Endpunkt |
| `OPENROUTER_SITE_URL` / `_APP_NAME` | localhost / Agent Arena | `HTTP-Referer` und `X-Title` |
| `DATABASE_URL` | `…@localhost:5433/arena` | muss zu `docker-compose.yml` passen |
| `RUN_CONCURRENCY` | `6` | parallele Modell-Anfragen pro Run |
| `REQUEST_TIMEOUT_S` | `300` | Timeout pro Modell |
| `CATALOG_TTL_MINUTES` | `60` | ab wann der Katalog automatisch neu geladen wird |

---

## Stand und nächster Schritt

Das One-Shot-Fundament ist vollständig: Katalog, Aufgaben, parallele Runs, Rendering, Kosten,
Historie.

**Agent-Harness (noch offen).** Datenmodell und Runner sind darauf vorbereitet — `Task.kind`
kennt bereits `agent`, `Task.agent_config` steht für Tool-Konfiguration bereit, und `RunItem.messages`
/ `RunItem.steps` können einen mehrstufigen Verlauf mit Tool-Calls aufnehmen. Aufgaben vom Typ
`agent` lassen sich anlegen und speichern; `POST /api/runs` lehnt sie derzeit mit HTTP 400 ab. Zu
bauen sind: Tool-Registry mit Sandbox, Multi-Turn-Loop in `services/runner.py` und die
Schritt-Visualisierung im Frontend.
