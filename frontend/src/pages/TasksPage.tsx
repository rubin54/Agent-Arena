import { Copy, FileText, Play, Plus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
  useCreateTask,
  useDeleteTask,
  useDuplicateTask,
  useTasks,
  useUpdateTask,
} from '../api/queries'
import type { Task, TaskInput } from '../api/types'
import { EMPTY_TASK, TaskEditor } from '../components/TaskEditor'
import { RunLauncher } from '../components/RunLauncher'
import { Badge, Button, EmptyState, Spinner, cx } from '../components/ui'
import { formatRelative } from '../lib/format'
import { useSelection } from '../state/selection'

const NEW = '__new__'

export function TasksPage() {
  const { data: tasks, isLoading } = useTasks()
  const createTask = useCreateTask()
  const updateTask = useUpdateTask()
  const deleteTask = useDeleteTask()
  const duplicateTask = useDuplicateTask()
  const selection = useSelection()

  const [activeId, setActiveId] = useState<string | null>(null)
  const [launching, setLaunching] = useState<Task | null>(null)

  // Open the first task automatically so the right pane is not empty.
  useEffect(() => {
    if (activeId === null && tasks && tasks.length > 0) setActiveId(tasks[0].id)
  }, [tasks, activeId])

  const active = useMemo(
    () => (activeId && activeId !== NEW ? (tasks ?? []).find((t) => t.id === activeId) : undefined),
    [tasks, activeId],
  )

  const editing = activeId === NEW ? EMPTY_TASK : active

  const handleSave = async (input: TaskInput) => {
    if (activeId === NEW || !active) {
      const created = await createTask.mutateAsync(input)
      setActiveId(created.id)
    } else {
      await updateTask.mutateAsync({ id: active.id, input })
    }
  }

  const handleDelete = async () => {
    if (!active) return
    if (!confirm(`Delete task "${active.name}" and all of its runs?`)) return
    await deleteTask.mutateAsync(active.id)
    setActiveId(null)
  }

  const saveError =
    (createTask.error as Error | null)?.message ?? (updateTask.error as Error | null)?.message

  return (
    <div className="grid gap-5 lg:grid-cols-[19rem_1fr]">
      <aside className="space-y-3">
        <div className="flex items-center justify-between">
          <h1 className="text-lg font-semibold">Tasks</h1>
          <Button
            size="sm"
            variant="primary"
            onClick={() => setActiveId(NEW)}
            title="Create a new task"
          >
            <Plus className="h-3.5 w-3.5" />
            New
          </Button>
        </div>

        {selection.selected.length > 0 && (
          <div className="rounded-lg border border-accent-600/40 bg-accent-600/10 px-3 py-2 text-xs text-accent-300">
            {selection.selected.length} models selected in the catalog -- they pre-fill the
            launcher.
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : (
          <div className="space-y-1.5">
            {activeId === NEW && (
              <div className="card border-accent-500 bg-accent-600/10 px-3 py-2.5 text-sm">
                New task …
              </div>
            )}
            {(tasks ?? []).map((task) => (
              <button
                key={task.id}
                onClick={() => setActiveId(task.id)}
                className={cx(
                  'card w-full px-3 py-2.5 text-left transition',
                  task.id === activeId
                    ? 'border-accent-500 bg-accent-600/10'
                    : 'hover:border-ink-600 hover:bg-ink-800/60',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="truncate text-sm font-medium">{task.name}</span>
                  {task.kind === 'agent' && <Badge tone="amber">Agent</Badge>}
                </div>
                {task.description && (
                  <p className="mt-0.5 truncate text-xs text-ink-500">{task.description}</p>
                )}
                <p className="mt-1 text-[11px] text-ink-600">
                  {formatRelative(task.updated_at)} · {task.render_mode}
                </p>
              </button>
            ))}
            {!tasks?.length && activeId !== NEW && (
              <p className="px-1 py-4 text-xs text-ink-500">No tasks created yet.</p>
            )}
          </div>
        )}
      </aside>

      <section className="min-w-0">
        {!editing ? (
          <EmptyState
            icon={<FileText className="h-8 w-8" />}
            title="No task selected"
            hint="Create a task -- a one-shot prompt with placeholders that you can run against as many models as you like."
            action={
              <Button variant="primary" onClick={() => setActiveId(NEW)}>
                <Plus className="h-3.5 w-3.5" />
                Create task
              </Button>
            }
          />
        ) : (
          <div className="card p-5">
            {active && (
              <div className="mb-5 flex flex-wrap items-center justify-end gap-2 border-b border-ink-700 pb-4">
                <Button
                  size="sm"
                  onClick={() => duplicateTask.mutate(active.id)}
                  loading={duplicateTask.isPending}
                >
                  <Copy className="h-3.5 w-3.5" />
                  Duplicate
                </Button>
                <Button size="sm" variant="primary" onClick={() => setLaunching(active)}>
                  <Play className="h-3.5 w-3.5" />
                  Run
                </Button>
              </div>
            )}
            <TaskEditor
              key={activeId ?? NEW}
              task={editing}
              onSave={handleSave}
              onDelete={active ? handleDelete : undefined}
              saving={createTask.isPending || updateTask.isPending}
              error={saveError}
            />
          </div>
        )}
      </section>

      <RunLauncher task={launching} open={Boolean(launching)} onClose={() => setLaunching(null)} />
    </div>
  )
}
