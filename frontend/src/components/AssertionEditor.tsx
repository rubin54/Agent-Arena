import { CheckCheck, Plus, Trash2 } from 'lucide-react'
import { useAssertionTypes } from '../api/queries'
import type { Assertion, TaskKind } from '../api/types'
import { Select } from './FilterControls'
import { Badge, Button, cx } from './ui'

const PLACEHOLDER: Record<string, Record<string, string>> = {
  contains: { value: 'text that must appear' },
  not_contains: { value: 'text that must not appear' },
  regex: { pattern: '^\\s*(def|class)\\s+\\w+' },
  min_length: { value: '200' },
  max_length: { value: '5000' },
  max_cost_usd: { value: '0.05' },
  max_latency_ms: { value: '30000' },
  max_steps: { value: '12' },
  file_exists: { path: 'solution.py' },
  file_contains: { path: 'solution.py', value: 'def solve' },
  command_exit_zero: { command: 'python3 test_solution.py' },
}

const NUMERIC = new Set(['min_length', 'max_length', 'max_cost_usd', 'max_latency_ms', 'max_steps'])

export function AssertionEditor({
  assertions,
  kind,
  hasJsonSchema,
  onChange,
}: {
  assertions: Assertion[]
  kind: TaskKind
  hasJsonSchema: boolean
  onChange: (assertions: Assertion[]) => void
}) {
  const { data: types } = useAssertionTypes()

  // Sandbox checks only make sense when there is a container to run them in.
  const available = (types ?? []).filter((t) => t.scope === 'any' || kind === 'agent')
  const byType = new Map((types ?? []).map((t) => [t.type, t]))

  const patch = (index: number, part: Partial<Assertion>) =>
    onChange(assertions.map((a, i) => (i === index ? { ...a, ...part } : a)))

  const add = () => onChange([...assertions, { type: available[0]?.type ?? 'contains' }])

  const changeType = (index: number, type: string) =>
    // Dropping the old fields avoids leftovers from the previous type in the payload.
    onChange(assertions.map((a, i) => (i === index ? { type, label: a.label } : a)))

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-ink-500">
          Evaluated automatically after every run. A model passes only when every check passes.
          {kind === 'agent' && ' Container checks run in the workspace the agent leaves behind.'}
        </p>
        <Button size="sm" variant="ghost" onClick={add} disabled={!available.length}>
          <Plus className="h-3.5 w-3.5" />
          Check
        </Button>
      </div>

      {assertions.length === 0 ? (
        <div className="flex items-center gap-2 rounded-lg border border-dashed border-ink-700 px-3 py-4 text-xs text-ink-500">
          <CheckCheck className="h-4 w-4 shrink-0" />
          No checks defined — results are shown but not judged.
        </div>
      ) : (
        <div className="space-y-2">
          {assertions.map((assertion, index) => {
            const meta = byType.get(assertion.type)
            const fields = meta?.fields ?? []
            const hints = PLACEHOLDER[assertion.type] ?? {}
            const schemaMissing = assertion.type === 'json_schema' && !hasJsonSchema

            return (
              <div
                key={index}
                className={cx(
                  'rounded-lg border bg-ink-900 p-2.5',
                  schemaMissing ? 'border-amber-800/60' : 'border-ink-700',
                )}
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-center gap-2">
                      <Select
                        className="min-w-56 flex-1"
                        value={assertion.type}
                        options={available.map((t) => ({ label: t.label, value: t.type }))}
                        onChange={(type) => changeType(index, type)}
                      />
                      {meta?.scope === 'agent' && <Badge tone="accent">container</Badge>}
                    </div>

                    {fields.length > 0 && (
                      <div className="grid gap-2 sm:grid-cols-2">
                        {fields.includes('path') && (
                          <input
                            value={assertion.path ?? ''}
                            onChange={(e) => patch(index, { path: e.target.value })}
                            placeholder={hints.path ?? 'path'}
                            className="field h-8 font-mono text-xs"
                          />
                        )}
                        {fields.includes('command') && (
                          <input
                            value={assertion.command ?? ''}
                            onChange={(e) => patch(index, { command: e.target.value })}
                            placeholder={hints.command ?? 'command'}
                            className="field h-8 font-mono text-xs sm:col-span-2"
                          />
                        )}
                        {fields.includes('pattern') && (
                          <input
                            value={assertion.pattern ?? ''}
                            onChange={(e) => patch(index, { pattern: e.target.value })}
                            placeholder={hints.pattern ?? 'regex'}
                            className="field h-8 font-mono text-xs sm:col-span-2"
                          />
                        )}
                        {fields.includes('value') && (
                          <input
                            type={NUMERIC.has(assertion.type) ? 'number' : 'text'}
                            step="any"
                            value={assertion.value ?? ''}
                            onChange={(e) =>
                              patch(index, {
                                value: NUMERIC.has(assertion.type)
                                  ? Number(e.target.value)
                                  : e.target.value,
                              })
                            }
                            placeholder={hints.value ?? 'value'}
                            className="field h-8 font-mono text-xs"
                          />
                        )}
                        {fields.includes('case_sensitive') && (
                          <label className="flex h-8 items-center gap-2 text-xs text-ink-400">
                            <input
                              type="checkbox"
                              checked={Boolean(assertion.case_sensitive)}
                              onChange={(e) => patch(index, { case_sensitive: e.target.checked })}
                              className="h-3.5 w-3.5 accent-violet-500"
                            />
                            case sensitive
                          </label>
                        )}
                      </div>
                    )}

                    {meta && <p className="text-[11px] text-ink-500">{meta.description}</p>}
                    {schemaMissing && (
                      <p className="text-[11px] text-amber-400">
                        This task has no JSON schema yet — set the render mode to JSON and define
                        one, otherwise the check always fails.
                      </p>
                    )}
                  </div>

                  <Button
                    size="sm"
                    variant="ghost"
                    title="Remove check"
                    onClick={() => onChange(assertions.filter((_, i) => i !== index))}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
