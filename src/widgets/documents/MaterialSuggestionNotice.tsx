import { useEffect, useState, useSyncExternalStore } from 'react'
import { Lightbulb, Loader2 } from 'lucide-react'
import type { Document, LearningMaterialType } from '@/entities/document/types'
import {
  needsAiCheck,
  pendingSuggestion,
  type SuggestionReason,
} from '@/entities/document/materialSuggestion'
import { Button } from '@/shared/ui/Button'
import { useDocumentsStore } from '@/features/documents/documentsStore'
import { toast } from '@/features/toast/toastStore'
import { logger } from '@/infrastructure/logger/logger'
import { useTranslation, type TranslationKey } from '@/i18n'
import type * as MaterialTypeModule from '@/services/materialTypeService'

const ROLE_KEY: Partial<Record<LearningMaterialType, TranslationKey>> = {
  past_exam: 'materialType.past_exam',
  homework: 'materialType.homework',
  homework_answer: 'materialType.homework_answer',
  syllabus: 'materialType.syllabus',
}

const WHAT_KEY: Partial<Record<LearningMaterialType, TranslationKey>> = {
  past_exam: 'materialSuggest.what.past_exam',
  homework: 'materialSuggest.what.homework',
  homework_answer: 'materialSuggest.what.homework_answer',
  syllabus: 'materialSuggest.what.syllabus',
}

/** Reasons shown under the notice (at most this many). */
const MAX_REASONS = 3

type ServiceModule = typeof MaterialTypeModule
let serviceModule: Promise<ServiceModule> | null = null
function loadService(): Promise<ServiceModule> {
  serviceModule ??= import('@/services/materialTypeService')
  return serviceModule
}

/** Is the AI check of this document running? (Re-renders on start / end.) */
function useCheckRunning(documentId: string, enabled: boolean): ServiceModule | null {
  const [mod, setMod] = useState<ServiceModule | null>(null)
  useEffect(() => {
    if (!enabled) return
    let live = true
    void loadService().then((loaded) => {
      if (live) setMod(loaded)
    })
    return () => {
      live = false
    }
  }, [enabled])
  useSyncExternalStore(
    (listener) => (mod ? mod.subscribeMaterialChecks(listener) : () => undefined),
    () => (mod ? Boolean(mod.materialCheckRun(documentId)) : false),
  )
  return mod
}

/**
 * 资料类型按内容自动判断: one file row's notice 「这份看起来是…，要改成…吗？」
 * with 改 / 忽略. Renders nothing unless the processed content suggests a
 * different role; the role only changes when the student presses 改.
 */
export function MaterialSuggestionNotice({
  doc,
  projectId,
}: {
  doc: Document
  projectId: string
}): JSX.Element | null {
  const { t } = useTranslation()
  const refresh = useDocumentsStore((s) => s.refresh)
  const changeMaterialType = useDocumentsStore((s) => s.changeMaterialType)
  const [busy, setBusy] = useState(false)
  const suggestion = pendingSuggestion(doc)
  const waiting = needsAiCheck(doc)
  const mod = useCheckRunning(doc.id, waiting)
  const run = mod?.materialCheckRun(doc.id)

  if (waiting && run) {
    return (
      <span
        data-material-suggestion="checking"
        className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"
      >
        <Loader2 aria-hidden className="h-3 w-3 motion-safe:animate-spin" />
        <span>{t('materialSuggest.checking')}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onClick={() => run.stopNow()}
        >
          {t('materialSuggest.stop')}
        </Button>
      </span>
    )
  }
  if (!suggestion) return null
  const roleKey = ROLE_KEY[suggestion.type]
  const whatKey = WHAT_KEY[suggestion.type]
  if (!roleKey || !whatKey) return null
  const role = t(roleKey)
  const target = suggestion.type
  const reasons = suggestion.reasons
    .slice(0, MAX_REASONS)
    .map((reason: SuggestionReason) => t(`materialSuggest.reason.${reason}` as TranslationKey))

  async function change(): Promise<void> {
    setBusy(true)
    try {
      // The one role-change path (document + chunks in one transaction).
      const type = target
      await changeMaterialType(doc.id, projectId, type)
      const toHomework = type === 'homework' || type === 'past_exam'
      toast({
        variant: 'success',
        title: t(
          toHomework
            ? 'materialSuggest.changedHomework'
            : type === 'homework_answer'
              ? 'materialSuggest.changedAnswer'
              : 'materialSuggest.changed',
          { role },
        ),
      })
      // The file left (or joined) the course content: the analysis follows.
      const { CourseContentService, pausedCourseAnalysis } =
        await import('@/services/courseContentService')
      if (!pausedCourseAnalysis(projectId)) {
        void new CourseContentService().ensureAnalyzed(projectId).catch((err: unknown) => {
          logger.debug('Automatic course analysis skipped', { error: String(err) })
        })
      }
    } catch (err) {
      toast({
        variant: 'error',
        title: t('materialSuggest.changeFailed'),
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setBusy(false)
      await refresh(projectId).catch(() => undefined)
    }
  }

  async function dismiss(): Promise<void> {
    setBusy(true)
    try {
      const { MaterialTypeService } = await loadService()
      await new MaterialTypeService().dismiss(doc.id)
    } catch (err) {
      toast({
        variant: 'error',
        title: t('materialSuggest.dismissFailed'),
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setBusy(false)
      await refresh(projectId).catch(() => undefined)
    }
  }

  return (
    <span
      data-material-suggestion={suggestion.type}
      className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-amber-500/40 bg-amber-50/50 px-2 py-1 text-xs text-foreground dark:bg-amber-950/20"
    >
      <Lightbulb aria-hidden className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
      <span className="min-w-0 flex-1">
        {t('materialSuggest.notice', { what: t(whatKey), role })}
        {reasons.length > 0 && (
          <span className="block text-[11px] text-muted-foreground">
            {t('materialSuggest.reasons', { list: reasons.join(' · ') })}
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2.5 text-xs coarse:h-11"
          disabled={busy}
          onClick={() => void change()}
        >
          {t('materialSuggest.change')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2.5 text-xs coarse:h-11"
          disabled={busy}
          onClick={() => void dismiss()}
        >
          {t('materialSuggest.dismiss')}
        </Button>
      </span>
    </span>
  )
}
