import { Check, CheckCircle2, ChevronDown, Copy, Maximize2, XCircle } from 'lucide-react'
import { useState } from 'react'
import type { RenderMode, RunItem } from '../api/types'
import { formatCost, formatDuration, formatTokens } from '../lib/format'
import { AgentTrace } from './AgentTrace'
import { ResultRenderer } from './ResultRenderer'
import { Badge, Button, ErrorBox, Spinner, StatusBadge, cx } from './ui'

type View = 'rendered' | 'raw' | 'trace'

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

  const steps = item.steps ?? []
  const isAgent = steps.length > 0
  const assertionResults = item.assertion_results ?? []

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
        <div className="flex shrink-0 items-center gap-1.5">
          {item.passed !== null && (
            <Badge tone={item.passed ? 'green' : 'red'}>
              {item.passed ? (
                <CheckCircle2 className="h-3 w-3" />
              ) : (
                <XCircle className="h-3 w-3" />
              )}
              {item.passed ? 'Passed' : 'Failed'}
            </Badge>
          )}
          <StatusBadge status={item.status} />
        </div>
      </header>

      {assertionResults.length > 0 && (
        <ul className="divide-y divide-ink-800 border-b border-ink-700 bg-ink-900/40">
          {assertionResults.map((result, i) => (
            <li key={i} className="flex items-start gap-2 px-4 py-1.5">
              {result.passed ? (
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-400" />
              ) : (
                <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" />
              )}
              <div className="min-w-0 flex-1">
                <span className="text-[11px] text-ink-200">{result.label}</span>
                {result.detail && (
                  <span className="ml-1.5 font-mono text-[10px] break-all text-ink-500">
                    {result.detail}
                  </span>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="grid grid-cols-4 gap-2 border-b border-ink-700 bg-ink-900/50 px-4 py-2.5">
        <Metric label="Time" value={formatDuration(item.latency_ms)} />
        <Metric label="Cost" value={formatCost(item.cost_usd)} />
        <Metric label="In" value={formatTokens(item.prompt_tokens)} />
        <Metric
          label="Out"
          value={formatTokens(item.completion_tokens)}
          title={
            item.reasoning_tokens
              ? `of which ${formatTokens(item.reasoning_tokens)} reasoning tokens`
              : undefined
          }
        />
      </div>

      <div className="min-h-0 flex-1 px-4 py-3">
        {item.status === 'pending' && (
          <p className="py-8 text-center text-xs text-ink-500">Waiting for a free slot…</p>
        )}
        {item.status === 'running' &&
          (isAgent ? (
            // Agent runs record their steps as they go -- show them live.
            <div className={cx('overflow-y-auto', compact ? 'max-h-96' : 'max-h-[32rem]')}>
              <AgentTrace steps={steps} running />
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-ink-400">
              <Spinner /> Generating response…
            </div>
          ))}
        {item.status === 'cancelled' && (
          <p className="py-8 text-center text-xs text-amber-400">Cancelled.</p>
        )}
        {item.status === 'failed' && (
          <div className="space-y-3">
            <ErrorBox>{item.error ?? 'Unknown error'}</ErrorBox>
            {isAgent && (
              <div className={cx('overflow-y-auto', compact && 'max-h-80')}>
                <AgentTrace steps={steps} />
              </div>
            )}
          </div>
        )}

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
                  Reasoning ({formatTokens(item.reasoning_tokens)} tokens)
                </button>
                {showReasoning && (
                  <pre className="max-h-72 overflow-y-auto border-t border-ink-700 px-3 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-ink-400">
                    {item.reasoning_text}
                  </pre>
                )}
              </div>
            )}

            <div className={cx('overflow-x-auto', compact && 'max-h-96 overflow-y-auto')}>
              {view === 'trace' ? (
                <AgentTrace steps={steps} />
              ) : view === 'rendered' ? (
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
              Rendered
            </ViewTab>
            <ViewTab active={view === 'raw'} onClick={() => setView('raw')}>
              Raw
            </ViewTab>
            {isAgent && (
              <ViewTab active={view === 'trace'} onClick={() => setView('trace')}>
                Trace ({steps.filter((s) => s.type === 'tool_result').length})
              </ViewTab>
            )}
            {item.finish_reason && item.finish_reason !== 'stop' && (
              <Badge tone="amber" title="finish_reason">
                {item.finish_reason}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={copy}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
            {onExpand && (
              <Button size="sm" variant="ghost" onClick={onExpand} title="Show large">
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
