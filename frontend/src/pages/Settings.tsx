import { useEffect, useState } from 'react';
import {
  Save,
  Trash2,
  Server,
  CheckCircle2,
  KeyRound,
  Eye,
  EyeOff,
  ShieldCheck,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { storage, defaultSettings } from '@/lib/storage';
import { api, type AiKeyTestResult } from '@/lib/api';
import { config } from '@/config/env';
import { PageHeader } from '@/components/ui';
import { AI_PROVIDERS, getProviderMeta } from '@/lib/aiProviders';
import type { AiProvider, UserSettings } from '@/types';

type HealthState = 'idle' | 'checking' | 'ok' | 'down';

export default function Settings() {
  const [settings, setSettings] = useState<UserSettings>(defaultSettings);
  const [saved, setSaved] = useState(false);
  const [health, setHealth] = useState<HealthState>('idle');
  const [confirmClear, setConfirmClear] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [keyTest, setKeyTest] = useState<AiKeyTestResult | null>(null);

  useEffect(() => {
    setSettings(storage.getSettings());
  }, []);

  const update = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => {
    setSettings((s) => ({ ...s, [key]: value }));
    setSaved(false);
  };

  const handleSave = () => {
    storage.saveSettings(settings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const provider: AiProvider = settings.aiProvider ?? 'openai';
  const providerMeta = getProviderMeta(provider);
  const keyValue = settings.aiApiKey ?? '';

  const testKey = async () => {
    setTesting(true);
    setKeyTest(null);
    try {
      const result = await api.testAiKey({
        provider,
        apiKey: keyValue.trim(),
        model: settings.aiModel?.trim() || undefined,
      });
      setKeyTest(result);
    } catch (err) {
      const detail =
        err instanceof Error ? err.message : 'Unknown error.';
      setKeyTest({
        ok: false,
        message: `Could not reach the test service: ${detail} (is the backend running at ${config.apiUrl}?)`,
      });
    } finally {
      setTesting(false);
    }
  };

  const checkHealth = async () => {
    setHealth('checking');
    try {
      await api.health();
      setHealth('ok');
    } catch {
      setHealth('down');
    }
  };

  const clearData = () => {
    if (!confirmClear) {
      setConfirmClear(true);
      setTimeout(() => setConfirmClear(false), 4000);
      return;
    }
    storage.clearMeetings();
    setConfirmClear(false);
  };

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Settings" subtitle="Manage your profile and app data." />

      <div className="space-y-6">
        <section className="card p-6">
          <h3 className="mb-4 text-sm font-semibold text-slate-300">Profile</h3>
          <div className="space-y-4">
            <div>
              <label className="label">Display Name</label>
              <input
                className="input"
                value={settings.displayName}
                onChange={(e) => update('displayName', e.target.value)}
                placeholder="Your name"
              />
              <p className="mt-1.5 text-xs text-slate-500">
                Used as your speaker label in live meetings.
              </p>
            </div>
            <div>
              <label className="label">Default Meeting Duration (minutes)</label>
              <input
                type="number"
                min={5}
                step={5}
                className="input"
                value={settings.defaultDuration}
                onChange={(e) => update('defaultDuration', Number(e.target.value))}
              />
            </div>
          </div>
        </section>

        <section className="card p-6">
          <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold text-slate-300">
            <KeyRound className="h-4 w-4 text-brand-300" /> AI Provider
          </h3>
          <p className="mb-4 flex items-center gap-1.5 text-xs text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
            Stored in this browser and sent to your own backend only at request
            time (used in-memory, never persisted) so it can call the provider.
          </p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label">Provider</label>
              <select
                className="input"
                value={provider}
                onChange={(e) => {
                  update('aiProvider', e.target.value as AiProvider);
                  setKeyTest(null);
                }}
              >
                {AI_PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Model</label>
              <input
                className="input"
                placeholder={providerMeta.defaultModel}
                value={settings.aiModel ?? ''}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => update('aiModel', e.target.value)}
              />
              <p className="mt-1.5 text-xs text-slate-500">
                Leave blank to use the default ({providerMeta.defaultModel}).
              </p>
            </div>
          </div>

          <label className="label mt-4">API key</label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={showKey ? 'text' : 'password'}
                className="input pr-10"
                placeholder={providerMeta.keyPlaceholder}
                value={keyValue}
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => {
                  update('aiApiKey', e.target.value);
                  setKeyTest(null);
                }}
              />
              <button
                type="button"
                onClick={() => setShowKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-200"
                title={showKey ? 'Hide key' : 'Show key'}
              >
                {showKey ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            <button
              className="btn-secondary"
              onClick={testKey}
              disabled={testing || !keyValue.trim()}
            >
              {testing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ShieldCheck className="h-4 w-4" />
              )}
              {testing ? 'Testing...' : 'Test connection'}
            </button>
          </div>

          <p className="mt-2 text-xs text-slate-500">
            {providerMeta.keyHint}{' '}
            <a
              href={providerMeta.consoleUrl}
              target="_blank"
              rel="noreferrer"
              className="text-brand-300 hover:underline"
            >
              Get a key
            </a>
          </p>
          {keyTest && (
            <p
              className={`mt-2 flex items-center gap-1.5 text-xs ${
                keyTest.ok ? 'text-emerald-300' : 'text-red-300'
              }`}
            >
              {keyTest.ok ? (
                <CheckCircle2 className="h-3.5 w-3.5" />
              ) : (
                <AlertCircle className="h-3.5 w-3.5" />
              )}
              {keyTest.message}
            </p>
          )}
        </section>

        <section className="card p-6">
          <h3 className="mb-4 text-sm font-semibold text-slate-300">
            Server & Sync
          </h3>
          <label className="flex cursor-pointer items-center justify-between gap-4">
            <span>
              <span className="block text-sm text-slate-200">
                Sync with backend for summaries
              </span>
              <span className="block text-xs text-slate-500">
                When off, summaries are generated locally in your browser.
              </span>
            </span>
            <input
              type="checkbox"
              className="h-5 w-9 cursor-pointer appearance-none rounded-full bg-surface-border transition checked:bg-brand-600 relative before:absolute before:top-0.5 before:left-0.5 before:h-4 before:w-4 before:rounded-full before:bg-white before:transition checked:before:translate-x-4"
              checked={settings.syncToServer}
              onChange={(e) => update('syncToServer', e.target.checked)}
            />
          </label>

          <div className="mt-4 flex items-center justify-between border-t border-surface-border pt-4">
            <div className="text-xs text-slate-500">
              <p>API: {config.apiUrl}</p>
              <p>WebSocket: {config.wsUrl}</p>
            </div>
            <button className="btn-secondary" onClick={checkHealth}>
              <Server className="h-4 w-4" />
              {health === 'checking' ? 'Checking...' : 'Test connection'}
            </button>
          </div>
          {health === 'ok' && (
            <p className="mt-3 text-sm text-emerald-300">Server is reachable.</p>
          )}
          {health === 'down' && (
            <p className="mt-3 text-sm text-red-300">
              Could not reach the server. Make sure the backend is running.
            </p>
          )}
        </section>

        <section className="card p-6">
          <h3 className="mb-2 text-sm font-semibold text-slate-300">Data</h3>
          <p className="mb-4 text-xs text-slate-500">
            All meetings are stored in your browser's localStorage. Clearing
            removes them permanently.
          </p>
          <button className="btn-danger" onClick={clearData}>
            <Trash2 className="h-4 w-4" />
            {confirmClear ? 'Click again to confirm' : 'Clear all meetings'}
          </button>
        </section>

        <div className="flex justify-end">
          <button className="btn-primary" onClick={handleSave}>
            {saved ? (
              <>
                <CheckCircle2 className="h-4 w-4" /> Saved
              </>
            ) : (
              <>
                <Save className="h-4 w-4" /> Save Settings
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
