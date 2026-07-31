import { Check, Image, Mic, Video, Wrench, Braces, Brain, FileText } from 'lucide-react'
import type { ModelInfo } from '../api/types'
import { formatContext, formatTokens, pricePerMillion, providerLabel } from '../lib/format'
import { CAPABILITIES, hasCapability } from '../lib/modelFilter'
import { Badge, cx } from './ui'

const MODALITY_ICON: Record<string, typeof Image> = {
  image: Image,
  audio: Mic,
  video: Video,
  file: FileText,
}

const CAPABILITY_ICON: Record<string, typeof Wrench> = {
  tools: Wrench,
  structured: Braces,
  reasoning: Brain,
}

export function ModelCard({
  model,
  selected,
  onToggle,
  onOpen,
}: {
  model: ModelInfo
  selected: boolean
  onToggle: () => void
  onOpen: () => void
}) {
  const free = model.price_prompt === 0 && model.price_completion === 0
  const extraModalities = model.input_modalities.filter((m) => m !== 'text')
  const caps = CAPABILITIES.filter((c) => hasCapability(model, c.key) && CAPABILITY_ICON[c.key])

  return (
    <div
      className={cx(
        'group card relative flex flex-col p-4 transition',
        selected
          ? 'border-accent-500 bg-accent-600/[0.07] ring-1 ring-accent-500/40'
          : 'hover:border-ink-600 hover:bg-ink-800/60',
      )}
    >
      <div className="flex items-start gap-3">
        <button
          onClick={onToggle}
          aria-pressed={selected}
          aria-label={selected ? 'Deselect model' : 'Select model'}
          className={cx(
            'mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded border transition',
            selected
              ? 'border-accent-500 bg-accent-600 text-white'
              : 'border-ink-600 hover:border-accent-500',
          )}
        >
          {selected && <Check className="h-3 w-3" strokeWidth={3} />}
        </button>

        <button onClick={onOpen} className="min-w-0 flex-1 text-left">
          <h3 className="truncate text-sm font-semibold text-ink-100 group-hover:text-white">
            {model.name}
          </h3>
          <p className="mt-0.5 truncate font-mono text-[11px] text-ink-500">{model.id}</p>
        </button>
      </div>

      <div className="mt-3 flex flex-wrap gap-1">
        <Badge tone="neutral">{providerLabel(model.provider)}</Badge>
        {free && <Badge tone="green">free</Badge>}
        {extraModalities.map((mod) => {
          const Icon = MODALITY_ICON[mod]
          return (
            <Badge key={mod} tone="blue" title={`Input modality: ${mod}`}>
              {Icon && <Icon className="h-3 w-3" />}
              {mod}
            </Badge>
          )
        })}
        {caps.map((c) => {
          const Icon = CAPABILITY_ICON[c.key]
          return (
            <Badge key={c.key} tone="accent" title={c.label}>
              <Icon className="h-3 w-3" />
              {c.label}
            </Badge>
          )
        })}
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 border-t border-ink-700/70 pt-3">
        <Metric label="Context" value={formatContext(model.context_length)} />
        <Metric label="In / 1M" value={pricePerMillion(model.price_prompt)} />
        <Metric label="Out / 1M" value={pricePerMillion(model.price_completion)} />
      </div>

      {model.max_completion_tokens ? (
        <p className="mt-2 text-[11px] text-ink-500">
          max output: {formatTokens(model.max_completion_tokens)} tokens
        </p>
      ) : null}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-medium tracking-wider text-ink-500 uppercase">{label}</div>
      <div className="mt-0.5 truncate font-mono text-xs text-ink-100" title={value}>
        {value}
      </div>
    </div>
  )
}
