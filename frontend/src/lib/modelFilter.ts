import type { ModelInfo } from '../api/types'

export type SortKey =
  | 'name'
  | 'newest'
  | 'context_desc'
  | 'price_in_asc'
  | 'price_in_desc'
  | 'price_out_asc'
  | 'price_out_desc'

export interface ModelFilters {
  search: string
  providers: string[]
  inputModalities: string[]
  capabilities: string[]
  minContext: number
  maxPromptPricePerM: number | null
  freeOnly: boolean
  sort: SortKey
}

export const DEFAULT_FILTERS: ModelFilters = {
  search: '',
  providers: [],
  inputModalities: [],
  capabilities: [],
  minContext: 0,
  maxPromptPricePerM: null,
  freeOnly: false,
  sort: 'name',
}

/** OpenRouter reports capabilities through `supported_parameters`. */
export const CAPABILITIES: { key: string; label: string; params: string[] }[] = [
  { key: 'tools', label: 'Tool calling', params: ['tools', 'tool_choice'] },
  { key: 'reasoning', label: 'Reasoning', params: ['reasoning', 'include_reasoning'] },
  { key: 'structured', label: 'Structured output', params: ['structured_outputs'] },
  { key: 'json', label: 'JSON Mode', params: ['response_format'] },
  { key: 'seed', label: 'Seed', params: ['seed'] },
  { key: 'logprobs', label: 'Logprobs', params: ['logprobs', 'top_logprobs'] },
]

export function hasCapability(model: ModelInfo, key: string): boolean {
  const cap = CAPABILITIES.find((c) => c.key === key)
  if (!cap) return false
  return cap.params.some((p) => model.supported_parameters.includes(p))
}

export const CONTEXT_STEPS = [
  { label: 'Any', value: 0 },
  { label: '≥ 32K', value: 32_000 },
  { label: '≥ 128K', value: 128_000 },
  { label: '≥ 200K', value: 200_000 },
  { label: '≥ 1M', value: 1_000_000 },
]

export const PRICE_STEPS = [
  { label: 'Any', value: null },
  { label: '≤ $0.50 / M', value: 0.5 },
  { label: '≤ $1 / M', value: 1 },
  { label: '≤ $3 / M', value: 3 },
  { label: '≤ $10 / M', value: 10 },
]

export const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'name', label: 'Name (A-Z)' },
  { value: 'newest', label: 'Newest first' },
  { value: 'context_desc', label: 'Largest context' },
  { value: 'price_in_asc', label: 'Input price ↑' },
  { value: 'price_in_desc', label: 'Input price ↓' },
  { value: 'price_out_asc', label: 'Output price ↑' },
  { value: 'price_out_desc', label: 'Output price ↓' },
]

/** Models without a known price sort to the end rather than the front. */
function priceKey(value: number | null): number {
  if (value === null || value < 0) return Number.POSITIVE_INFINITY
  return value
}

export function applyFilters(models: ModelInfo[], filters: ModelFilters): ModelInfo[] {
  const needle = filters.search.trim().toLowerCase()

  const filtered = models.filter((m) => {
    if (needle) {
      const haystack = `${m.name} ${m.id} ${m.description}`.toLowerCase()
      if (!haystack.includes(needle)) return false
    }
    if (filters.providers.length && !filters.providers.includes(m.provider)) return false
    if (
      filters.inputModalities.length &&
      !filters.inputModalities.every((mod) => m.input_modalities.includes(mod))
    ) {
      return false
    }
    if (filters.capabilities.length && !filters.capabilities.every((c) => hasCapability(m, c))) {
      return false
    }
    if (filters.minContext && (m.context_length ?? 0) < filters.minContext) return false
    if (filters.freeOnly && !(m.price_prompt === 0 && m.price_completion === 0)) return false
    if (filters.maxPromptPricePerM !== null) {
      const perM = m.price_prompt === null ? null : m.price_prompt * 1_000_000
      if (perM === null || perM < 0 || perM > filters.maxPromptPricePerM) return false
    }
    return true
  })

  const sorted = [...filtered]
  switch (filters.sort) {
    case 'newest':
      sorted.sort((a, b) => (b.created_ts ?? 0) - (a.created_ts ?? 0))
      break
    case 'context_desc':
      sorted.sort((a, b) => (b.context_length ?? 0) - (a.context_length ?? 0))
      break
    case 'price_in_asc':
      sorted.sort((a, b) => priceKey(a.price_prompt) - priceKey(b.price_prompt))
      break
    case 'price_in_desc':
      sorted.sort((a, b) => priceKey(b.price_prompt) - priceKey(a.price_prompt))
      break
    case 'price_out_asc':
      sorted.sort((a, b) => priceKey(a.price_completion) - priceKey(b.price_completion))
      break
    case 'price_out_desc':
      sorted.sort((a, b) => priceKey(b.price_completion) - priceKey(a.price_completion))
      break
    default:
      sorted.sort((a, b) => a.name.localeCompare(b.name))
  }
  return sorted
}

export function collectProviders(models: ModelInfo[]): { id: string; count: number }[] {
  const counts = new Map<string, number>()
  for (const m of models) counts.set(m.provider, (counts.get(m.provider) ?? 0) + 1)
  return [...counts.entries()]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
}

export function collectInputModalities(models: ModelInfo[]): string[] {
  const set = new Set<string>()
  for (const m of models) for (const mod of m.input_modalities) set.add(mod)
  return [...set].sort()
}
