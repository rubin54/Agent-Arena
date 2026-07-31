"""Legt ein paar Beispiel-Aufgaben an, die die verschiedenen Render-Modi zeigen.

    python seed.py

Bereits vorhandene Aufgaben mit gleichem Namen werden übersprungen.
"""

import asyncio

from sqlalchemy import select

from app.db import SessionLocal, init_db
from app.models import Task

EXAMPLES: list[dict] = [
    {
        "name": "Erklärung schreiben (Markdown)",
        "description": "Klassischer One-Shot-Prompt, Ergebnis wird als Markdown gerendert.",
        "system_prompt": "Du bist ein präziser technischer Autor. Antworte auf Deutsch.",
        "prompt_template": (
            "Erkläre {{thema}} für {{zielgruppe}}.\n\n"
            "Struktur:\n"
            "1. Kernidee in zwei Sätzen\n"
            "2. Wie es funktioniert (Aufzählung)\n"
            "3. Ein konkretes Beispiel\n"
            "4. Häufigster Denkfehler\n\n"
            "Maximal 300 Wörter."
        ),
        "variables": [
            {"name": "thema", "description": "Was erklärt werden soll", "default": "Vektor-Embeddings"},
            {"name": "zielgruppe", "description": "Wissensstand der Leser", "default": "Backend-Entwickler ohne ML-Vorwissen"},
        ],
        "render_mode": "markdown",
        "params": {"temperature": 0.4, "max_tokens": 900},
    },
    {
        "name": "Landing-Page bauen (HTML)",
        "description": "Prüft Design- und Frontend-Fähigkeiten. Ergebnis läuft in einem Sandbox-iframe.",
        "system_prompt": (
            "Du lieferst genau eine vollständige HTML-Datei zurück – kein Fließtext, keine Erklärung. "
            "Alles Nötige (CSS, ggf. JS) steht inline im Dokument. Keine externen Requests."
        ),
        "prompt_template": (
            "Baue eine Landing-Page für {{produkt}}.\n\n"
            "Zielgruppe: {{zielgruppe}}\n"
            "Tonalität: {{tonalitaet}}\n\n"
            "Pflicht: Hero mit klarem Nutzenversprechen, drei Feature-Blöcke, "
            "Preis-Sektion, ein Call-to-Action. Responsive, dunkles Theme, "
            "moderne Typografie."
        ),
        "variables": [
            {"name": "produkt", "description": "Was beworben wird", "default": "ein CLI-Tool zum Aufräumen von Docker-Images"},
            {"name": "zielgruppe", "description": "Wer angesprochen wird", "default": "DevOps-Teams in kleinen Firmen"},
            {"name": "tonalitaet", "description": "Sprachlicher Stil", "default": "sachlich, technisch, ohne Marketing-Floskeln"},
        ],
        "render_mode": "html",
        "params": {"temperature": 0.8, "max_tokens": 8000},
    },
    {
        "name": "Daten extrahieren (JSON)",
        "description": "Structured Output – testet, wie zuverlässig ein Modell ein Schema einhält.",
        "system_prompt": "Du extrahierst Daten und antwortest ausschließlich mit JSON.",
        "prompt_template": (
            "Extrahiere die strukturierten Daten aus folgendem Text:\n\n"
            "---\n{{text}}\n---"
        ),
        "variables": [
            {
                "name": "text",
                "description": "Rohtext, aus dem extrahiert wird",
                "default": (
                    "Rechnung 2024-0815 vom 12.03.2024. Kunde: Meier GmbH, Hamburg. "
                    "Positionen: 3x Serverwartung à 450,00 EUR, 1x Notfall-Einsatz 890,50 EUR. "
                    "Zahlbar bis 26.03.2024."
                ),
            }
        ],
        "render_mode": "json",
        "json_schema": {
            "type": "object",
            "properties": {
                "rechnungsnummer": {"type": "string"},
                "datum": {"type": "string"},
                "kunde": {"type": "string"},
                "positionen": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "bezeichnung": {"type": "string"},
                            "menge": {"type": "number"},
                            "einzelpreis_eur": {"type": "number"},
                        },
                        "required": ["bezeichnung", "menge", "einzelpreis_eur"],
                        "additionalProperties": False,
                    },
                },
                "gesamtbetrag_eur": {"type": "number"},
                "faellig_am": {"type": "string"},
            },
            "required": [
                "rechnungsnummer",
                "datum",
                "kunde",
                "positionen",
                "gesamtbetrag_eur",
                "faellig_am",
            ],
            "additionalProperties": False,
        },
        "params": {"temperature": 0, "max_tokens": 1500},
    },
    {
        "name": "Algorithmus implementieren (Code)",
        "description": "Vergleicht Code-Qualität bei identischer Aufgabenstellung.",
        "system_prompt": "Antworte mit genau einem Code-Block, ohne Vor- und Nachrede.",
        "prompt_template": (
            "Implementiere in {{sprache}}: {{aufgabe}}\n\n"
            "Anforderungen: typisiert, Randfälle abgedeckt, kurze Docstrings, keine externen Abhängigkeiten."
        ),
        "variables": [
            {"name": "sprache", "description": "Programmiersprache", "default": "Python"},
            {
                "name": "aufgabe",
                "description": "Was implementiert werden soll",
                "default": "ein LRU-Cache mit O(1) get und put",
            },
        ],
        "render_mode": "code",
        "code_language": "python",
        "params": {"temperature": 0.2, "max_tokens": 2000},
    },
]


async def main() -> None:
    await init_db()
    async with SessionLocal() as session:
        existing = set((await session.execute(select(Task.name))).scalars().all())
        added = 0
        for example in EXAMPLES:
            if example["name"] in existing:
                print(f"  übersprungen (existiert): {example['name']}")
                continue
            session.add(Task(**example))
            added += 1
            print(f"  angelegt: {example['name']}")
        await session.commit()
    print(f"\n{added} Aufgabe(n) angelegt.")


if __name__ == "__main__":
    asyncio.run(main())
