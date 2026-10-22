import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  Eye,
  EyeOff,
  Gauge,
  ImageIcon,
  Languages,
  ListRestart,
  Loader2,
  RotateCcw,
  Wifi,
} from 'lucide-react'
import { useAISettings } from '@/features/settings/useAISettings'
import { useSettingsStore } from '@/features/settings/settingsStore'
import { useUILanguage } from '@/features/settings/useUILanguage'
import { PROVIDER_PRESETS, type AIProviderId, type AISettings } from '@/entities/settings/types'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { Input } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { LoadingState } from '@/shared/ui/LoadingState'
import { PageContainer, PageContent, PageHeader } from '@/shared/ui/Page'
import { ThemePicker } from '@/widgets/theme/ThemePicker'
import { NoteMarkStyleSetting } from '@/widgets/settings/NoteMarkStyleSetting'
import { WalkthroughLevelSetting } from '@/widgets/settings/WalkthroughLevelSetting'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/Select2'
import { Slider } from '@/shared/ui/Slider'
import { cn } from '@/shared/lib/utils'
import { toast } from '@/features/toast/toastStore'
import { isAppError } from '@/infrastructure/errors/AppError'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { AIService } from '@/services/aiService'
import { DataManagementPanel } from '@/widgets/dataManagement/DataManagementPanel'
import { ModelCombobox } from '@/widgets/settings/ModelCombobox'
import { UsagePanel } from '@/widgets/settings/UsagePanel'
import {
  SETTINGS_SECTION,
  SETTINGS_SECTION_BODY,
  SETTINGS_SECTION_HEAD,
  SETTINGS_SECTION_TITLE,
  SETTINGS_SHELL,
} from '@/widgets/settings/settingsSection'
import { SettingsGroup } from '@/widgets/settings/SettingsGroup'
import { SaveBar } from '@/widgets/settings/SaveBar'
import { fetchModelList, type ModelListResult } from '@/infrastructure/ai/models'
import {
  MANUAL_MAX_TOKENS_MAX,
  MANUAL_MAX_TOKENS_MIN,
  resolveOutputLimit,
} from '@/infrastructure/ai/outputLimit'
import { APP_VERSION } from '@/shared/config/config'
import { LANGUAGE_LABELS, UI_LANGUAGES, useTranslation, type UILanguage } from '@/i18n'

const SECTION = SETTINGS_SECTION
const SECTION_HEAD = SETTINGS_SECTION_HEAD
const SECTION_TITLE = SETTINGS_SECTION_TITLE
const SECTION_BODY = SETTINGS_SECTION_BODY

export function SettingsPage(): JSX.Element {
  const { t } = useTranslation()
  const { language, setLanguage } = useUILanguage()
  const { settings, loaded, loading, saving, update, reset, rememberModelOutputLimits } =
    useAISettings()
  const [draft, setDraft] = useState<AISettings | null>(null)
  const [showKey, setShowKey] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{
    ok: boolean
    latencyMs: number
    model: string
    error?: string
  } | null>(null)
  const location = useLocation()
  const [modelList, setModelList] = useState<ModelListResult | null>(null)
  const [fetchingModels, setFetchingModels] = useState(false)
  /** Base URL + key the current list was fetched for: blur only refetches on change. */
  const fetchedFor = useRef('')

  useEffect(() => {
    if (settings && !draft) {
      setDraft(settings)
    }
  }, [settings, draft])

  // `/settings#ai-usage` (the sidebar / account-menu readout) scrolls to the
  // usage section once the page has rendered.
  const ready = Boolean(loaded && !loading && draft)
  useEffect(() => {
    if (!ready || !location.hash) return
    const target = document.getElementById(location.hash.slice(1))
    target?.scrollIntoView({ block: 'start' })
  }, [ready, location.hash])

  // Leaving the page (reload / close) with unsaved edits asks first.
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  if (!loaded || loading || !draft) {
    return (
      <PageContainer>
        <PageContent>
          <LoadingState label={t('settings.loading')} />
        </PageContent>
      </PageContainer>
    )
  }

  /**
   * `GET {base}/models` with the draft's Base URL and key. `auto` runs on blur
   * and after saving: it is silent when nothing changed or a field is empty.
   */
  async function loadModels(auto: boolean) {
    if (!draft) return
    const baseURL = draft.baseURL.trim()
    const apiKey = draft.apiKey.trim()
    const signature = `${baseURL} ${apiKey}`
    if (auto && (!baseURL || !apiKey || signature === fetchedFor.current)) return
    fetchedFor.current = signature
    setFetchingModels(true)
    try {
      const result = await fetchModelList({ baseURL, apiKey })
      // A later fetch (other base URL / key, or a provider switch) wins.
      if (fetchedFor.current !== signature) return
      setModelList(result)
      if (result.ok) {
        // Output limits from the metadata, when the provider states them. Kept
        // out of the unsaved edits: they describe the provider, not a choice.
        setDraft((d) =>
          d && d.baseURL.trim() === baseURL ? { ...d, modelOutputLimits: result.limits } : d,
        )
        void rememberModelOutputLimits(baseURL, result.limits)
      }
    } finally {
      setFetchingModels(false)
    }
  }

  function patch<K extends keyof AISettings>(key: K, value: AISettings[K]) {
    setDraft((d) => (d ? { ...d, [key]: value } : d))
    setDirty(true)
  }

  async function onProviderChange(providerId: string) {
    const id = providerId as AIProviderId
    patch('provider', id)
    // The fetched list belongs to the previous provider's base URL.
    setModelList(null)
    fetchedFor.current = ''
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
      void loadModels(true)
    } catch (err) {
      const msg = isAppError(err) ? err.message : t('settings.saveFailed')
      toast({ variant: 'error', title: t('settings.saveFailedTitle'), description: msg })
    }
  }

  async function resetDefaults() {
    try {
      await reset()
      // Replace the local draft with the freshly reset settings: otherwise the
      // old key / base URL / model stay in the form and a later Save (or Test
      // connection) would quietly use them again.
      const fresh = useSettingsStore.getState().settings
      if (fresh) setDraft(fresh)
      setShowKey(false)
      setTestResult(null)
      setDirty(false)
      toast({ variant: 'info', title: t('settings.resetDone') })
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('settings.resetFailed')
      toast({ variant: 'error', title: t('settings.resetFailedTitle'), description: msg })
    }
  }

  /** Throw the unsaved edits away: back to the stored settings. */
  function discard() {
    if (settings) setDraft(settings)
    setTestResult(null)
    setDirty(false)
  }

  /** The stored settings were cleared elsewhere on the page: drop the old draft. */
  function onSettingsCleared() {
    const fresh = useSettingsStore.getState().settings
    if (fresh) setDraft(fresh)
    setShowKey(false)
    setTestResult(null)
    setDirty(false)
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
      // e.g. a missing base URL / model: the typed error maps to what to fix.
      const msg = friendlyAIError(err)
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
            <Button
              variant="outline"
              onClick={resetDefaults}
              aria-label={t('settings.resetDefaults')}
              title={t('settings.resetDefaults')}
            >
              <RotateCcw className="h-4 w-4" />
              <span className="hidden sm:inline">{t('settings.resetDefaults')}</span>
            </Button>
            <Button
              variant="outline"
              onClick={testConnection}
              disabled={testing || !draft.apiKey}
              aria-label={t('settings.testConnection')}
              title={t('settings.testConnection')}
            >
              {testing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Wifi className="h-4 w-4" />
              )}
              <span className="hidden sm:inline">
                {testing ? t('settings.testing') : t('settings.testConnection')}
              </span>
            </Button>
          </>
        }
      />
      <PageContent>
        <div className="space-y-6 lecture:mx-auto lecture:max-w-[860px] lecture:space-y-0 lab:max-w-[880px]">
          <SettingsGroup
            id="settings-instant"
            title={t('settings.group.instant')}
            note={t('settings.group.instantNote')}
          >
            <Card className={SECTION}>
              <CardHeader className={SECTION_HEAD}>
                <CardTitle className={cn(SECTION_TITLE, 'flex items-center gap-2')}>
                  <Languages className="h-4 w-4 lecture:hidden" />
                  {t('settings.language.title')}
                </CardTitle>
                <CardDescription>{t('settings.language.description')}</CardDescription>
              </CardHeader>
              <CardContent className={cn(SECTION_BODY, 'space-y-2')}>
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

            {/* Appearance applies instantly; it is not part of the Save button. */}
            <ThemePicker {...SETTINGS_SHELL} />

            <NoteMarkStyleSetting {...SETTINGS_SHELL} />

            <WalkthroughLevelSetting {...SETTINGS_SHELL} />
          </SettingsGroup>

          <SettingsGroup
            id="settings-saved"
            title={t('settings.group.saved')}
            note={t('settings.group.savedNote')}
          >
            <Card className={SECTION}>
              <CardHeader className={SECTION_HEAD}>
                <CardTitle className={SECTION_TITLE}>{t('settings.provider.title')}</CardTitle>
                <CardDescription>{t('settings.provider.description')}</CardDescription>
              </CardHeader>
              <CardContent className={cn(SECTION_BODY, 'space-y-4')}>
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
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="model">{t('settings.model')}</Label>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => void loadModels(false)}
                        disabled={fetchingModels}
                      >
                        {fetchingModels ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                        ) : (
                          <ListRestart className="h-3.5 w-3.5" aria-hidden />
                        )}
                        {fetchingModels
                          ? t('settings.models.fetching')
                          : t('settings.models.fetch')}
                      </Button>
                    </div>
                    <ModelCombobox
                      id="model"
                      value={draft.model}
                      onChange={(value) => patch('model', value)}
                      models={modelList?.ok ? modelList.models : (preset?.models ?? [])}
                      placeholder={preset?.defaultModel || t('settings.modelPlaceholder')}
                    />
                    {modelList && <ModelListNote result={modelList} />}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="baseURL">{t('settings.baseUrl')}</Label>
                  <Input
                    id="baseURL"
                    value={draft.baseURL}
                    onChange={(e) => patch('baseURL', e.target.value)}
                    onBlur={() => void loadModels(true)}
                    placeholder="https://api.example.com/v1"
                  />
                  <p className="text-xs text-muted-foreground">{t('settings.baseUrlHint')}</p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="lightModel">{t('settings.lightModel')}</Label>
                  <ModelCombobox
                    id="lightModel"
                    value={draft.lightModel ?? ''}
                    onChange={(value) => patch('lightModel', value)}
                    models={modelList?.ok ? modelList.models : (preset?.models ?? [])}
                    placeholder={t('settings.lightModelPlaceholder')}
                  />
                  <p className="text-xs text-muted-foreground">{t('settings.lightModelHint')}</p>
                </div>
              </CardContent>
            </Card>

            <Card className={SECTION}>
              <CardHeader className={SECTION_HEAD}>
                <CardTitle className={SECTION_TITLE}>{t('settings.apiKey.title')}</CardTitle>
                <CardDescription>{t('settings.apiKey.description')}</CardDescription>
              </CardHeader>
              <CardContent className={cn(SECTION_BODY, 'space-y-3')}>
                <div className="space-y-2">
                  <Label htmlFor="apiKey">{t('settings.apiKey.label')}</Label>
                  <div className="flex gap-2">
                    <Input
                      id="apiKey"
                      type={showKey ? 'text' : 'password'}
                      value={draft.apiKey}
                      onChange={(e) => patch('apiKey', e.target.value)}
                      onBlur={() => void loadModels(true)}
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
                        testResult.ok
                          ? 'text-emerald-600 dark:text-emerald-400'
                          : 'text-destructive',
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

            <Card id="ai-usage" className={cn(SECTION, 'scroll-mt-20')}>
              <CardHeader className={SECTION_HEAD}>
                <CardTitle className={cn(SECTION_TITLE, 'flex items-center gap-2')}>
                  <Gauge className="h-4 w-4 lecture:hidden" aria-hidden />
                  {t('usage.title')}
                </CardTitle>
                <CardDescription>{t('usage.description')}</CardDescription>
              </CardHeader>
              <CardContent className={SECTION_BODY}>
                <UsagePanel draft={draft} patch={patch} />
              </CardContent>
            </Card>

            <Card className={SECTION}>
              <CardHeader className={SECTION_HEAD}>
                <CardTitle className={SECTION_TITLE}>{t('settings.sampling.title')}</CardTitle>
                <CardDescription>{t('settings.sampling.description')}</CardDescription>
              </CardHeader>
              <CardContent className={cn(SECTION_BODY, 'grid gap-6 sm:grid-cols-2')}>
                <div className="space-y-3">
                  <div className="flex items-baseline justify-between">
                    <Label htmlFor="temperature">{t('settings.sampling.temperature')}</Label>
                    <span className="text-sm tabular-nums text-muted-foreground lab:font-mono">
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

                <MaxTokensSetting draft={draft} patch={patch} />
              </CardContent>
            </Card>

            <Card className={SECTION}>
              <CardHeader className={SECTION_HEAD}>
                <CardTitle className={cn(SECTION_TITLE, 'flex items-center gap-2')}>
                  <ImageIcon className="h-4 w-4 lecture:hidden" aria-hidden />
                  {t('settings.webImages.title')}
                </CardTitle>
                <CardDescription>{t('settings.webImages.description')}</CardDescription>
              </CardHeader>
              <CardContent className={cn(SECTION_BODY, 'space-y-3')}>
                <label className="flex cursor-pointer items-start gap-3">
                  <input
                    type="checkbox"
                    className="focus-ring mt-0.5 h-4 w-4 shrink-0 accent-primary"
                    checked={draft.webImagesEnabled}
                    onChange={(e) => patch('webImagesEnabled', e.target.checked)}
                  />
                  <span className="space-y-0.5">
                    <span className="block text-sm font-medium">
                      {t('settings.webImages.enable')}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {t('settings.webImages.enableHint')}
                    </span>
                  </span>
                </label>
                <label
                  className={cn(
                    'flex items-start gap-3 pl-7',
                    draft.webImagesEnabled ? 'cursor-pointer' : 'cursor-not-allowed opacity-50',
                  )}
                >
                  <input
                    type="checkbox"
                    className="focus-ring mt-0.5 h-4 w-4 shrink-0 accent-primary"
                    checked={draft.webImagesVisionCheck}
                    disabled={!draft.webImagesEnabled}
                    onChange={(e) => patch('webImagesVisionCheck', e.target.checked)}
                  />
                  <span className="space-y-0.5">
                    <span className="block text-sm font-medium">
                      {t('settings.webImages.vision')}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {t('settings.webImages.visionHint')}
                    </span>
                  </span>
                </label>
              </CardContent>
            </Card>
          </SettingsGroup>

          <SettingsGroup
            id="settings-data"
            title={t('settings.group.data')}
            note={t('settings.group.dataNote')}
          >
            <DataManagementPanel onSettingsCleared={onSettingsCleared} {...SETTINGS_SHELL} />
          </SettingsGroup>
          {/* Lets a bug report say which release it came from. */}
          <p className="text-center text-xs text-muted-foreground lecture:pt-6 lab:font-mono lab:text-[11px]">
            {t('settings.version', { version: APP_VERSION })}
          </p>
        </div>
        <SaveBar visible={dirty} saving={saving} onSave={() => void save()} onDiscard={discard} />
      </PageContent>
    </PageContainer>
  )
}

/** Result of the last model-list fetch: how many models, or why manual input is needed. */
function ModelListNote({ result }: { result: ModelListResult }): JSX.Element {
  const { t } = useTranslation()
  let text: string
  if (result.ok) text = t('settings.models.count', { count: result.models.length })
  else if (result.reason === 'blocked') text = t('settings.models.blocked')
  else if (result.reason === 'auth')
    text = t('settings.models.auth', { status: result.status ?? '' })
  else if (result.reason === 'unsupported') text = t('settings.models.unsupported')
  else if (result.reason === 'missing-config') text = t('settings.models.missingConfig')
  else text = t('settings.models.failed')
  return (
    <p
      className={cn(
        'text-xs',
        result.ok ? 'text-muted-foreground' : 'text-amber-700 dark:text-amber-400',
      )}
      aria-live="polite"
    >
      {text}
    </p>
  )
}

/**
 * 最大 Token 数: 「使用模型允许的最大值」 or a number of the student's own. The
 * readout says what requests will actually use for the current model.
 */
function MaxTokensSetting({
  draft,
  patch,
}: {
  draft: AISettings
  patch: <K extends keyof AISettings>(key: K, value: AISettings[K]) => void
}) {
  const { t } = useTranslation()
  const resolved = resolveOutputLimit({
    mode: draft.maxTokensMode,
    manualMaxTokens: draft.maxTokens,
    model: draft.model,
    metadata: draft.modelOutputLimits,
  })
  const known = resolved.modelMax
  const readout =
    known === undefined
      ? t('settings.sampling.modelMaxUnknown', { tokens: resolved.maxTokens })
      : t(
          draft.maxTokensMode === 'model' || resolved.maxTokens === known
            ? 'settings.sampling.modelMaxKnown'
            : 'settings.sampling.modelMaxAbove',
          {
            tokens: resolved.maxTokens,
            max: known,
            source: t(
              draft.modelOutputLimits[draft.model.trim()]
                ? 'settings.sampling.sourceMetadata'
                : 'settings.sampling.sourceTable',
            ),
          },
        )
  return (
    <div className="space-y-2">
      <Label htmlFor="maxTokens">{t('settings.sampling.maxTokens')}</Label>
      <div role="radiogroup" aria-label={t('settings.sampling.maxTokens')} className="space-y-1.5">
        {(['model', 'manual'] as const).map((mode) => (
          <label key={mode} className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="radio"
              name="maxTokensMode"
              className="focus-ring h-4 w-4 accent-primary"
              checked={draft.maxTokensMode === mode}
              onChange={() => patch('maxTokensMode', mode)}
            />
            {t(mode === 'model' ? 'settings.sampling.modeModel' : 'settings.sampling.modeManual')}
          </label>
        ))}
      </div>
      <Input
        id="maxTokens"
        type="number"
        min={MANUAL_MAX_TOKENS_MIN}
        max={MANUAL_MAX_TOKENS_MAX}
        step={64}
        aria-describedby="maxTokensHint"
        value={draft.maxTokens}
        onChange={(e) => patch('maxTokens', Number(e.target.value))}
      />
      <p className="text-xs text-foreground/80" aria-live="polite">
        {readout}
      </p>
      <p id="maxTokensHint" className="text-xs text-muted-foreground">
        {t(
          draft.maxTokensMode === 'model'
            ? 'settings.sampling.maxTokensHintModel'
            : 'settings.sampling.maxTokensHint',
        )}
      </p>
    </div>
  )
}
