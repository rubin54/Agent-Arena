import type { ModelInfo } from '../api/types'
import { formatContext, formatTokens, pricePerMillion, providerLabel } from '../lib/format'
import { Badge, Button, Modal, Stat } from './ui'

function PriceRow({ label, value }: { label: string; value: number | null }) {
  if (value === null) return null
  return (
    <div className="flex items-baseline justify-between border-b border-ink-800 py-1.5 text-xs last:border-0">
      <span className="text-ink-400">{label}</span>
      <span className="font-mono text-ink-100">{pricePerMillion(value)}</span>
    </div>
  )
}

export function ModelDetail({
  model,
  open,
  onClose,
  selected,
  onToggle,
}: {
  model: ModelInfo | null
  open: boolean
  onClose: () => void
  selected: boolean
  onToggle: () => void
}) {
  if (!model) return null

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={model.name}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button variant={selected ? 'secondary' : 'primary'} onClick={onToggle}>
            {selected ? 'Remove from selection' : 'Add to selection'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <div>
          <p className="font-mono text-xs break-all text-ink-400">{model.id}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            <Badge tone="neutral">{providerLabel(model.provider)}</Badge>
            {model.tokenizer && <Badge tone="neutral">Tokenizer: {model.tokenizer}</Badge>}
            {model.is_moderated && <Badge tone="amber">moderated</Badge>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 rounded-lg border border-ink-700 bg-ink-900 p-4 sm:grid-cols-4">
          <Stat label="Context" value={formatContext(model.context_length)} />
          <Stat label="Max Output" value={formatTokens(model.max_completion_tokens)} />
          <Stat label="Input / 1M" value={pricePerMillion(model.price_prompt)} />
          <Stat label="Output / 1M" value={pricePerMillion(model.price_completion)} />
        </div>

        {model.description && (
          <div>
            <h3 className="label">Description</h3>
            <p className="text-sm leading-relaxed whitespace-pre-wrap text-ink-300">
              {model.description}
            </p>
          </div>
        )}

        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <h3 className="label">Prices (per 1M tokens, except per request)</h3>
            <div className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-1">
              <PriceRow label="Prompt" value={model.price_prompt} />
              <PriceRow label="Completion" value={model.price_completion} />
              <PriceRow label="Cache read" value={model.price_cache_read} />
              <PriceRow label="Cache write" value={model.price_cache_write} />
              <PriceRow label="Internal reasoning token" value={model.price_internal_reasoning} />
              <PriceRow label="Image" value={model.price_image} />
              <PriceRow label="Web search" value={model.price_web_search} />
              {model.price_request !== null && model.price_request !== 0 && (
                <div className="flex items-baseline justify-between py-1.5 text-xs">
                  <span className="text-ink-400">Per request</span>
                  <span className="font-mono text-ink-100">
                    ${model.price_request.toFixed(6)}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <h3 className="label">Modalities</h3>
              <div className="flex flex-wrap gap-1">
                {model.input_modalities.map((m) => (
                  <Badge key={`in-${m}`} tone="blue">
                    in: {m}
                  </Badge>
                ))}
                {model.output_modalities.map((m) => (
                  <Badge key={`out-${m}`} tone="accent">
                    out: {m}
                  </Badge>
                ))}
              </div>
            </div>

            <div>
              <h3 className="label">Supported parameters</h3>
              <div className="flex flex-wrap gap-1">
                {model.supported_parameters.length ? (
                  model.supported_parameters.map((p) => (
                    <Badge key={p} tone="neutral">
                      {p}
                    </Badge>
                  ))
                ) : (
                  <span className="text-xs text-ink-500">not specified</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  )
}
