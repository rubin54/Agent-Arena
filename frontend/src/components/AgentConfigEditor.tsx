import { AlertTriangle, CheckCircle2, Hammer, Plus, Trash2, Wifi, WifiOff } from 'lucide-react'
import { useBuildSandbox, useAgentTools, useSandboxStatus } from '../api/queries'
import type { AgentConfig, SetupFile } from '../api/types'
import { Badge, Button, cx } from './ui'

const DEFAULTS: Required<Pick<AgentConfig, 'max_steps' | 'command_timeout_s' | 'memory_mb' | 'cpus'>> =
  {
    max_steps: 12,
    command_timeout_s: 60,
    memory_mb: 1024,
    cpus: 2,
  }

export function AgentConfigEditor({
  config,
  onChange,
}: {
  config: AgentConfig
  onChange: (config: AgentConfig) => void
}) {
  const { data: tools } = useAgentTools()
  const { data: sandbox } = useSandboxStatus()
  const build = useBuildSandbox()

  const patch = (part: Partial<AgentConfig>) => onChange({ ...config, ...part })
  const selectedTools = config.tools ?? (tools ?? []).map((t) => t.name)
  const setupFiles = config.setup_files ?? []

  const toggleTool = (name: string) => {
    const next = selectedTools.includes(name)
      ? selectedTools.filter((t) => t !== name)
      : [...selectedTools, name]
    // At least one tool must remain, otherwise the agent cannot act at all.
    patch({ tools: next.length ? next : selectedTools })
  }

  const setFile = (index: number, part: Partial<SetupFile>) =>
    patch({ setup_files: setupFiles.map((f, i) => (i === index ? { ...f, ...part } : f)) })

  return (
    <div className="space-y-4 rounded-lg border border-ink-700 bg-ink-900/50 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-medium text-ink-100">Sandbox &amp; tools</h4>
          <p className="mt-0.5 text-xs text-ink-500">
            The agent works in a disposable container at <code>/workspace</code> -- with no
            access to your filesystem.
          </p>
        </div>
        {sandbox && (
          <div className="shrink-0">
            {!sandbox.docker_available ? (
              <Badge tone="red">
                <AlertTriangle className="h-3 w-3" />
                Docker offline
              </Badge>
            ) : sandbox.image_ready ? (
              <Badge tone="green">
                <CheckCircle2 className="h-3 w-3" />
                Sandbox ready
              </Badge>
            ) : (
              <Button size="sm" onClick={() => build.mutate()} loading={build.isPending}>
                <Hammer className="h-3.5 w-3.5" />
                Build image
              </Button>
            )}
          </div>
        )}
      </div>

      {sandbox && !sandbox.docker_available && (
        <p className="rounded-md border border-red-900/50 bg-red-950/25 px-3 py-2 text-xs text-red-300">
          {sandbox.message} Agent runs require a running Docker Desktop.
        </p>
      )}

      <div>
        <label className="label">Tools</label>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {(tools ?? []).map((tool) => {
            const active = selectedTools.includes(tool.name)
            return (
              <button
                key={tool.name}
                onClick={() => toggleTool(tool.name)}
                title={tool.description}
                className={cx(
                  'rounded-lg border px-3 py-2 text-left transition',
                  active
                    ? 'border-accent-500 bg-accent-600/10'
                    : 'border-ink-700 bg-ink-900 hover:border-ink-600',
                )}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cx(
                      'h-2 w-2 shrink-0 rounded-full',
                      active ? 'bg-accent-500' : 'bg-ink-600',
                    )}
                  />
                  <span className="text-xs font-medium">{tool.label}</span>
                  <span className="font-mono text-[10px] text-ink-500">{tool.name}</span>
                </div>
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <NumberField
          label="Max steps"
          value={config.max_steps ?? DEFAULTS.max_steps}
          min={1}
          max={60}
          onChange={(max_steps) => patch({ max_steps })}
        />
        <NumberField
          label="Timeout per command (s)"
          value={config.command_timeout_s ?? DEFAULTS.command_timeout_s}
          min={5}
          max={600}
          onChange={(command_timeout_s) => patch({ command_timeout_s })}
        />
        <NumberField
          label="RAM (MB)"
          value={config.memory_mb ?? DEFAULTS.memory_mb}
          min={256}
          max={8192}
          step={256}
          onChange={(memory_mb) => patch({ memory_mb })}
        />
        <NumberField
          label="CPUs"
          value={config.cpus ?? DEFAULTS.cpus}
          min={0.5}
          max={8}
          step={0.5}
          onChange={(cpus) => patch({ cpus })}
        />
      </div>

      <div>
        <label className="label">Network</label>
        <button
          onClick={() => patch({ network: !config.network })}
          className={cx(
            'flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition',
            config.network
              ? 'border-amber-700/60 bg-amber-950/20'
              : 'border-ink-700 bg-ink-900 hover:border-ink-600',
          )}
        >
          {config.network ? (
            <Wifi className="h-4 w-4 shrink-0 text-amber-400" />
          ) : (
            <WifiOff className="h-4 w-4 shrink-0 text-ink-500" />
          )}
          <div className="min-w-0 flex-1">
            <div className="text-xs font-medium">
              {config.network ? 'Network enabled' : 'Network disabled'}
            </div>
            <div className="mt-0.5 text-[11px] text-ink-500">
              {config.network
                ? 'The agent can use curl, pip and npm -- and reach out from the sandbox.'
                : 'Container without network. Python, Node, git, jq and ripgrep are preinstalled.'}
            </div>
          </div>
        </button>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between">
          <label className="label mb-0">Starter files in the workspace (optional)</label>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => patch({ setup_files: [...setupFiles, { path: '', content: '' }] })}
          >
            <Plus className="h-3.5 w-3.5" />
            File
          </Button>
        </div>
        {setupFiles.length === 0 ? (
          <p className="text-xs text-ink-500">
            Without starter files the agent begins in an empty directory.
          </p>
        ) : (
          <div className="space-y-2">
            {setupFiles.map((file, index) => (
              <div key={index} className="rounded-lg border border-ink-700 bg-ink-900 p-2">
                <div className="mb-1.5 flex gap-2">
                  <input
                    value={file.path}
                    onChange={(e) => setFile(index, { path: e.target.value })}
                    placeholder="path/to/file.py"
                    className="field h-8 flex-1 font-mono text-xs"
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      patch({ setup_files: setupFiles.filter((_, i) => i !== index) })
                    }
                    title="Remove"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
                <textarea
                  value={file.content}
                  onChange={(e) => setFile(index, { content: e.target.value })}
                  rows={4}
                  placeholder="File contents"
                  className="field resize-y font-mono text-xs"
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (value: number) => void
}) {
  return (
    <div>
      <label className="label">{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => {
          const next = Number(e.target.value)
          if (!Number.isNaN(next)) onChange(next)
        }}
        className="field"
      />
    </div>
  )
}
