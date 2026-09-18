import { useEffect, useState } from 'react'
import { Eye, EyeOff, Languages, Loader2, RotateCcw, Save, Wifi } from 'lucide-react'
import { useAISettings } from '@/features/settings/useAISettings'
import { useUILanguage } from '@/features/settings/useUILanguage'
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
import { LANGUAGE_LABELS, UI_LANGUAGES, useTranslation, type UILanguage } from '@/i18n'

export function SettingsPage(): JSX.Element {
  const { t } = useTranslation()
  const { language, setLanguage } = useUILanguage()
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
          <LoadingState label={t('settings.loading')} />
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
      toast({ variant: 'success', title: t('settings.saved') })
    } catch (err) {
      const msg = isAppError(err) ? err.message : t('settings.saveFailed')
      toast({ variant: 'error', title: t('settings.saveFailedTitle'), description: msg })
    }
  }

  async function resetDefaults() {
    try {
      await reset()
      setDirty(false)
      toast({ variant: 'info', title: t('settings.resetDone') })
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('settings.resetFailed')
      toast({ variant: 'error', title: t('settings.resetFailedTitle'), description: msg })
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
          title: t('settings.connectionOk'),
          description: t('settings.connectionOkBody', {
            model: result.model,
            latency: result.latencyMs,
          }),
        })
      } else {
        toast({
          variant: 'error',
          title: t('settings.connectionFailed'),
          description: result.error ?? t('settings.unknownError'),
        })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('settings.testFailed')
      toast({ variant: 'error', title: t('settings.testFailed'), description: msg })
      setTestResult({ ok: false, latencyMs: 0, model: draft.model, error: msg })
    } finally {
      setTesting(false)
    }
  }

  const preset = PROVIDER_PRESETS.find((p) => p.id === draft.provider)

  return (
    <PageContainer>
      <PageHeader
        title={t('settings.title')}
        description={t('settings.description')}
        actions={
          <>
            <Button variant="outline" onClick={resetDefaults}>
              <RotateCcw className="h-4 w-4" />
              {t('settings.resetDefaults')}
            </Button>
            <Button variant="outline" onClick={testConnection} disabled={testing || !draft.apiKey}>
              {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />}
              {testing ? t('settings.testing') : t('settings.testConnection')}
            </Button>
            <Button onClick={save} disabled={!dirty || saving}>
              <Save className="h-4 w-4" />
              {saving ? t('settings.saving') : t('settings.saveChanges')}
            </Button>
          </>
        }
      />
      <PageContent className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Languages className="h-4 w-4" />
              {t('settings.language.title')}
            </CardTitle>
            <CardDescription>{t('settings.language.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Label htmlFor="ui-language">{t('settings.language.label')}</Label>
            <Select value={language} onValueChange={(v) => setLanguage(v as UILanguage)}>
              <SelectTrigger id="ui-language" className="sm:max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UI_LANGUAGES.map((lang) => (
                  <SelectItem key={lang} value={lang}>
                    {LANGUAGE_LABELS[lang]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t('settings.language.hint')}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('settings.provider.title')}</CardTitle>
            <CardDescription>{t('settings.provider.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="provider">{t('settings.provider.label')}</Label>
                <Select value={draft.provider} onValueChange={onProviderChange}>
                  <SelectTrigger id="provider">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PROVIDER_PRESETS.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.id === 'custom' ? t('provider.custom') : p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{t('settings.provider.hint')}</p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="model">{t('settings.model')}</Label>
                <Input
                  id="model"
                  list="model-suggestions"
                  value={draft.model}
                  onChange={(e) => patch('model', e.target.value)}
                  placeholder={preset?.defaultModel || t('settings.modelPlaceholder')}
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
              <Label htmlFor="baseURL">{t('settings.baseUrl')}</Label>
              <Input
                id="baseURL"
                value={draft.baseURL}
                onChange={(e) => patch('baseURL', e.target.value)}
                placeholder="https://api.example.com/v1"
              />
              <p className="text-xs text-muted-foreground">{t('settings.baseUrlHint')}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('settings.apiKey.title')}</CardTitle>
            <CardDescription>{t('settings.apiKey.description')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="apiKey">{t('settings.apiKey.label')}</Label>
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
                  aria-label={showKey ? t('settings.apiKey.hide') : t('settings.apiKey.show')}
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              {testResult && (
                <p
                  className={cn(
                    'text-xs',
                    testResult.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive',
                  )}
                >
                  {testResult.ok
                    ? t('settings.apiKey.connected', {
                        latency: testResult.latencyMs,
                        model: testResult.model,
                      })
                    : t('settings.apiKey.failed', {
                        error: testResult.error ?? t('settings.unknownError'),
                      })}
                </p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('settings.sampling.title')}</CardTitle>
            <CardDescription>{t('settings.sampling.description')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-6 sm:grid-cols-2">
            <div className="space-y-3">
              <div className="flex items-baseline justify-between">
                <Label htmlFor="temperature">{t('settings.sampling.temperature')}</Label>
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
                {t('settings.sampling.temperatureHint')}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="maxTokens">{t('settings.sampling.maxTokens')}</Label>
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
                {t('settings.sampling.maxTokensHint')}
              </p>
            </div>
          </CardContent>
        </Card>

        <DataManagementPanel />
      </PageContent>
    </PageContainer>
  )
}
