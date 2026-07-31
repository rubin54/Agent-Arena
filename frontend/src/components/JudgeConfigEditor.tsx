import { Gavel, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useJudgeCriteria, useModels } from '../api/queries'
import type { JudgeConfig } from '../api/types'
import { pricePerMillion } from '../lib/format'
import { Badge, Button, cx } from './ui'

const DEFAULT_MODEL = 'openai/gpt-4o-mini'

/** Criteria are stored either as preset keys or as full objects. */
function keysOf(config: JudgeConfig): string[] {
  return (config.criteria ?? []).map((c) => (typeof c === 'string' ? c : c.key))
}

export function JudgeConfigEditor({
  config,
  onChange,
}: {
  config: JudgeConfig
  onChange: (config: JudgeConfig) => void
}) {
  const { data: criteria } = useJudgeCriteria()
  const { data: catalog } = useModels()
  const [needle, setNeedle] = useState('')

  const enabled = Boolean(config.enabled)
  const selected = keysOf(config)
  const model = config.model || DEFAULT_MODEL
  const scaleMax = config.scale_max ?? 5

  const patch = (part: Partial<JudgeConfig>) => onChange({ ...config, ...part })

  const matches = useMemo(() => {
    const q = needle.trim().toLowerCase()
    if (!q) return []
    return (catalog?.models ?? [])
      .filter((m) => `${m.name} ${m.id}`.toLowerCase().includes(q))
      .slice(0, 15)
  }, [catalog, needle])

  const toggle = (key: string) =>
    patch({
      criteria: selected.includes(key)
        ? (config.criteria ?? []).filter((c) => (typeof c === 'string' ? c : c.key) !== key)
        : [...(config.criteria ?? []), key],
    })

  return (
    <div className="space-y-4 rounded-lg border border-ink-700 bg-ink-900/50 p-4">
      <button
        onClick={() => patch({ enabled: !enabled })}
        className={cx(
          'flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition',
          enabled
            ? 'border-accent-500 bg-accent-600/10'
            : 'border-ink-700 bg-ink-900 hover:border-ink-600',
        )}
      >
        <Gavel className={cx('h-4 w-4 shrink-0', enabled ? 'text-accent-400' : 'text-ink-500')} />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium">
            {enabled ? 'Judge runs after every result' : 'Judge disabled'}
          </div>
          <div className="mt-0.5 text-[11px] text-ink-500">
            A second model scores each answer against your criteria. It never learns which model
            wrote the answer, so it cannot go by reputation.
          </div>
        </div>
      </button>

      {enabled && (
        <>
          <div>
            <label className="label">Judge model</label>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md border border-ink-600 bg-ink-800 px-2 py-1 font-mono text-xs text-ink-200">
                {model}
              </span>
              {model !== DEFAULT_MODEL && (
                <button
                  onClick={() => patch({ model: DEFAULT_MODEL })}
                  className="text-xs text-ink-500 hover:text-ink-300"
                >
                  Reset
                </button>
              )}
            </div>
            <div className="relative mt-2">
              <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-500" />
              <input
                value={needle}
                onChange={(e) => setNeedle(e.target.value)}
                placeholder="Pick a different judge model…"
                className="field h-8 pl-9 text-xs"
              />
            </div>
            {matches.length > 0 && (
              <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-ink-700">
                {matches.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => {
                      patch({ model: m.id })
                      setNeedle('')
                    }}
                    className="flex w-full items-center justify-between gap-3 border-b border-ink-800 px-3 py-1.5 text-left text-xs last:border-0 hover:bg-ink-800"
                  >
                    <span className="truncate font-mono text-[11px]">{m.id}</span>
                    <span className="shrink-0 font-mono text-[10px] text-ink-500">
                      {pricePerMillion(m.price_prompt)}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <p className="mt-1 text-[11px] text-ink-500">
              Every judged answer is one extra request to this model — it shows up in the run cost.
            </p>
          </div>

          <div>
            <label className="label">Criteria</label>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {(criteria ?? []).map((c) => {
                const active = selected.includes(c.key)
                return (
                  <button
                    key={c.key}
                    onClick={() => toggle(c.key)}
                    title={c.description}
                    className={cx(
                      'rounded-lg border px-3 py-2 text-left transition',
                      active
                        ? 'border-accent-500 bg-accent-600/10'
                        : 'border-ink-700 bg-ink-900 hover:border-ink-600',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className={cx(
                          'h-2 w-2 shrink-0 rounded-full',
                          active ? 'bg-accent-500' : 'bg-ink-600',
                        )}
                      />
                      <span className="text-xs font-medium">{c.label}</span>
                    </div>
                    <p className="mt-0.5 pl-4 text-[10px] leading-snug text-ink-500">
                      {c.description}
                    </p>
                  </button>
                )
              })}
            </div>
            {selected.length === 0 && (
              <p className="mt-1.5 text-[11px] text-ink-500">
                None selected — correctness, instruction following and clarity are used by default.
              </p>
            )}
          </div>

          <div>
            <label className="label">Scale</label>
            <div className="flex items-center gap-2">
              {[3, 5, 10].map((n) => (
                <Button
                  key={n}
                  size="sm"
                  variant={scaleMax === n ? 'primary' : 'secondary'}
                  onClick={() => patch({ scale_max: n })}
                >
                  1–{n}
                </Button>
              ))}
              <Badge tone="neutral">mean of all criteria</Badge>
            </div>
          </div>

          {selected.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {selected.map((key) => (
                <button
                  key={key}
                  onClick={() => toggle(key)}
                  className="inline-flex items-center gap-1 rounded-md border border-ink-600 bg-ink-800 px-1.5 py-0.5 text-[11px] text-ink-300 hover:border-red-800 hover:text-red-300"
                >
                  {key}
                  <X className="h-3 w-3" />
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
