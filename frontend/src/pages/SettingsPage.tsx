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
    override: 'App-Override (in der Datenbank)',
    env: 'backend/.env',
    none: 'nicht gesetzt',
  }[settings.api_key_source]

  return (
    <div className="max-w-3xl space-y-6">
      <header>
        <h1 className="text-lg font-semibold">Einstellungen</h1>
        <p className="mt-0.5 text-xs text-ink-500">
          Alle OpenRouter-Aufrufe laufen über das Backend – der Key verlässt den Server nicht.
        </p>
      </header>

      <section className="card space-y-4 p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">OpenRouter-API-Key</h2>
          <Badge tone={settings.api_key_source === 'none' ? 'red' : 'green'}>{sourceLabel}</Badge>
        </div>

        {settings.api_key_masked && (
          <p className="font-mono text-xs text-ink-400">Aktiv: {settings.api_key_masked}</p>
        )}

        <div>
          <label className="label">Key überschreiben</label>
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
              Speichern
            </Button>
            {settings.has_override && (
              <Button
                variant="danger"
                onClick={() => update.mutate({ openrouter_api_key: '' })}
                loading={update.isPending}
                title="Override löschen, .env greift wieder"
              >
                Override entfernen
              </Button>
            )}
          </div>
          <p className="mt-1.5 text-xs text-ink-500">
            Der Override wird im Klartext in der lokalen Postgres-Datenbank gespeichert. Für den
            Dauerbetrieb ist <code className="text-ink-300">backend/.env</code> die sauberere
            Variante.
          </p>
        </div>

        {update.error && <ErrorBox>{(update.error as Error).message}</ErrorBox>}

        <div className="flex flex-wrap items-center gap-3 border-t border-ink-700 pt-4">
          <Button onClick={() => check.mutate()} loading={check.isPending}>
            <Plug className="h-3.5 w-3.5" />
            Verbindung testen
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
            Der Test schickt einen 1-Token-Request an <code>openai/gpt-4o-mini</code>. Schlägt er
            fehl, stimmt entweder der Key nicht oder das Konto hat kein Guthaben.
          </p>
        )}
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="text-sm font-semibold">Backend-Konfiguration</h2>
        <p className="text-xs text-ink-500">
          Diese Werte kommen aus <code className="text-ink-300">backend/.env</code> und werden beim
          Start gelesen.
        </p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <Stat label="Base URL" value={<span className="text-xs">{settings.base_url}</span>} />
          <Stat label="App-Name" value={<span className="text-xs">{settings.app_name}</span>} />
          <Stat
            label="Site URL"
            value={<span className="text-xs">{settings.site_url ?? '—'}</span>}
          />
          <Stat label="Parallelität" value={settings.run_concurrency} />
          <Stat label="Timeout" value={`${settings.request_timeout_s} s`} />
          <Stat label="Katalog-TTL" value={`${settings.catalog_ttl_minutes} min`} />
        </div>
      </section>
    </div>
  )
}
