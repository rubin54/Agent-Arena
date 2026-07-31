import type { TaskVariable } from '../api/types'

const VARIABLE_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g

/** Mirrors the backend logic in `services/templating.py`. */
export function extractVariables(...texts: string[]): string[] {
  const seen: string[] = []
  for (const text of texts) {
    for (const match of (text ?? '').matchAll(VARIABLE_RE)) {
      if (!seen.includes(match[1])) seen.push(match[1])
    }
  }
  return seen
}

export function renderTemplate(template: string, values: Record<string, string>): string {
  return (template ?? '').replace(VARIABLE_RE, (full, name: string) =>
    values[name] !== undefined && values[name] !== '' ? values[name] : full,
  )
}

/** Merge detected placeholders with the metadata already maintained. */
export function syncVariables(detected: string[], existing: TaskVariable[]): TaskVariable[] {
  const byName = new Map(existing.map((v) => [v.name, v]))
  return detected.map((name) => byName.get(name) ?? { name, description: '', default: '' })
}

export function defaultValues(variables: TaskVariable[]): Record<string, string> {
  return Object.fromEntries(variables.map((v) => [v.name, v.default ?? '']))
}
