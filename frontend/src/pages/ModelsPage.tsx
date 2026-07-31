import { Boxes, Play, RefreshCw, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useModels, useRefreshModels } from '../api/queries'
import type { ModelInfo } from '../api/types'
import { MultiSelect, Select, Toggle } from '../components/FilterControls'
import { ModelCard } from '../components/ModelCard'
import { ModelDetail } from '../components/ModelDetail'
import { Badge, Button, EmptyState, ErrorBox, Spinner } from '../components/ui'
import { formatRelative, providerLabel } from '../lib/format'
import {
  applyFilters,
  CAPABILITIES,
  collectInputModalities,
  collectProviders,
  CONTEXT_STEPS,
  DEFAULT_FILTERS,
  PRICE_STEPS,
  SORT_OPTIONS,
  type ModelFilters,
} from '../lib/modelFilter'
import { useSelection } from '../state/selection'

export function ModelsPage() {
  const navigate = useNavigate()
  const { data, isLoading, error } = useModels()
  const refresh = useRefreshModels()
  const selection = useSelection()

  const [filters, setFilters] = useState<ModelFilters>(DEFAULT_FILTERS)
  const [detail, setDetail] = useState<ModelInfo | null>(null)

  const models = data?.models ?? []
  const providers = useMemo(() => collectProviders(models), [models])
  const modalities = useMemo(() => collectInputModalities(models), [models])
  const visible = useMemo(() => applyFilters(models, filters), [models, filters])

  const patch = (part: Partial<ModelFilters>) => setFilters((f) => ({ ...f, ...part }))
  const filtersActive =
    JSON.stringify({ ...filters, sort: null }) !== JSON.stringify({ ...DEFAULT_FILTERS, sort: null })

  return (
    <div className="space-y-5 pb-24">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Modell-Katalog</h1>
          <p className="mt-0.5 text-xs text-ink-500">
            {data ? `${models.length} Modelle` : '—'}
            {data?.fetched_at && ` · aktualisiert ${formatRelative(data.fetched_at)}`}
            {data?.stale && ' · veraltet'}
          </p>
        </div>
        <Button
          onClick={() => refresh.mutate()}
          loading={refresh.isPending}
          title="Katalog neu von OpenRouter laden"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Katalog aktualisieren
        </Button>
      </header>

      {error && <ErrorBox>{(error as Error).message}</ErrorBox>}
      {refresh.error && <ErrorBox>{(refresh.error as Error).message}</ErrorBox>}

      <div className="card space-y-3 p-3">
        <div className="relative">
          <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-500" />
          <input
            value={filters.search}
            onChange={(e) => patch({ search: e.target.value })}
            placeholder="Nach Name, ID oder Beschreibung suchen…"
            className="field pl-9"
          />
          {filters.search && (
            <button
              onClick={() => patch({ search: '' })}
              className="absolute top-1/2 right-3 -translate-y-1/2 text-ink-500 hover:text-ink-100"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="min-w-40 flex-1">
            <MultiSelect
              label="Anbieter"
              searchable
              options={providers.map((p) => ({
                value: p.id,
                label: providerLabel(p.id),
                hint: String(p.count),
              }))}
              selected={filters.providers}
              onChange={(providersSel) => patch({ providers: providersSel })}
            />
          </div>
          <div className="min-w-40 flex-1">
            <MultiSelect
              label="Fähigkeiten"
              options={CAPABILITIES.map((c) => ({ value: c.key, label: c.label }))}
              selected={filters.capabilities}
              onChange={(capabilities) => patch({ capabilities })}
            />
          </div>
          <div className="min-w-40 flex-1">
            <MultiSelect
              label="Input-Modalitäten"
              options={modalities.map((m) => ({ value: m, label: m }))}
              selected={filters.inputModalities}
              onChange={(inputModalities) => patch({ inputModalities })}
            />
          </div>
          <Select
            className="min-w-36"
            value={filters.minContext}
            options={CONTEXT_STEPS.map((s) => ({ label: `Context: ${s.label}`, value: s.value }))}
            onChange={(minContext) => patch({ minContext })}
          />
          <Select
            className="min-w-40"
            value={filters.maxPromptPricePerM}
            options={PRICE_STEPS.map((s) => ({ label: `Input: ${s.label}`, value: s.value }))}
            onChange={(maxPromptPricePerM) => patch({ maxPromptPricePerM })}
          />
          <Toggle checked={filters.freeOnly} onChange={(freeOnly) => patch({ freeOnly })}>
            Nur kostenlose
          </Toggle>
          <Select
            className="min-w-44"
            value={filters.sort}
            options={SORT_OPTIONS.map((s) => ({ label: `Sortierung: ${s.label}`, value: s.value }))}
            onChange={(sort) => patch({ sort })}
          />
          {filtersActive && (
            <Button variant="ghost" size="sm" onClick={() => setFilters(DEFAULT_FILTERS)}>
              <X className="h-3.5 w-3.5" />
              Filter zurücksetzen
            </Button>
          )}
        </div>

        <div className="flex items-center justify-between text-xs text-ink-500">
          <span>
            {visible.length} von {models.length} Modellen
          </span>
          {visible.length > 0 && (
            <button
              onClick={() => selection.add(visible.map((m) => m.id))}
              className="text-accent-400 hover:underline"
            >
              Alle sichtbaren auswählen
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 py-24 text-sm text-ink-400">
          <Spinner /> Katalog wird geladen…
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<Boxes className="h-8 w-8" />}
          title="Keine Modelle gefunden"
          hint={
            models.length
              ? 'Die aktuellen Filter passen auf kein Modell.'
              : 'Der Katalog ist leer. Lade ihn über „Katalog aktualisieren“ neu.'
          }
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {visible.map((model) => (
            <ModelCard
              key={model.id}
              model={model}
              selected={selection.isSelected(model.id)}
              onToggle={() => selection.toggle(model.id)}
              onOpen={() => setDetail(model)}
            />
          ))}
        </div>
      )}

      <ModelDetail
        model={detail}
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        selected={detail ? selection.isSelected(detail.id) : false}
        onToggle={() => detail && selection.toggle(detail.id)}
      />

      {selection.selected.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-ink-700 bg-ink-900/95 backdrop-blur">
          <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-6 py-3">
            <Badge tone="accent">{selection.selected.length} ausgewählt</Badge>
            <div className="flex min-w-0 flex-1 flex-wrap gap-1 overflow-hidden">
              {selection.selected.slice(0, 6).map((id) => (
                <button
                  key={id}
                  onClick={() => selection.remove(id)}
                  className="inline-flex items-center gap-1 rounded-md border border-ink-600 bg-ink-800 px-1.5 py-0.5 font-mono text-[11px] text-ink-300 hover:border-red-800 hover:text-red-300"
                  title="Entfernen"
                >
                  {id}
                  <X className="h-3 w-3" />
                </button>
              ))}
              {selection.selected.length > 6 && (
                <span className="self-center text-[11px] text-ink-500">
                  +{selection.selected.length - 6} weitere
                </span>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={selection.clear}>
              Auswahl leeren
            </Button>
            <Button variant="primary" onClick={() => navigate('/tasks')}>
              <Play className="h-3.5 w-3.5" />
              Task ausführen
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
