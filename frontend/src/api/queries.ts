import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type {
  AppSettings,
  Catalog,
  ConnectionCheck,
  PromptPreview,
  RunDetail,
  RunSummary,
  Task,
  TaskInput,
} from './types'

export const keys = {
  models: ['models'] as const,
  tasks: ['tasks'] as const,
  task: (id: string) => ['tasks', id] as const,
  runs: ['runs'] as const,
  run: (id: string) => ['runs', id] as const,
  settings: ['settings'] as const,
}

// --------------------------------------------------------------------- Modelle

export function useModels() {
  return useQuery({
    queryKey: keys.models,
    queryFn: () => api.get<Catalog>('/api/models'),
    staleTime: 5 * 60_000,
  })
}

export function useRefreshModels() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post<Catalog>('/api/models/refresh'),
    onSuccess: (data) => qc.setQueryData(keys.models, data),
  })
}

// --------------------------------------------------------------------- Tasks

export function useTasks() {
  return useQuery({ queryKey: keys.tasks, queryFn: () => api.get<Task[]>('/api/tasks') })
}

export function useTask(id: string | undefined) {
  return useQuery({
    queryKey: keys.task(id ?? ''),
    queryFn: () => api.get<Task>(`/api/tasks/${id}`),
    enabled: Boolean(id),
  })
}

export function useCreateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: TaskInput) => api.post<Task>('/api/tasks', input),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.tasks }),
  })
}

export function useUpdateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<TaskInput> }) =>
      api.patch<Task>(`/api/tasks/${id}`, input),
    onSuccess: (task) => {
      qc.invalidateQueries({ queryKey: keys.tasks })
      qc.setQueryData(keys.task(task.id), task)
    },
  })
}

export function useDeleteTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/api/tasks/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.tasks })
      qc.invalidateQueries({ queryKey: keys.runs })
    },
  })
}

export function useDuplicateTask() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.post<Task>(`/api/tasks/${id}/duplicate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.tasks }),
  })
}

export function usePromptPreview() {
  return useMutation({
    mutationFn: (input: {
      system_prompt: string
      prompt_template: string
      variable_values: Record<string, string>
    }) => api.post<PromptPreview>('/api/tasks/preview', input),
  })
}

// --------------------------------------------------------------------- Runs

export function useRuns(taskId?: string) {
  const query = taskId ? `?task_id=${taskId}` : ''
  return useQuery({
    queryKey: [...keys.runs, taskId ?? 'all'],
    queryFn: () => api.get<RunSummary[]>(`/api/runs${query}`),
    // Laufende Runs sollen in der Liste sichtbar weiterlaufen.
    refetchInterval: (q) =>
      (q.state.data ?? []).some((r) => r.status === 'running' || r.status === 'pending')
        ? 2000
        : false,
  })
}

export function useRun(id: string | undefined) {
  return useQuery({
    queryKey: keys.run(id ?? ''),
    queryFn: () => api.get<RunDetail>(`/api/runs/${id}`),
    enabled: Boolean(id),
    // Solange der Run läuft, pollen wir -- so füllen sich die Karten nach und nach.
    refetchInterval: (q) => {
      const status = q.state.data?.status
      return status === 'running' || status === 'pending' ? 1200 : false
    },
  })
}

export function useCreateRun() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: {
      task_id: string
      model_ids: string[]
      variable_values: Record<string, string>
      label?: string
    }) => api.post<RunDetail>('/api/runs', input),
    onSuccess: (run) => {
      qc.setQueryData(keys.run(run.id), run)
      qc.invalidateQueries({ queryKey: keys.runs })
      qc.invalidateQueries({ queryKey: keys.tasks })
    },
  })
}

export function useCancelRun() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.post<RunDetail>(`/api/runs/${id}/cancel`),
    onSuccess: (run) => {
      qc.setQueryData(keys.run(run.id), run)
      qc.invalidateQueries({ queryKey: keys.runs })
    },
  })
}

export function useRerun() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.post<RunDetail>(`/api/runs/${id}/rerun`),
    onSuccess: (run) => {
      qc.setQueryData(keys.run(run.id), run)
      qc.invalidateQueries({ queryKey: keys.runs })
    },
  })
}

export function useDeleteRun() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.del<void>(`/api/runs/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.runs }),
  })
}

// --------------------------------------------------------------------- Settings

export function useSettings() {
  return useQuery({ queryKey: keys.settings, queryFn: () => api.get<AppSettings>('/api/settings') })
}

export function useUpdateSettings() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: { openrouter_api_key?: string }) =>
      api.put<AppSettings>('/api/settings', input),
    onSuccess: (data) => qc.setQueryData(keys.settings, data),
  })
}

export function useCheckConnection() {
  return useMutation({ mutationFn: () => api.post<ConnectionCheck>('/api/settings/check') })
}
