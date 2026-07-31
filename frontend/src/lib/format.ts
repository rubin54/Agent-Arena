/** OpenRouter liefert Preise als USD pro Token. Angezeigt wird pro 1 Mio. Token. */
export function pricePerMillion(perToken: number | null | undefined): string {
  if (perToken === null || perToken === undefined) return '—'
  if (perToken < 0) return 'variabel'
  if (perToken === 0) return 'kostenlos'
  const value = perToken * 1_000_000
  if (value < 0.01) return `$${value.toFixed(4)}`
  if (value < 10) return `$${value.toFixed(3)}`
  return `$${value.toFixed(2)}`
}

export function isFree(model: { price_prompt: number | null; price_completion: number | null }) {
  return model.price_prompt === 0 && model.price_completion === 0
}

export function formatContext(tokens: number | null | undefined): string {
  if (!tokens) return '—'
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens % 1_000_000 ? 1 : 0)}M`
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`
  return String(tokens)
}

export function formatTokens(tokens: number | null | undefined): string {
  if (tokens === null || tokens === undefined) return '—'
  return tokens.toLocaleString('de-DE')
}

export function formatCost(usd: number | null | undefined): string {
  if (usd === null || usd === undefined) return '—'
  if (usd === 0) return '$0'
  if (usd < 0.0001) return `<$0.0001`
  if (usd < 1) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(3)}`
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms === null || ms === undefined) return '—'
  if (ms < 1000) return `${ms} ms`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`
  const minutes = Math.floor(ms / 60_000)
  const seconds = Math.round((ms % 60_000) / 1000)
  return `${minutes}m ${seconds}s`
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '—'
  const diff = Date.now() - new Date(iso).getTime()
  const minutes = Math.round(diff / 60_000)
  if (minutes < 1) return 'gerade eben'
  if (minutes < 60) return `vor ${minutes} Min.`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `vor ${hours} Std.`
  const days = Math.round(hours / 24)
  return `vor ${days} Tg.`
}

export function providerLabel(provider: string): string {
  return provider.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}
