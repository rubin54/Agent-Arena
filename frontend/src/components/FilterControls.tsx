import { ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { cx } from './ui'

export function Select<T extends string | number | null>({
  value,
  options,
  onChange,
  className,
}: {
  value: T
  options: { label: string; value: T }[]
  onChange: (value: T) => void
  className?: string
}) {
  const index = options.findIndex((o) => o.value === value)
  return (
    <div className={cx('relative', className)}>
      <select
        value={index < 0 ? 0 : index}
        onChange={(e) => onChange(options[Number(e.target.value)].value)}
        className="field cursor-pointer appearance-none pr-8"
      >
        {options.map((o, i) => (
          <option key={`${o.label}-${i}`} value={i}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-2.5 h-4 w-4 -translate-y-1/2 text-ink-500" />
    </div>
  )
}

/** Mehrfachauswahl in einem Dropdown -- für Provider-Listen mit dreistelliger Länge. */
export function MultiSelect({
  label,
  options,
  selected,
  onChange,
  searchable = false,
}: {
  label: string
  options: { value: string; label: string; hint?: string }[]
  selected: string[]
  onChange: (values: string[]) => void
  searchable?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [needle, setNeedle] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [open])

  const visible = needle
    ? options.filter((o) => o.label.toLowerCase().includes(needle.toLowerCase()))
    : options

  const toggle = (value: string) =>
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className={cx(
          'field flex items-center justify-between gap-2 text-left',
          selected.length > 0 && 'border-accent-500/60',
        )}
      >
        <span className={cx('truncate', !selected.length && 'text-ink-500')}>
          {selected.length ? `${label} (${selected.length})` : label}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-ink-500" />
      </button>

      {open && (
        <div className="absolute z-30 mt-1 max-h-72 w-full min-w-56 overflow-y-auto rounded-lg border border-ink-600 bg-ink-850 p-1 shadow-xl shadow-black/50">
          {searchable && (
            <input
              autoFocus
              value={needle}
              onChange={(e) => setNeedle(e.target.value)}
              placeholder="Suchen…"
              className="field mb-1 h-8 text-xs"
            />
          )}
          {selected.length > 0 && (
            <button
              onClick={() => onChange([])}
              className="mb-1 w-full rounded px-2 py-1.5 text-left text-xs text-ink-400 hover:bg-ink-800 hover:text-ink-100"
            >
              Auswahl zurücksetzen
            </button>
          )}
          {visible.map((o) => (
            <label
              key={o.value}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-ink-800"
            >
              <input
                type="checkbox"
                checked={selected.includes(o.value)}
                onChange={() => toggle(o.value)}
                className="h-3.5 w-3.5 accent-violet-500"
              />
              <span className="flex-1 truncate">{o.label}</span>
              {o.hint && <span className="font-mono text-[10px] text-ink-500">{o.hint}</span>}
            </label>
          ))}
          {!visible.length && <p className="px-2 py-3 text-xs text-ink-500">Keine Treffer</p>}
        </div>
      )}
    </div>
  )
}

export function Toggle({
  checked,
  onChange,
  children,
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  children: ReactNode
}) {
  return (
    <button
      onClick={() => onChange(!checked)}
      aria-pressed={checked}
      className={cx(
        'inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm transition',
        checked
          ? 'border-accent-500 bg-accent-600/15 text-accent-400'
          : 'border-ink-700 bg-ink-900 text-ink-400 hover:border-ink-600 hover:text-ink-100',
      )}
    >
      {children}
    </button>
  )
}
