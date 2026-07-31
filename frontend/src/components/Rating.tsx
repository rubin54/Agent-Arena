import { Gavel, MessageSquarePlus, Star } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSetRating } from '../api/queries'
import type { JudgeResult } from '../api/types'
import { formatCost } from '../lib/format'
import { Badge, cx } from './ui'

/** Five stars plus an optional note. Clicking the active star clears the rating. */
export function RatingStars({
  runId,
  itemId,
  rating,
  note,
}: {
  runId: string
  itemId: string
  rating: number | null
  note: string | null
}) {
  const setRating = useSetRating()
  const [hover, setHover] = useState(0)
  const [noteOpen, setNoteOpen] = useState(false)
  const [draft, setDraft] = useState(note ?? '')

  // The run is polled while active, so keep the field in sync with the server.
  useEffect(() => setDraft(note ?? ''), [note])

  const shown = hover || rating || 0

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <div className="flex items-center" onMouseLeave={() => setHover(0)}>
          {[1, 2, 3, 4, 5].map((value) => (
            <button
              key={value}
              onMouseEnter={() => setHover(value)}
              onClick={() =>
                setRating.mutate({
                  runId,
                  itemId,
                  // Clicking the star that is already set removes the rating.
                  rating: rating === value ? 0 : value,
                })
              }
              aria-label={`Rate ${value} of 5`}
              className="p-0.5 transition hover:scale-110"
            >
              <Star
                className={cx(
                  'h-4 w-4',
                  value <= shown ? 'fill-amber-400 text-amber-400' : 'text-ink-600',
                )}
              />
            </button>
          ))}
        </div>

        <button
          onClick={() => setNoteOpen((o) => !o)}
          title={note ? 'Edit note' : 'Add a note'}
          className={cx(
            'rounded p-1 transition',
            note ? 'text-accent-400' : 'text-ink-600 hover:text-ink-300',
          )}
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
        </button>

        {note && !noteOpen && (
          <span className="min-w-0 flex-1 truncate text-[11px] text-ink-400" title={note}>
            {note}
          </span>
        )}
      </div>

      {noteOpen && (
        <div className="flex gap-1.5">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setRating.mutate({ runId, itemId, note: draft })
                setNoteOpen(false)
              }
              if (e.key === 'Escape') setNoteOpen(false)
            }}
            onBlur={() => {
              if (draft !== (note ?? '')) setRating.mutate({ runId, itemId, note: draft })
              setNoteOpen(false)
            }}
            autoFocus
            placeholder="Why this rating? (Enter to save)"
            className="field h-7 text-xs"
          />
        </div>
      )}
    </div>
  )
}

export function JudgeVerdict({ result }: { result: JudgeResult }) {
  const [open, setOpen] = useState(false)

  if (result.error) {
    return (
      <div className="flex items-start gap-2 px-4 py-2 text-[11px] text-amber-400">
        <Gavel className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>Judge: {result.error}</span>
      </div>
    )
  }

  return (
    <div className="border-b border-ink-700 bg-ink-900/40">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-4 py-2 text-left"
      >
        <Gavel className="h-3.5 w-3.5 shrink-0 text-accent-400" />
        <span className="font-mono text-xs text-ink-100">
          {result.score?.toFixed(1)}
          <span className="text-ink-500">/{result.scale_max}</span>
        </span>
        {result.summary && (
          <span className="min-w-0 flex-1 truncate text-[11px] text-ink-400">
            {result.summary}
          </span>
        )}
        <span className="shrink-0 text-[10px] text-ink-600">{open ? 'less' : 'details'}</span>
      </button>

      {open && (
        <div className="space-y-1.5 px-4 pt-1 pb-2.5">
          {result.criteria.map((c) => (
            <div key={c.key} className="flex items-start gap-2">
              <span className="w-10 shrink-0 font-mono text-[11px] text-ink-300">
                {c.score}/{result.scale_max}
              </span>
              <div className="min-w-0 flex-1">
                <span className="text-[11px] font-medium text-ink-200">{c.label}</span>
                {c.reason && (
                  <p className="text-[11px] leading-snug text-ink-500">{c.reason}</p>
                )}
              </div>
            </div>
          ))}
          <div className="flex flex-wrap gap-1 pt-1">
            <Badge tone="neutral">{result.model}</Badge>
            {result.cost_usd !== null && (
              <Badge tone="neutral">judge cost {formatCost(result.cost_usd)}</Badge>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
