import { History, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useDeleteRun, useRuns } from '../api/queries'
import { Button, EmptyState, ErrorBox, Spinner, StatusBadge } from '../components/ui'
import { formatCost, formatDateTime, formatDuration } from '../lib/format'

export function RunsPage() {
  const { data: runs, isLoading, error } = useRuns()
  const deleteRun = useDeleteRun()

  return (
    <div className="space-y-5">
      <header>
        <h1 className="text-lg font-semibold">Run-Historie</h1>
        <p className="mt-0.5 text-xs text-ink-500">
          Jede Ausführung wird mit Prompt-Snapshot, Kosten und Ergebnissen archiviert.
        </p>
      </header>

      {error && <ErrorBox>{(error as Error).message}</ErrorBox>}

      {isLoading ? (
        <div className="flex justify-center py-24">
          <Spinner className="h-6 w-6" />
        </div>
      ) : !runs?.length ? (
        <EmptyState
          icon={<History className="h-8 w-8" />}
          title="Noch keine Runs"
          hint="Starte eine Aufgabe gegen ein paar Modelle – die Ergebnisse landen hier."
          action={
            <Link to="/tasks">
              <Button variant="primary">Zu den Aufgaben</Button>
            </Link>
          }
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-700 text-left text-[11px] tracking-wider text-ink-500 uppercase">
                <th className="px-4 py-2.5 font-medium">Aufgabe</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Modelle</th>
                <th className="px-4 py-2.5 font-medium">Kosten</th>
                <th className="px-4 py-2.5 font-medium">Dauer</th>
                <th className="px-4 py-2.5 font-medium">Gestartet</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr
                  key={run.id}
                  className="border-b border-ink-800 transition last:border-0 hover:bg-ink-800/50"
                >
                  <td className="px-4 py-2.5">
                    <Link
                      to={`/runs/${run.id}`}
                      className="font-medium text-ink-100 hover:text-accent-400"
                    >
                      {run.label || run.task_name}
                    </Link>
                  </td>
                  <td className="px-4 py-2.5">
                    <StatusBadge status={run.status} />
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-ink-300">
                    {run.completed_count}/{run.item_count}
                    {run.failed_count > 0 && (
                      <span className="ml-1.5 text-red-400">({run.failed_count} ✗)</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-ink-300">
                    {formatCost(run.total_cost_usd)}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-ink-300">
                    {run.started_at && run.finished_at
                      ? formatDuration(
                          new Date(run.finished_at).getTime() - new Date(run.started_at).getTime(),
                        )
                      : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-xs whitespace-nowrap text-ink-400">
                    {formatDateTime(run.created_at)}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      title="Run löschen"
                      onClick={() => {
                        if (confirm('Diesen Run löschen?')) deleteRun.mutate(run.id)
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
