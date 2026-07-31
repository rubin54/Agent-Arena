import { CheckCircle2, Plug, XCircle } from 'lucide-react'
import { useState } from 'react'
import { useCheckConnection, useSettings, useUpdateSettings } from '../api/queries'
import { Badge, Button, ErrorBox, Spinner, Stat } from '../components/ui'

export function SettingsPage() {
  const { data: settings, isLoading } = useSettings()
  const update = useUpdateSettings()
  const check = useCheckConnection()
  const [keyInput, setKeyInput] = useState('')

  if (isLoading || !settings) {
    return (
      <div className="flex justify-center py-24">
        <Spinner className="h-6 w-6" />
      </div>
    )
  }

  const sourceLabel = {
    override: 'App override (stored in the database)',
    env: 'backend/.env',
    none: 'not configured',
  }[settings.api_key_source]

  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <h1 className="text-lg font-semibold">Settings</h1>
        <p className="mt-0.5 text-xs text-ink-500">
          Every OpenRouter call goes through the backend -- the key never leaves the server.
        </p>
      </header>

      <section className="card space-y-4 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">OpenRouter API key</h2>
          <Badge tone={settings.api_key_source === 'none' ? 'red' : 'green'}>{sourceLabel}</Badge>
        </div>

        {settings.api_key_masked && (
          <p className="font-mono text-xs text-ink-400">Active: {settings.api_key_masked}</p>
        )}

        <div>
          <label className="label">Override the key</label>
          <div className="flex flex-wrap gap-2">
            <input
              type="password"
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              placeholder="sk-or-v1-…"
              className="field flex-1"
              autoComplete="off"
            />
            <Button
              variant="primary"
              disabled={!keyInput.trim()}
              loading={update.isPending}
              onClick={async () => {
                await update.mutateAsync({ openrouter_api_key: keyInput })
                setKeyInput('')
              }}
            >
              Save
            </Button>
            {settings.has_override && (
              <Button
                variant="danger"
                onClick={() => update.mutate({ openrouter_api_key: '' })}
                loading={update.isPending}
                title="Delete the override so .env applies again"
              >
                Remove override
              </Button>
            )}
          </div>
          <p className="mt-1.5 text-xs text-ink-500">
            The override is stored in plain text in the local Postgres database. For everyday
            use <code className="text-ink-300">backend/.env</code> is the cleaner option.
          </p>
        </div>

        {update.error && <ErrorBox>{(update.error as Error).message}</ErrorBox>}

        <div className="flex flex-wrap items-center gap-3 border-t border-ink-700 pt-4">
          <Button onClick={() => check.mutate()} loading={check.isPending}>
            <Plug className="h-3.5 w-3.5" />
            Test connection
          </Button>
          {check.data && (
            <span
              className={`inline-flex items-center gap-1.5 text-xs ${
                check.data.ok ? 'text-emerald-400' : 'text-red-400'
              }`}
            >
              {check.data.ok ? (
                <CheckCircle2 className="h-4 w-4" />
              ) : (
                <XCircle className="h-4 w-4" />
              )}
              {check.data.message}
            </span>
          )}
        </div>
        {check.data && !check.data.ok && (
          <p className="text-xs text-ink-500">
            The test sends a one-token request to <code>openai/gpt-4o-mini</code>. If it fails,
            either the key is wrong or the account has no credit.
          </p>
        )}
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="text-sm font-semibold">Backend configuration</h2>
        <p className="text-xs text-ink-500">
          These values come from <code className="text-ink-300">backend/.env</code> and are read
          at startup.
        </p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Stat label="Base URL" value={<span className="text-xs">{settings.base_url}</span>} />
          <Stat label="App name" value={<span className="text-xs">{settings.app_name}</span>} />
          <Stat
            label="Site URL"
            value={<span className="text-xs">{settings.site_url ?? '—'}</span>}
          />
          <Stat label="Concurrency" value={settings.run_concurrency} />
          <Stat label="Timeout" value={`${settings.request_timeout_s} s`} />
          <Stat label="Catalog TTL" value={`${settings.catalog_ttl_minutes} min`} />
        </div>
      </section>
    </div>
  )
}
