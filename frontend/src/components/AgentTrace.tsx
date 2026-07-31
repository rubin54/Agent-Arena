import {
  AlertCircle,
  Check,
  ChevronRight,
  FileInput,
  FileText,
  FolderTree,
  MessageSquare,
  Pencil,
  Terminal,
} from 'lucide-react'
import { useState } from 'react'
import type { RunStep, StepToolCall } from '../api/types'
import { formatDuration } from '../lib/format'
import { Badge, cx } from './ui'

const TOOL_ICON: Record<string, typeof Terminal> = {
  bash: Terminal,
  read_file: FileText,
  write_file: Pencil,
  list_files: FolderTree,
}

/** Short form of a tool call for the header row -- the command or path. */
function summarize(name: string | null | undefined, args: Record<string, unknown>): string {
  if (name === 'bash' && typeof args.command === 'string') return args.command
  if (typeof args.path === 'string') return args.path
  const entries = Object.entries(args)
  return entries.length ? entries.map(([k, v]) => `${k}=${String(v).slice(0, 40)}`).join(' ') : ''
}

function ToolCallRow({ call }: { call: StepToolCall }) {
  const Icon = TOOL_ICON[call.name ?? ''] ?? Terminal
  return (
    <div className="flex items-start gap-2 rounded-md border border-ink-700 bg-ink-900 px-2.5 py-1.5">
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-400" />
      <div className="min-w-0 flex-1">
        <span className="font-mono text-[11px] text-accent-400">{call.name}</span>
        <pre className="mt-0.5 overflow-x-auto font-mono text-[11px] whitespace-pre-wrap text-ink-300">
          {summarize(call.name, call.arguments)}
        </pre>
      </div>
    </div>
  )
}

function AssistantStep({ step }: { step: RunStep }) {
  const [showReasoning, setShowReasoning] = useState(false)
  const hasCalls = (step.tool_calls?.length ?? 0) > 0

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <MessageSquare className="h-3.5 w-3.5 text-ink-500" />
        <span className="text-xs font-medium text-ink-300">Turn {step.turn}</span>
        {step.latency_ms !== undefined && (
          <span className="font-mono text-[11px] text-ink-500">
            {formatDuration(step.latency_ms)}
          </span>
        )}
        {!hasCalls && <Badge tone="green">Final</Badge>}
      </div>

      {step.reasoning && (
        <div className="rounded-md border border-ink-700 bg-ink-900">
          <button
            onClick={() => setShowReasoning((s) => !s)}
            className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-[11px] text-ink-500 hover:text-ink-300"
          >
            <ChevronRight className={cx('h-3 w-3 transition', showReasoning && 'rotate-90')} />
            Reasoning
          </button>
          {showReasoning && (
            <pre className="max-h-64 overflow-y-auto border-t border-ink-700 px-2.5 py-2 font-mono text-[11px] whitespace-pre-wrap text-ink-400">
              {step.reasoning}
            </pre>
          )}
        </div>
      )}

      {step.content && (
        <p className="text-xs leading-relaxed whitespace-pre-wrap text-ink-200">{step.content}</p>
      )}

      {hasCalls && (
        <div className="space-y-1.5">
          {step.tool_calls!.map((call, i) => (
            <ToolCallRow key={call.id ?? i} call={call} />
          ))}
        </div>
      )}
    </div>
  )
}

function ToolResultStep({ step }: { step: RunStep }) {
  const [open, setOpen] = useState(false)
  const Icon = TOOL_ICON[step.name ?? ''] ?? Terminal
  const exitCode = step.meta?.exit_code
  const output = step.output ?? ''
  const preview = output.split('\n').slice(0, 2).join('\n')
  const hasMore = output.split('\n').length > 2 || output.length > 160

  return (
    <div
      className={cx(
        'rounded-md border',
        step.ok ? 'border-ink-700 bg-ink-900' : 'border-red-900/50 bg-red-950/20',
      )}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
        disabled={!hasMore}
      >
        {hasMore ? (
          <ChevronRight className={cx('h-3 w-3 shrink-0 text-ink-500 transition', open && 'rotate-90')} />
        ) : (
          <span className="w-3" />
        )}
        <Icon className="h-3.5 w-3.5 shrink-0 text-ink-500" />
        <span className="font-mono text-[11px] text-ink-400">{step.name}</span>
        {step.ok ? (
          <Check className="h-3 w-3 shrink-0 text-emerald-400" />
        ) : (
          <AlertCircle className="h-3 w-3 shrink-0 text-red-400" />
        )}
        {exitCode !== undefined && exitCode !== 0 && (
          <span className="font-mono text-[10px] text-red-400">exit {exitCode}</span>
        )}
        <span className="ml-auto shrink-0 font-mono text-[10px] text-ink-600">
          {formatDuration(step.duration_ms)}
        </span>
      </button>

      <pre
        className={cx(
          'overflow-x-auto border-t border-ink-800 px-2.5 py-1.5 font-mono text-[11px] whitespace-pre-wrap',
          step.ok ? 'text-ink-400' : 'text-red-300',
          open ? 'max-h-96 overflow-y-auto' : 'max-h-16 overflow-hidden',
        )}
      >
        {open ? output : preview || '(no output)'}
      </pre>
    </div>
  )
}

export function AgentTrace({ steps, running }: { steps: RunStep[]; running?: boolean }) {
  if (!steps.length) {
    return (
      <p className="py-4 text-center text-xs text-ink-500">
        {running ? 'Sandbox starting…' : 'No trace recorded.'}
      </p>
    )
  }

  return (
    <ol className="space-y-2.5">
      {steps.map((step) => (
        <li key={step.index} className="border-l-2 border-ink-700 pl-3">
          {step.type === 'setup' && (
            <div className="flex items-center gap-2 text-xs text-ink-400">
              <FileInput className="h-3.5 w-3.5 text-ink-500" />
              Starter files created:{' '}
              <span className="font-mono text-[11px] text-ink-300">
                {(step.files ?? []).join(', ')}
              </span>
            </div>
          )}
          {step.type === 'assistant' && <AssistantStep step={step} />}
          {step.type === 'tool_result' && <ToolResultStep step={step} />}
        </li>
      ))}
      {running && (
        <li className="border-l-2 border-accent-600 pl-3">
          <span className="text-xs text-accent-400">Agent working…</span>
        </li>
      )}
    </ol>
  )
}
