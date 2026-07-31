import { Loader2, X } from 'lucide-react'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { useEffect } from 'react'

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}

// --------------------------------------------------------------------- Button

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent-600 text-white hover:bg-accent-500 disabled:hover:bg-accent-600',
  secondary: 'border border-ink-600 bg-ink-800 text-ink-100 hover:border-ink-500 hover:bg-ink-700',
  ghost: 'text-ink-300 hover:bg-ink-800 hover:text-ink-100',
  danger: 'border border-red-900/60 bg-red-950/40 text-red-300 hover:bg-red-900/40',
}

const SIZES: Record<Size, string> = {
  sm: 'h-8 gap-1.5 px-2.5 text-xs',
  md: 'h-9 gap-2 px-3.5 text-sm',
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-lg font-medium transition',
        'focus-visible:ring-2 focus-visible:ring-accent-500/50 focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
      {children}
    </button>
  )
}

// --------------------------------------------------------------------- Badge

export function Badge({
  children,
  tone = 'neutral',
  title,
}: {
  children: ReactNode
  tone?: 'neutral' | 'accent' | 'green' | 'red' | 'amber' | 'blue'
  title?: string
}) {
  const tones = {
    neutral: 'border-ink-600 bg-ink-800 text-ink-300',
    accent: 'border-accent-600/50 bg-accent-600/15 text-accent-400',
    green: 'border-emerald-700/50 bg-emerald-900/25 text-emerald-300',
    red: 'border-red-800/60 bg-red-950/40 text-red-300',
    amber: 'border-amber-700/50 bg-amber-900/25 text-amber-300',
    blue: 'border-sky-700/50 bg-sky-900/25 text-sky-300',
  }
  return (
    <span
      title={title}
      className={cx(
        'inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium whitespace-nowrap',
        tones[tone],
      )}
    >
      {children}
    </span>
  )
}

export function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { tone: Parameters<typeof Badge>[0]['tone']; label: string }> = {
    pending: { tone: 'neutral', label: 'Waiting' },
    running: { tone: 'blue', label: 'Running' },
    completed: { tone: 'green', label: 'Done' },
    failed: { tone: 'red', label: 'Failed' },
    cancelled: { tone: 'amber', label: 'Cancelled' },
  }
  const entry = map[status] ?? { tone: 'neutral' as const, label: status }
  return (
    <Badge tone={entry.tone}>
      {status === 'running' && <Loader2 className="h-3 w-3 animate-spin" />}
      {entry.label}
    </Badge>
  )
}

// --------------------------------------------------------------------- Modal

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide = false,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 backdrop-blur-sm sm:p-8">
      <div
        className={cx(
          'card my-auto w-full shadow-2xl shadow-black/50',
          wide ? 'max-w-4xl' : 'max-w-xl',
        )}
      >
        <div className="flex items-center justify-between border-b border-ink-700 px-5 py-3.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-ink-400 transition hover:bg-ink-800 hover:text-ink-100"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-ink-700 px-5 py-3.5">{footer}</div>
        )}
      </div>
    </div>
  )
}

// --------------------------------------------------------------------- Misc

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cx('h-4 w-4 animate-spin text-ink-400', className)} />
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode
  title: string
  hint?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-ink-700 px-6 py-16 text-center">
      {icon && <div className="mb-3 text-ink-500">{icon}</div>}
      <p className="text-sm font-medium text-ink-300">{title}</p>
      {hint && <p className="mt-1 max-w-md text-xs text-ink-500">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

export function ErrorBox({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-red-900/60 bg-red-950/30 px-3.5 py-2.5 text-xs leading-relaxed break-words text-red-300">
      {children}
    </div>
  )
}

export function Stat({ label, value, title }: { label: string; value: ReactNode; title?: string }) {
  return (
    <div title={title}>
      <div className="text-[10px] font-medium tracking-wider text-ink-500 uppercase">{label}</div>
      <div className="mt-0.5 font-mono text-sm text-ink-100">{value}</div>
    </div>
  )
}
