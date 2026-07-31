import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { cx } from './ui'

function Primitive({ value }: { value: unknown }) {
  if (value === null) return <span className="text-ink-500">null</span>
  switch (typeof value) {
    case 'string':
      return <span className="break-all text-emerald-300">"{value}"</span>
    case 'number':
      return <span className="text-amber-300">{String(value)}</span>
    case 'boolean':
      return <span className="text-sky-300">{String(value)}</span>
    default:
      return <span className="text-ink-300">{String(value)}</span>
  }
}

function Node({ name, value, depth }: { name: string | null; value: unknown; depth: number }) {
  // Deep nesting stays collapsed so long responses remain manageable.
  const [open, setOpen] = useState(depth < 2)
  const isObject = value !== null && typeof value === 'object'

  if (!isObject) {
    return (
      <div className="flex gap-1.5 py-px">
        {name !== null && <span className="shrink-0 text-accent-400">{name}:</span>}
        <Primitive value={value} />
      </div>
    )
  }

  const isArray = Array.isArray(value)
  const entries = isArray
    ? (value as unknown[]).map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>)
  const summary = isArray ? `[${entries.length}]` : `{${entries.length}}`

  return (
    <div className="py-px">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1 rounded text-left hover:bg-ink-800/60"
      >
        <ChevronRight
          className={cx('h-3 w-3 shrink-0 text-ink-500 transition', open && 'rotate-90')}
        />
        {name !== null && <span className="text-accent-400">{name}:</span>}
        <span className="text-ink-500">{summary}</span>
      </button>
      {open && (
        <div className="ml-3 border-l border-ink-700 pl-3">
          {entries.map(([key, val]) => (
            <Node key={key} name={key} value={val} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

export function JsonView({ data }: { data: unknown }) {
  return (
    <div className="overflow-x-auto font-mono text-xs leading-relaxed">
      <Node name={null} value={data} depth={0} />
    </div>
  )
}
