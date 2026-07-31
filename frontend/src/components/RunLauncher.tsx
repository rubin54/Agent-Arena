import { AlertTriangle, Play, Search, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useCreateRun, useModels } from '../api/queries'
import type { Task } from '../api/types'
import { pricePerMillion } from '../lib/format'
import { extractVariables, syncVariables } from '../lib/template'
import { useSelection } from '../state/selection'
import { Badge, Button, ErrorBox, Modal, cx } from './ui'

export function RunLauncher({
  task,
  open,
  onClose,
}: {
  task: Task | null
  open: boolean
  onClose: () => void
}) {
  const navigate = useNavigate()
  const selection = useSelection()
  const { data: catalog } = useModels()
  const createRun = useCreateRun()

  const [modelIds, setModelIds] = useState<string[]>([])
  const [values, setValues] = useState<Record<string, string>>({})
  const [needle, setNeedle] = useState('')

  const variables = useMemo(() => {
    if (!task) return []
    const detected = extractVariables(task.system_prompt, task.prompt_template)
    return syncVariables(detected, task.variables)
  }, [task])

  // On open: take the current catalog selection, otherwise the models last used
  // for this task.
  useEffect(() => {
    if (!open || !task) return
    setModelIds(selection.selected.length ? selection.selected : task.default_model_ids)
    setValues(Object.fromEntries(variables.map((v) => [v.name, v.default ?? ''])))
    setNeedle('')
    createRun.reset()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task?.id])

  const models = catalog?.models ?? []
  const byId = useMemo(() => new Map(models.map((m) => [m.id, m])), [models])
  const isAgent = task?.kind === 'agent'

  const matches = useMemo(() => {
    const q = needle.trim().toLowerCase()
    if (!q) return []
    return models
      .filter((m) => `${m.name} ${m.id}`.toLowerCase().includes(q))
      // For agent tasks only offer models capable of tool calling.
      .filter((m) => !isAgent || m.supported_parameters.includes('tools'))
      .slice(0, 30)
  }, [models, needle, isAgent])

  // Already-selected models that are unusable for an agent run.
  const unsupported = useMemo(
    () =>
      isAgent
        ? modelIds.filter((id) => {
            const model = byId.get(id)
            return model !== undefined && !model.supported_parameters.includes('tools')
          })
        : [],
    [isAgent, modelIds, byId],
  )

  if (!task) return null

  const toggle = (id: string) =>
    setModelIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const start = async () => {
    const run = await createRun.mutateAsync({
      task_id: task.id,
      model_ids: modelIds,
      variable_values: values,
    })
    onClose()
    navigate(`/runs/${run.id}`)
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={`Start run – ${task.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={start}
            disabled={modelIds.length === 0}
            loading={createRun.isPending}
          >
            <Play className="h-3.5 w-3.5" />
            {modelIds.length ? `Run against ${modelIds.length} models` : 'Select models'}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        {createRun.error && <ErrorBox>{(createRun.error as Error).message}</ErrorBox>}

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="label mb-0">Models</span>
            <div className="flex items-center gap-2">
              {selection.selected.length > 0 && (
                <button
                  onClick={() => setModelIds(selection.selected)}
                  className="text-xs text-accent-400 hover:underline"
                >
                  Use catalog selection ({selection.selected.length})
                </button>
              )}
              {modelIds.length > 0 && (
                <button
                  onClick={() => setModelIds([])}
                  className="text-xs text-ink-500 hover:text-ink-300"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {modelIds.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {modelIds.map((id) => {
                const model = byId.get(id)
                return (
                  <button
                    key={id}
                    onClick={() => toggle(id)}
                    title={
                      model
                        ? `in ${pricePerMillion(model.price_prompt)} / out ${pricePerMillion(model.price_completion)} per 1M`
                        : 'Not in catalog'
                    }
                    className="inline-flex items-center gap-1.5 rounded-md border border-ink-600 bg-ink-800 px-2 py-1 text-xs text-ink-200 transition hover:border-red-800 hover:text-red-300"
                  >
                    <span className="font-mono">{id}</span>
                    <X className="h-3 w-3" />
                  </button>
                )
              })}
            </div>
          ) : (
            <p className="text-xs text-ink-500">
              No models selected yet. Search below or pick them in the model catalog.
            </p>
          )}

          {unsupported.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-800/50 bg-amber-950/20 px-3 py-2 text-xs text-amber-300">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p>
                  {unsupported.length} selected model{unsupported.length === 1 ? '' : 's'}{' '}
                  cannot do tool calling and would fail immediately.
                </p>
                <button
                  onClick={() => setModelIds((prev) => prev.filter((id) => !unsupported.includes(id)))}
                  className="mt-1 underline underline-offset-2 hover:text-amber-200"
                >
                  Remove
                </button>
              </div>
            </div>
          )}

          <div className="relative">
            <Search className="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-ink-500" />
            <input
              value={needle}
              onChange={(e) => setNeedle(e.target.value)}
              placeholder={
                isAgent ? 'Search a model with tool calling…' : 'Search and add a model…'
              }
              className="field pl-9"
            />
          </div>

          {matches.length > 0 && (
            <div className="max-h-56 overflow-y-auto rounded-lg border border-ink-700">
              {matches.map((m) => {
                const active = modelIds.includes(m.id)
                return (
                  <button
                    key={m.id}
                    onClick={() => toggle(m.id)}
                    className={cx(
                      'flex w-full items-center justify-between gap-3 border-b border-ink-800 px-3 py-2 text-left text-xs last:border-0 transition',
                      active ? 'bg-accent-600/10 text-accent-300' : 'hover:bg-ink-800',
                    )}
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{m.name}</div>
                      <div className="truncate font-mono text-[11px] text-ink-500">{m.id}</div>
                    </div>
                    <span className="shrink-0 font-mono text-[11px] text-ink-400">
                      {pricePerMillion(m.price_prompt)} / {pricePerMillion(m.price_completion)}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
        </section>

        {variables.length > 0 && (
          <section className="space-y-2">
            <span className="label mb-0">Variables</span>
            {variables.map((v) => (
              <div key={v.name}>
                <label className="mb-1 flex items-baseline gap-2 text-xs">
                  <span className="font-mono text-accent-400">{`{{${v.name}}}`}</span>
                  {v.description && <span className="text-ink-500">{v.description}</span>}
                </label>
                <textarea
                  value={values[v.name] ?? ''}
                  onChange={(e) => setValues((prev) => ({ ...prev, [v.name]: e.target.value }))}
                  rows={2}
                  className="field resize-y font-mono text-xs"
                />
              </div>
            ))}
          </section>
        )}

        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-ink-700 bg-ink-900 px-3 py-2.5 text-xs text-ink-400">
          <Badge tone={isAgent ? 'accent' : 'neutral'}>
            {isAgent ? 'Agent' : task.render_mode}
          </Badge>
          <span>
            {modelIds.length} model{modelIds.length === 1 ? '' : 's'} ·{' '}
            {isAgent
              ? `one container each, max. ${task.agent_config.max_steps ?? 12} steps, network ${
                  task.agent_config.network ? 'on' : 'off'
                }.`
              : 'Requests run in parallel; results fill in live.'}
          </span>
        </div>
      </div>
    </Modal>
  )
}
