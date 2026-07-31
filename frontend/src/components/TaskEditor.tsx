import { AlertTriangle, Eye, Save, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { RenderMode, Task, TaskInput, TaskKind } from '../api/types'
import { extractVariables, renderTemplate, syncVariables } from '../lib/template'
import { Select } from './FilterControls'
import { Badge, Button, ErrorBox, Modal, cx } from './ui'

const RENDER_MODES: { value: RenderMode; label: string }[] = [
  { value: 'auto', label: 'Automatisch erkennen' },
  { value: 'markdown', label: 'Markdown' },
  { value: 'html', label: 'HTML (Sandbox-Preview)' },
  { value: 'json', label: 'JSON' },
  { value: 'code', label: 'Code' },
  { value: 'text', label: 'Klartext' },
]

const KINDS: { value: TaskKind; label: string }[] = [
  { value: 'one_shot', label: 'One-Shot Prompt' },
  { value: 'agent', label: 'Agent-Harness (in Arbeit)' },
]

const KNOWN_PARAMS = ['temperature', 'max_tokens', 'top_p'] as const

export const EMPTY_TASK: TaskInput = {
  name: '',
  description: '',
  kind: 'one_shot',
  system_prompt: '',
  prompt_template: '',
  variables: [],
  render_mode: 'auto',
  code_language: null,
  json_schema: null,
  params: {},
  agent_config: {},
  default_model_ids: [],
}

function splitParams(params: Record<string, unknown>) {
  const known: Record<string, string> = {}
  const extra: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(params ?? {})) {
    if ((KNOWN_PARAMS as readonly string[]).includes(key)) known[key] = String(value)
    else extra[key] = value
  }
  return { known, extra }
}

export function TaskEditor({
  task,
  onSave,
  onDelete,
  saving,
  error,
}: {
  task: Task | TaskInput
  onSave: (input: TaskInput) => void
  onDelete?: () => void
  saving: boolean
  error?: string | null
}) {
  const [draft, setDraft] = useState<TaskInput>(() => ({ ...EMPTY_TASK, ...task }))
  const initialParams = useMemo(() => splitParams(task.params ?? {}), [task])
  const [knownParams, setKnownParams] = useState<Record<string, string>>(initialParams.known)
  const [extraParams, setExtraParams] = useState(() =>
    Object.keys(initialParams.extra).length ? JSON.stringify(initialParams.extra, null, 2) : '',
  )
  const [schemaText, setSchemaText] = useState(() =>
    task.json_schema ? JSON.stringify(task.json_schema, null, 2) : '',
  )
  const [preview, setPreview] = useState(false)

  // Beim Wechsel der ausgewählten Task den Entwurf komplett neu aufsetzen.
  const taskId = 'id' in task ? task.id : '__new__'
  useEffect(() => {
    const next = { ...EMPTY_TASK, ...task }
    setDraft(next)
    const split = splitParams(task.params ?? {})
    setKnownParams(split.known)
    setExtraParams(Object.keys(split.extra).length ? JSON.stringify(split.extra, null, 2) : '')
    setSchemaText(task.json_schema ? JSON.stringify(task.json_schema, null, 2) : '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId])

  const detected = useMemo(
    () => extractVariables(draft.system_prompt, draft.prompt_template),
    [draft.system_prompt, draft.prompt_template],
  )
  const variables = useMemo(
    () => syncVariables(detected, draft.variables),
    [detected, draft.variables],
  )

  const extraError = useMemo(() => parseError(extraParams), [extraParams])
  const schemaError = useMemo(() => parseError(schemaText), [schemaText])

  const patch = (part: Partial<TaskInput>) => setDraft((d) => ({ ...d, ...part }))

  const setVariable = (name: string, part: Partial<{ description: string; default: string }>) => {
    patch({
      variables: variables.map((v) => (v.name === name ? { ...v, ...part } : v)),
    })
  }

  const handleSave = () => {
    const params: Record<string, unknown> = { ...safeParse(extraParams) }
    for (const key of KNOWN_PARAMS) {
      const raw = knownParams[key]
      if (raw !== undefined && raw !== '') {
        const num = Number(raw)
        if (!Number.isNaN(num)) params[key] = num
      }
    }
    onSave({
      ...draft,
      variables,
      params,
      json_schema: safeParse(schemaText),
      code_language: draft.code_language?.trim() ? draft.code_language.trim() : null,
    })
  }

  const canSave = draft.name.trim() !== '' && !extraError && !schemaError && !saving

  return (
    <div className="space-y-6">
      {error && <ErrorBox>{error}</ErrorBox>}

      <Section title="Grunddaten">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Name</label>
            <input
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
              placeholder="z. B. Landing-Page aus Briefing"
              className="field"
            />
          </div>
          <div>
            <label className="label">Typ</label>
            <Select
              value={draft.kind}
              options={KINDS}
              onChange={(kind) => patch({ kind })}
            />
          </div>
        </div>
        <div>
          <label className="label">Beschreibung</label>
          <input
            value={draft.description}
            onChange={(e) => patch({ description: e.target.value })}
            placeholder="Wozu dient diese Aufgabe?"
            className="field"
          />
        </div>
        {draft.kind === 'agent' && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-800/50 bg-amber-950/20 px-3 py-2 text-xs text-amber-300">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>
              Agent-Tasks lassen sich speichern, aber noch nicht ausführen – das Harness kommt im
              nächsten Schritt.
            </span>
          </div>
        )}
      </Section>

      <Section
        title="Prompt"
        hint="Platzhalter im Format {{name}} werden automatisch als Variable erkannt."
      >
        <div>
          <label className="label">System-Prompt</label>
          <textarea
            value={draft.system_prompt}
            onChange={(e) => patch({ system_prompt: e.target.value })}
            rows={4}
            placeholder="Optionale Rollen-/Verhaltensvorgabe"
            className="field resize-y font-mono text-xs"
          />
        </div>
        <div>
          <label className="label">User-Prompt</label>
          <textarea
            value={draft.prompt_template}
            onChange={(e) => patch({ prompt_template: e.target.value })}
            rows={10}
            placeholder="Schreibe eine Landing-Page für {{produkt}} …"
            className="field resize-y font-mono text-xs"
          />
        </div>

        {variables.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="label mb-0">Erkannte Variablen</span>
              <Badge tone="accent">{variables.length}</Badge>
            </div>
            <div className="space-y-2">
              {variables.map((v) => (
                <div key={v.name} className="grid gap-2 sm:grid-cols-[10rem_1fr_1fr]">
                  <div className="flex h-9 items-center rounded-lg border border-ink-700 bg-ink-900 px-3 font-mono text-xs text-accent-400">
                    {v.name}
                  </div>
                  <input
                    value={v.description}
                    onChange={(e) => setVariable(v.name, { description: e.target.value })}
                    placeholder="Beschreibung"
                    className="field"
                  />
                  <input
                    value={v.default}
                    onChange={(e) => setVariable(v.name, { default: e.target.value })}
                    placeholder="Standardwert"
                    className="field"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        <Button variant="ghost" size="sm" onClick={() => setPreview(true)}>
          <Eye className="h-3.5 w-3.5" />
          Prompt-Vorschau
        </Button>
      </Section>

      <Section title="Ausgabe">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Darstellung des Ergebnisses</label>
            <Select
              value={draft.render_mode}
              options={RENDER_MODES}
              onChange={(render_mode) => patch({ render_mode })}
            />
          </div>
          {draft.render_mode === 'code' && (
            <div>
              <label className="label">Sprache für Syntax-Highlighting</label>
              <input
                value={draft.code_language ?? ''}
                onChange={(e) => patch({ code_language: e.target.value })}
                placeholder="python, typescript, sql …"
                className="field"
              />
            </div>
          )}
        </div>

        {draft.render_mode === 'json' && (
          <div>
            <label className="label">
              JSON-Schema (optional – erzwingt Structured Output beim Modell)
            </label>
            <textarea
              value={schemaText}
              onChange={(e) => setSchemaText(e.target.value)}
              rows={8}
              placeholder='{ "type": "object", "properties": { … }, "required": [ … ] }'
              className={cx('field resize-y font-mono text-xs', schemaError && 'border-red-700')}
            />
            {schemaError && <p className="mt-1 text-xs text-red-400">{schemaError}</p>}
            <p className="mt-1 text-xs text-ink-500">
              Wird nur an Modelle geschickt, die <code>structured_outputs</code> unterstützen –
              andere Modelle antworten dann evtl. frei formuliert.
            </p>
          </div>
        )}
      </Section>

      <Section title="Modell-Parameter" hint="Gelten für alle Modelle dieses Runs.">
        <div className="grid gap-3 sm:grid-cols-3">
          <NumberField
            label="Temperature"
            value={knownParams.temperature ?? ''}
            placeholder="Modell-Default"
            onChange={(v) => setKnownParams((p) => ({ ...p, temperature: v }))}
          />
          <NumberField
            label="Max Tokens"
            value={knownParams.max_tokens ?? ''}
            placeholder="Modell-Default"
            onChange={(v) => setKnownParams((p) => ({ ...p, max_tokens: v }))}
          />
          <NumberField
            label="Top P"
            value={knownParams.top_p ?? ''}
            placeholder="Modell-Default"
            onChange={(v) => setKnownParams((p) => ({ ...p, top_p: v }))}
          />
        </div>
        <div>
          <label className="label">Weitere Parameter (JSON, wird 1:1 durchgereicht)</label>
          <textarea
            value={extraParams}
            onChange={(e) => setExtraParams(e.target.value)}
            rows={5}
            placeholder={'{\n  "reasoning": { "effort": "high" }\n}'}
            className={cx('field resize-y font-mono text-xs', extraError && 'border-red-700')}
          />
          {extraError && <p className="mt-1 text-xs text-red-400">{extraError}</p>}
        </div>
      </Section>

      <div className="flex items-center justify-between gap-2 border-t border-ink-700 pt-4">
        {onDelete ? (
          <Button variant="danger" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
            Löschen
          </Button>
        ) : (
          <span />
        )}
        <Button variant="primary" onClick={handleSave} disabled={!canSave} loading={saving}>
          <Save className="h-3.5 w-3.5" />
          Speichern
        </Button>
      </div>

      <PromptPreviewModal
        open={preview}
        onClose={() => setPreview(false)}
        systemPrompt={draft.system_prompt}
        userPrompt={draft.prompt_template}
        values={Object.fromEntries(variables.map((v) => [v.name, v.default]))}
      />
    </div>
  )
}

function PromptPreviewModal({
  open,
  onClose,
  systemPrompt,
  userPrompt,
  values,
}: {
  open: boolean
  onClose: () => void
  systemPrompt: string
  userPrompt: string
  values: Record<string, string>
}) {
  return (
    <Modal open={open} onClose={onClose} title="Prompt-Vorschau (mit Standardwerten)" wide>
      <div className="space-y-4">
        {systemPrompt.trim() && (
          <div>
            <span className="label">System</span>
            <pre className="overflow-x-auto rounded-lg border border-ink-700 bg-ink-900 p-3 font-mono text-xs whitespace-pre-wrap">
              {renderTemplate(systemPrompt, values)}
            </pre>
          </div>
        )}
        <div>
          <span className="label">User</span>
          <pre className="overflow-x-auto rounded-lg border border-ink-700 bg-ink-900 p-3 font-mono text-xs whitespace-pre-wrap">
            {renderTemplate(userPrompt, values) || '(leer)'}
          </pre>
        </div>
      </div>
    </Modal>
  )
}

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold text-ink-100">{title}</h3>
        {hint && <p className="mt-0.5 text-xs text-ink-500">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function NumberField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string
  value: string
  placeholder?: string
  onChange: (value: string) => void
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        type="number"
        step="any"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="field"
      />
    </div>
  )
}

function safeParse(text: string): Record<string, unknown> | null {
  if (!text.trim()) return null
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch {
    return null
  }
}

function parseError(text: string): string | null {
  if (!text.trim()) return null
  try {
    JSON.parse(text)
    return null
  } catch (e) {
    return `Ungültiges JSON: ${(e as Error).message}`
  }
}
