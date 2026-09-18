import { useEffect, useState } from 'react'
import { Eye, EyeOff, Loader2, RotateCcw, Save, Wifi } from 'lucide-react'
import { useAISettings } from '@/features/settings/useAISettings'
import {
  PROVIDER_PRESETS,
  type AIProviderId,
  type AISettings,
} from '@/entities/settings/types'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { Input } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { LoadingState } from '@/shared/ui/LoadingState'
import { PageContainer, PageContent, PageHeader } from '@/shared/ui/Page'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/Select2'
import { Slider } from '@/shared/ui/Slider'
import { cn } from '@/shared/lib/utils'
import { toast } from '@/features/toast/toastStore'
import { isAppError } from '@/infrastructure/errors/AppError'
import { AIService } from '@/services/aiService'
import { DataManagementPanel } from '@/widgets/dataManagement/DataManagementPanel'

export function SettingsPage(): JSX.Element {
  const { settings, loaded, loading, saving, update, reset } = useAISettings()
  const [draft, setDraft] = useState<AISettings | null>(null)
  const [showKey, setShowKey] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; latencyMs: number; model: string; error?: string } | null>(null)

  useEffect(() => {
    if (settings && !draft) {
      setDraft(settings)
    }
  }, [settings, draft])

  if (!loaded || loading || !draft) {
    return (
      <PageContainer>
        <PageContent>
          <LoadingState label="Loading settings" />
        </PageContent>
      </PageContainer>
    )
  }

  function patch<K extends keyof AISettings>(key: K, value: AISettings[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d))
    setDirty(true)
  }

  async function onProviderChange(providerId: string) {
    const id = providerId as AIProviderId
    patch('provider', id)
    const preset = PROVIDER_PRESETS.find((p) => p.id === id)
    if (preset) {
      patch('baseURL', preset.baseURL || draft!.baseURL)
      patch('model', preset.defaultModel || draft!.model)
    }
  }

  async function save() {
    if (!draft) return
    try {
      await update(draft)
      setDirty(false)
      toast({ variant: 'success', title: 'Settings saved' })
    } catch (err) {
      const msg = isAppError(err) ? err.message : 'Failed to save settings'
      toast({ variant: 'error', title: 'Save failed', description: msg })
    }
  }

  async function resetDefaults() {
    try {
      await reset()
      setDirty(false)
      toast({ variant: 'info', title: 'Settings reset to defaults' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to reset'
      toast({ variant: 'error', title: 'Reset failed', description: msg })
    }
  }

  async function testConnection() {
    if (!draft) return
    setTesting(true)
    setTestResult(null)
    try {
      const ai = new AIService({ config: draft })
      const result = await ai.testConnection()
      setTestResult(result)
      if (result.ok) {
        toast({
          variant: 'success',
          title: 'Connection succeeded',
          description: `Model ${result.model} responded in ${result.latencyMs} ms`,
        })
      } else {
        toast({
          variant: 'error',
          title: 'Connection failed',
          description: result.error ?? 'Unknown error',
        })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Test failed'
      toast({ variant: 'error', title: 'Test failed', description: msg })
      setTestResult({ ok: false, latencyMs: 0, model: draft.model, error: msg })
    } finally {
      setTesting(false)
    }
  }

  const preset = PROVIDER_PRESETS.find((p) => p.id === draft.provider)

  return (
    <PageContainer>
      <PageHeader
        title="AI Settings"
        description="Configure your AI provider. API keys are stored locally on this device and sent only to the provider you select."
        actions={
          <>
            <Button variant="outline" onClick={resetDefaults}>
              <RotateCcw className="h-4 w-4" />
              Reset to defaults
            </Button>
            <Button variant="outline" onClick={testConnection} disabled={testing || !draft.apiKey}>
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />}
              {testing ? 'Testing…' : 'Test connection'}
            </Button>
            <Button onClick={save} disabled={!dirty || saving}>
              <Save className="h-4 w-4" />
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </>
        }
      />
      <PageContent className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Provider</CardTitle>
            <CardDescription>
              Pick a preset or choose Custom for any OpenAI-compatible endpoint.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="provider">AI provider</Label>
                <Select value={draft.provider} onValueChange={onProviderChange}>
                  <SelectTrigger id="provider">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDER_PRESETS.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Choosing a preset suggests its base URL and default model. You can override them
                  below.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="model">Model</Label>
                <Input
                  id="model"
                  list="model-suggestions"
                  value={draft.model}
                  onChange={(e) => patch('model', e.target.value)}
                  placeholder={preset?.defaultModel || 'model-name'}
                />
                {preset && preset.models.length > 0 && (
                  <datalist id="model-suggestions">
                    {preset.models.map((m) => (
                      <option key={m} value={m} />
                    ))}
                  </datalist>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="baseURL">API Base URL</Label>
              <Input
                id="baseURL"
                value={draft.baseURL}
                onChange={(e) => patch('baseURL', e.target.value)}
                placeholder="https://api.example.com/v1"
              />
              <p className="text-xs text-muted-foreground">
                Must start with <code className="rounded bg-muted px-1">http://</code> or{' '}
                <code className="rounded bg-muted px-1">https://</code>. Browser CORS must permit
                requests from this domain.
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>API Key</CardTitle>
            <CardDescription>
              Stored locally only. Never logged, never transmitted anywhere except to your
              selected provider when you make a request.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="apiKey">Key</Label>
              <div className="flex gap-2">
                <Input
                  id="apiKey"
                  type={showKey ? 'text' : 'password'}
                  value={draft.apiKey}
                  onChange={(e) => patch('apiKey', e.target.value)}
                  placeholder="sk-..."
                  autoComplete="off"
                  spellCheck={false}
                  className="font-mono"
                />
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => setShowKey((s) => !s)}
                  aria-label={showKey ? 'Hide API key' : 'Show API key'}
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Tip: encryption-at-rest will be added in a later phase.
              </p>
              {testResult && (
                <p
                  className={cn(
                    'text-xs',
                    testResult.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive',
                  )}
                >
                  {testResult.ok
                    ? `Connected in ${testResult.latencyMs} ms (model ${testResult.model})`
                    : `Failed: ${testResult.error ?? 'unknown error'}`}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Sampling</CardTitle>
            <CardDescription>Adjust creativity and output length for AI responses.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-3">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="temperature">Temperature</Label>
                <span className="text-sm tabular-nums text-muted-foreground">
                  {draft.temperature.toFixed(2)}
                </span>
              </div>
              <Slider
                id="temperature"
                min={0}
                max={2}
                step={0.05}
                value={[draft.temperature]}
                onValueChange={(v) => patch('temperature', v[0] ?? draft.temperature)}
              />
              <p className="text-xs text-muted-foreground">
                0 = deterministic, 2 = highly creative. Recommended 0.3–0.8 for study content.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="maxTokens">Max tokens</Label>
              <Input
                id="maxTokens"
                type="number"
                min={64}
                max={32000}
                step={64}
                value={draft.maxTokens}
                onChange={(e) => patch('maxTokens', Number(e.target.value))}
              />
              <p className="text-xs text-muted-foreground">
                Maximum tokens per response. Range 64 – 32000.
              </p>
            </div>
          </CardContent>
        </Card>

        <DataManagementPanel />
      </PageContent>
    </PageContainer>
  )
}