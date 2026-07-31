import { ArrowLeft, Ban, Columns2, Rows3, RotateCw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useCancelRun, useRerun, useRun } from '../api/queries'
import type { RenderMode, RunItem } from '../api/types'
import { ResultRenderer } from '../components/ResultRenderer'
import { RunItemCard } from '../components/RunItemCard'
import { Select } from '../components/FilterControls'
import { Badge, Button, ErrorBox, Modal, Spinner, Stat, StatusBadge, cx } from '../components/ui'
import { formatCost, formatDateTime, formatDuration, formatTokens } from '../lib/format'

type ItemSort = 'position' | 'latency' | 'cost' | 'length'

const SORTS: { value: ItemSort; label: string }[] = [
  { value: 'position', label: 'Auswahlreihenfolge' },
  { value: 'latency', label: 'Schnellste zuerst' },
  { value: 'cost', label: 'Günstigste zuerst' },
  { value: 'length', label: 'Längste Antwort zuerst' },
]

function sortItems(items: RunItem[], sort: ItemSort): RunItem[] {
  const copy = [...items]
  const last = Number.POSITIVE_INFINITY
  switch (sort) {
    case 'latency':
      return copy.sort((a, b) => (a.latency_ms ?? last) - (b.latency_ms ?? last))
    case 'cost':
      return copy.sort((a, b) => (a.cost_usd ?? last) - (b.cost_usd ?? last))
    case 'length':
      return copy.sort((a, b) => (b.output_text?.length ?? 0) - (a.output_text?.length ?? 0))
    default:
      return copy.sort((a, b) => a.position - b.position)
  }
}

export function RunDetailPage() {
  const { runId } = useParams<{ runId: string }>()
  const navigate = useNavigate()
  const { data: run, isLoading, error } = useRun(runId)
  const cancelRun = useCancelRun()
  const rerun = useRerun()

  const [sort, setSort] = useState<ItemSort>('position')
  const [columns, setColumns] = useState<2 | 1>(2)
  const [expanded, setExpanded] = useState<RunItem | null>(null)

  const snapshot = (run?.task_snapshot ?? {}) as {
    render_mode?: RenderMode
    code_language?: string | null
    prompt_template?: string
    system_prompt?: string
  }
  const renderMode = snapshot.render_mode ?? 'auto'

  const items = useMemo(() => sortItems(run?.items ?? [], sort), [run?.items, sort])
  const stats = useMemo(() => {
    const done = (run?.items ?? []).filter((i) => i.status === 'completed')
    const latencies = done.map((i) => i.latency_ms ?? 0).filter(Boolean)
    return {
      totalTokens: done.reduce((sum, i) => sum + (i.total_tokens ?? 0), 0),
      avgLatency: latencies.length
        ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
        : null,
    }
  }, [run?.items])

  if (isLoading) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="h-6 w-6" />
      </div>
    )
  }
  if (error || !run) {
    return <ErrorBox>{(error as Error)?.message ?? 'Run nicht gefunden'}</ErrorBox>
  }

  const isActive = run.status === 'running' || run.status === 'pending'

  return (
    <div className="space-y-5">
      <header className="space-y-3">
        <Link
          to="/runs"
          className="inline-flex items-center gap-1.5 text-xs text-ink-400 hover:text-ink-100"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Alle Runs
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold">{run.label || run.task_name}</h1>
              <StatusBadge status={run.status} />
            </div>
            <p className="mt-0.5 text-xs text-ink-500">
              {formatDateTime(run.created_at)} · {run.item_count} Modelle ·{' '}
              {run.completed_count} fertig
              {run.failed_count > 0 && ` · ${run.failed_count} fehlgeschlagen`}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {isActive && (
              <Button
                variant="danger"
                onClick={() => cancelRun.mutate(run.id)}
                loading={cancelRun.isPending}
              >
                <Ban className="h-3.5 w-3.5" />
                Abbrechen
              </Button>
            )}
            <Button
              onClick={async () => {
                const next = await rerun.mutateAsync(run.id)
                navigate(`/runs/${next.id}`)
              }}
              loading={rerun.isPending}
            >
              <RotateCw className="h-3.5 w-3.5" />
              Erneut ausführen
            </Button>
          </div>
        </div>

        {run.error && <ErrorBox>{run.error}</ErrorBox>}

        <div className="card grid grid-cols-2 gap-4 p-4 sm:grid-cols-4">
          <Stat label="Gesamtkosten" value={formatCost(run.total_cost_usd)} />
          <Stat label="Token gesamt" value={formatTokens(stats.totalTokens)} />
          <Stat label="Ø Antwortzeit" value={formatDuration(stats.avgLatency)} />
          <Stat
            label="Dauer"
            value={
              run.started_at && run.finished_at
                ? formatDuration(
                    new Date(run.finished_at).getTime() - new Date(run.started_at).getTime(),
                  )
                : isActive
                  ? 'läuft…'
                  : '—'
            }
          />
        </div>

        <PromptDetails
          systemPrompt={snapshot.system_prompt ?? ''}
          promptTemplate={snapshot.prompt_template ?? ''}
          values={run.variable_values}
        />
      </header>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Select
          className="min-w-52"
          value={sort}
          options={SORTS.map((s) => ({ label: `Sortierung: ${s.label}`, value: s.value }))}
          onChange={setSort}
        />
        <div className="flex items-center gap-1 rounded-lg border border-ink-700 p-0.5">
          <LayoutButton active={columns === 2} onClick={() => setColumns(2)} title="Zwei Spalten">
            <Columns2 className="h-4 w-4" />
          </LayoutButton>
          <LayoutButton active={columns === 1} onClick={() => setColumns(1)} title="Eine Spalte">
            <Rows3 className="h-4 w-4" />
          </LayoutButton>
        </div>
      </div>

      <div className={cx('grid gap-4', columns === 2 && 'xl:grid-cols-2')}>
        {items.map((item) => (
          <RunItemCard
            key={item.id}
            item={item}
            renderMode={renderMode}
            codeLanguage={snapshot.code_language}
            compact={columns === 2}
            onExpand={() => setExpanded(item)}
          />
        ))}
      </div>

      <Modal
        open={Boolean(expanded)}
        onClose={() => setExpanded(null)}
        title={expanded?.model_name ?? ''}
        wide
      >
        {expanded?.output_text && (
          <ResultRenderer
            text={expanded.output_text}
            mode={renderMode}
            codeLanguage={snapshot.code_language}
          />
        )}
      </Modal>
    </div>
  )
}

function PromptDetails({
  systemPrompt,
  promptTemplate,
  values,
}: {
  systemPrompt: string
  promptTemplate: string
  values: Record<string, string>
}) {
  const [open, setOpen] = useState(false)
  const entries = Object.entries(values ?? {})

  return (
    <details
      className="card px-4 py-3"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="cursor-pointer list-none text-xs font-medium text-ink-400 hover:text-ink-100">
        Prompt &amp; Variablen dieses Runs
      </summary>
      <div className="mt-3 space-y-3">
        {entries.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {entries.map(([key, value]) => (
              <Badge key={key} tone="accent" title={String(value)}>
                {key} = {String(value).slice(0, 40) || '(leer)'}
              </Badge>
            ))}
          </div>
        )}
        {systemPrompt && (
          <div>
            <span className="label">System</span>
            <pre className="overflow-x-auto rounded-lg border border-ink-700 bg-ink-900 p-3 font-mono text-[11px] whitespace-pre-wrap text-ink-300">
              {systemPrompt}
            </pre>
          </div>
        )}
        <div>
          <span className="label">User (Template)</span>
          <pre className="overflow-x-auto rounded-lg border border-ink-700 bg-ink-900 p-3 font-mono text-[11px] whitespace-pre-wrap text-ink-300">
            {promptTemplate}
          </pre>
        </div>
      </div>
    </details>
  )
}

function LayoutButton({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cx(
        'rounded-md p-1.5 transition',
        active ? 'bg-ink-700 text-ink-100' : 'text-ink-500 hover:text-ink-300',
      )}
    >
      {children}
    </button>
  )
}
