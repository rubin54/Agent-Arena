export type RenderMode = 'auto' | 'text' | 'markdown' | 'html' | 'json' | 'code'
export type TaskKind = 'one_shot' | 'agent'
export type RunStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'

export interface ModelInfo {
  id: string
  name: string
  description: string
  provider: string
  canonical_slug: string | null
  created_ts: number | null
  context_length: number | null
  max_completion_tokens: number | null
  is_moderated: boolean | null
  price_prompt: number | null
  price_completion: number | null
  price_request: number | null
  price_image: number | null
  price_web_search: number | null
  price_internal_reasoning: number | null
  price_cache_read: number | null
  price_cache_write: number | null
  modality: string | null
  input_modalities: string[]
  output_modalities: string[]
  tokenizer: string | null
  instruct_type: string | null
  supported_parameters: string[]
  fetched_at: string
}

export interface Catalog {
  models: ModelInfo[]
  fetched_at: string | null
  stale: boolean
  count: number
}

export interface TaskVariable {
  name: string
  description: string
  default: string
}

export interface Task {
  id: string
  name: string
  description: string
  kind: TaskKind
  system_prompt: string
  prompt_template: string
  variables: TaskVariable[]
  render_mode: RenderMode
  code_language: string | null
  json_schema: Record<string, unknown> | null
  params: Record<string, unknown>
  agent_config: Record<string, unknown>
  default_model_ids: string[]
  created_at: string
  updated_at: string
}

export type TaskInput = Omit<Task, 'id' | 'created_at' | 'updated_at'>

export interface RunItem {
  id: string
  position: number
  model_id: string
  model_name: string
  status: RunStatus
  output_text: string | null
  reasoning_text: string | null
  finish_reason: string | null
  error: string | null
  prompt_tokens: number | null
  completion_tokens: number | null
  reasoning_tokens: number | null
  total_tokens: number | null
  cost_usd: number | null
  latency_ms: number | null
  started_at: string | null
  finished_at: string | null
}

export interface RunSummary {
  id: string
  task_id: string | null
  label: string
  status: RunStatus
  error: string | null
  created_at: string
  started_at: string | null
  finished_at: string | null
  task_name: string
  item_count: number
  completed_count: number
  failed_count: number
  total_cost_usd: number
}

export interface RunDetail extends RunSummary {
  task_snapshot: Record<string, unknown>
  variable_values: Record<string, string>
  items: RunItem[]
}

export interface AppSettings {
  api_key_source: 'override' | 'env' | 'none'
  api_key_masked: string | null
  has_override: boolean
  base_url: string
  site_url: string | null
  app_name: string
  run_concurrency: number
  request_timeout_s: number
  catalog_ttl_minutes: number
}

export interface ConnectionCheck {
  ok: boolean
  message: string
  detail: Record<string, unknown> | null
}

export interface PromptPreview {
  detected_variables: string[]
  system_prompt: string
  user_prompt: string
}
