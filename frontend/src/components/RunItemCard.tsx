import { Check, ChevronDown, Copy, Maximize2 } from 'lucide-react'
import { useState } from 'react'
import type { RenderMode, RunItem } from '../api/types'
import { formatCost, formatDuration, formatTokens } from '../lib/format'
import { ResultRenderer } from './ResultRenderer'
import { Badge, Button, ErrorBox, Spinner, StatusBadge, cx } from './ui'

type View = 'rendered' | 'raw'

export function RunItemCard({
  item,
  renderMode,
  codeLanguage,
  onExpand,
  compact = false,
}: {
  item: RunItem
  renderMode: RenderMode
  codeLanguage?: string | null
  onExpand?: () => void
  compact?: boolean
}) {
  const [view, setView] = useState<View>('rendered')
  const [copied, setCopied] = useState(false)
  const [showReasoning, setShowReasoning] = useState(false)

  const copy = async () => {
    if (!item.output_text) return
    await navigator.clipboard.writeText(item.output_text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="card flex min-w-0 flex-col">
      <header className="flex items-start justify-between gap-2 border-b border-ink-700 px-4 py-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold">{item.model_name}</h3>
          <p className="truncate font-mono text-[11px] text-ink-500">{item.model_id}</p>
        </div>
        <StatusBadge status={item.status} />
      </header>

      <div className="grid grid-cols-4 gap-2 border-b border-ink-700 bg-ink-900/50 px-4 py-2.5">
        <Metric label="Zeit" value={formatDuration(item.latency_ms)} />
        <Metric label="Kosten" value={formatCost(item.cost_usd)} />
        <Metric label="In" value={formatTokens(item.prompt_tokens)} />
        <Metric
          label="Out"
          value={formatTokens(item.completion_tokens)}
          title={
            item.reasoning_tokens
              ? `davon ${formatTokens(item.reasoning_tokens)} Reasoning-Token`
              : undefined
          }
        />
      </div>

      <div className="min-h-0 flex-1 px-4 py-3">
        {item.status === 'pending' && (
          <p className="py-8 text-center text-xs text-ink-500">Wartet auf freien Slot…</p>
        )}
        {item.status === 'running' && (
          <div className="flex items-center justify-center gap-2 py-8 text-xs text-ink-400">
            <Spinner /> Antwort wird generiert…
          </div>
        )}
        {item.status === 'cancelled' && (
          <p className="py-8 text-center text-xs text-amber-400">Abgebrochen.</p>
        )}
        {item.status === 'failed' && <ErrorBox>{item.error ?? 'Unbekannter Fehler'}</ErrorBox>}

        {item.status === 'completed' && item.output_text && (
          <div className="space-y-3">
            {item.reasoning_text && (
              <div className="rounded-lg border border-ink-700 bg-ink-900">
                <button
                  onClick={() => setShowReasoning((s) => !s)}
                  className="flex w-full items-center gap-1.5 px-3 py-2 text-xs text-ink-400 hover:text-ink-100"
                >
                  <ChevronDown
                    className={cx('h-3.5 w-3.5 transition', showReasoning && 'rotate-180')}
                  />
                  Reasoning ({formatTokens(item.reasoning_tokens)} Token)
                </button>
                {showReasoning && (
                  <pre className="max-h-72 overflow-y-auto border-t border-ink-700 px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-ink-400">
                    {item.reasoning_text}
                  </pre>
                )}
              </div>
            )}

            <div className={cx('overflow-x-auto', compact && 'max-h-96 overflow-y-auto')}>
              {view === 'rendered' ? (
                <ResultRenderer
                  text={item.output_text}
                  mode={renderMode}
                  codeLanguage={codeLanguage}
                />
              ) : (
                <pre className="font-mono text-xs leading-relaxed whitespace-pre-wrap text-ink-300">
                  {item.output_text}
                </pre>
              )}
            </div>
          </div>
        )}
      </div>

      {item.status === 'completed' && item.output_text && (
        <footer className="flex items-center justify-between gap-2 border-t border-ink-700 px-3 py-2">
          <div className="flex items-center gap-1">
            <ViewTab active={view === 'rendered'} onClick={() => setView('rendered')}>
              Gerendert
            </ViewTab>
            <ViewTab active={view === 'raw'} onClick={() => setView('raw')}>
              Rohtext
            </ViewTab>
            {item.finish_reason && item.finish_reason !== 'stop' && (
              <Badge tone="amber" title="finish_reason">
                {item.finish_reason}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={copy}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Kopiert' : 'Kopieren'}
            </Button>
            {onExpand && (
              <Button size="sm" variant="ghost" onClick={onExpand} title="Groß anzeigen">
                <Maximize2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </footer>
      )}
    </div>
  )
}

function ViewTab({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'rounded-md px-2 py-1 text-xs transition',
        active ? 'bg-ink-700 text-ink-100' : 'text-ink-500 hover:text-ink-300',
      )}
    >
      {children}
    </button>
  )
}

function Metric({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="min-w-0" title={title}>
      <div className="text-[10px] font-medium tracking-wider text-ink-500 uppercase">{label}</div>
      <div className="mt-0.5 truncate font-mono text-xs text-ink-100">{value}</div>
    </div>
  )
}
