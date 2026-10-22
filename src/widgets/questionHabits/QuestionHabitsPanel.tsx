import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight, Loader2, Pencil, Plus, RefreshCw, Sparkles, Trash2 } from 'lucide-react'
import {
  QUESTION_HABIT_CATEGORIES,
  type QuestionHabitCategory,
  type QuestionHabitEvidence,
  type QuestionHabitItem,
} from '@/entities/questionHabits/types'
import {
  QuestionHabitsService,
  type HabitsRunProgress,
  type QuestionHabitsStatus,
} from '@/services/questionHabitsService'
import { buildAIServices } from '@/services/aiServices'
import { toast } from '@/features/toast/toastStore'
import { Button } from '@/shared/ui/Button'
import { Badge } from '@/shared/ui/Badge'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/shared/ui/Dialog'
import { Label } from '@/shared/ui/Label'
import { LoadingState } from '@/shared/ui/LoadingState'
import { SectionHeading } from '@/shared/ui/Section'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/Select2'
import { Textarea } from '@/shared/ui/Textarea'
import { GenerationControls } from '@/shared/ui/GenerationControls'
import { useGenerationRun } from '@/shared/lib/useGenerationRun'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { useTranslation, type TranslationKey } from '@/i18n'

const CATEGORY_KEYS: Record<QuestionHabitCategory, TranslationKey> = {
  types: 'habits.category.types',
  structure: 'habits.category.structure',
  wording: 'habits.category.wording',
  notation: 'habits.category.notation',
  numbers: 'habits.category.numbers',
  traps: 'habits.category.traps',
  answer_format: 'habits.category.answer_format',
  difficulty: 'habits.category.difficulty',
  options: 'habits.category.options',
  marks: 'habits.category.marks',
  data_sheet: 'habits.category.data_sheet',
  sig_figs: 'habits.category.sig_figs',
  context: 'habits.category.context',
}

interface EditTarget {
  item?: QuestionHabitItem
}

/**
 * 「教授出题习惯」 on the course home: the professor's question habits read
 * from homework, Professor Practice and past exams, each with its verbatim
 * examples; edit / delete / add items, and the 「模仿教授出题」 switch that
 * feeds them into 做练习题, quizzes and the oral exam. Every AI run is
 * started by the student (never automatic) and can be paused or stopped.
 */
export function QuestionHabitsPanel({ projectId }: { projectId: string }): JSX.Element {
  const { t } = useTranslation()
  const service = useMemo(() => new QuestionHabitsService(), [])
  const [status, setStatus] = useState<QuestionHabitsStatus | null>(null)
  const [progress, setProgress] = useState<HabitsRunProgress | null>(null)
  const [busy, setBusy] = useState(false)
  const [edit, setEdit] = useState<EditTarget | null>(null)
  const [remove, setRemove] = useState<QuestionHabitItem | null>(null)
  const [confirmRebuild, setConfirmRebuild] = useState(false)
  const runControl = useGenerationRun()

  const reload = useCallback(async () => {
    try {
      setStatus(await service.status(projectId))
    } catch (err) {
      toast({ variant: 'error', title: t('habits.loadFailed'), description: friendlyAIError(err) })
    }
  }, [service, projectId, t])

  useEffect(() => {
    void reload()
  }, [reload])

  const profile = status?.profile
  const items = profile?.items ?? []
  const enabled = profile?.enabled !== false
  const pending = status?.pending ?? []

  async function analyze(force = false) {
    const bundle = await buildAIServices()
    if (!bundle) {
      toast({
        variant: 'error',
        title: t('quiz.noProvider'),
        description: t('quiz.noProviderHint'),
      })
      return
    }
    const control = runControl.start()
    setBusy(true)
    setProgress({ done: 0, total: 0 })
    try {
      const result = await new QuestionHabitsService({ ai: bundle.ai }).analyze(projectId, {
        control,
        force,
        onProgress: setProgress,
      })
      if (result.paused) return
      runControl.reset()
      setProgress(null)
      toast({
        variant: 'success',
        title:
          result.total === 0
            ? t('habits.upToDate')
            : t('habits.updated', { added: result.added, updated: result.updated }),
        ...(result.dropped > 0
          ? { description: t('habits.droppedNoEvidence', { count: result.dropped }) }
          : {}),
      })
    } catch (err) {
      runControl.reset()
      setProgress(null)
      toast({
        variant: 'error',
        title: t('habits.analyzeFailed'),
        description: friendlyAIError(err),
      })
    } finally {
      control.finish()
      setBusy(false)
      await reload()
    }
  }

  async function toggle(next: boolean) {
    await service.setEnabled(projectId, next)
    await reload()
  }

  if (!status) return <LoadingState label={t('habits.loading')} />

  const byCategory = QUESTION_HABIT_CATEGORIES.map((category) => ({
    category,
    items: items.filter((item) => item.category === category),
  })).filter((group) => group.items.length > 0)

  return (
    // ~70ch measure: the statements and quotes are read as prose.
    <div className="max-w-[70ch] space-y-6">
      <SectionHeading
        title={t('habits.title')}
        description={t('habits.description')}
        action={
          <span className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setEdit({})} disabled={busy}>
              <Plus className="h-4 w-4" />
              {t('habits.add')}
            </Button>
            <Button
              size="sm"
              onClick={() => void analyze()}
              disabled={busy || status.sourceCount === 0}
            >
              {busy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              {t(profile && profile.sources.length > 0 ? 'habits.update' : 'habits.analyze')}
            </Button>
          </span>
        }
      />

      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          className="focus-ring mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
          checked={enabled}
          onChange={(event) => void toggle(event.target.checked)}
        />
        <span className="space-y-0.5">
          <span className="block font-medium">{t('habits.imitate')}</span>
          <span className="block text-muted-foreground">{t('habits.imitateHint')}</span>
        </span>
      </label>

      {progress && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {runControl.active && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          <span className="data-num text-muted-foreground lab:font-mono">
            {t('habits.progress', { done: progress.done, total: progress.total })}
          </span>
          <GenerationControls
            kind="parts"
            state={runControl.state}
            done={progress.done}
            total={progress.total}
            stopRequested={runControl.run?.stopRequested ?? false}
            onPause={runControl.requestPause}
            onStopNow={runControl.stopNow}
            {...(!busy ? { onResume: () => void analyze() } : {})}
          />
        </div>
      )}

      {!busy && pending.length > 0 && status.sourceCount > 0 && (
        <div
          role="note"
          className="space-y-2 rounded-lg border border-border bg-muted/30 p-3 text-sm lab:rounded-none"
        >
          <p className="font-medium">
            {t(profile ? 'habits.pendingTitle' : 'habits.firstTitle', { count: pending.length })}
          </p>
          <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
            {pending.slice(0, 6).map((doc) => (
              <li key={doc.documentId} className="break-words">
                {doc.documentName} · {t(`habits.kind.${doc.kind}` as TranslationKey)}
                {doc.isNew ? '' : ` · ${t('habits.changed')}`}
              </li>
            ))}
            {pending.length > 6 && <li>{t('habits.more', { count: pending.length - 6 })}</li>}
          </ul>
          <p className="text-xs text-muted-foreground">{t('habits.costHint')}</p>
        </div>
      )}

      {status.sourceCount === 0 && items.length === 0 ? (
        <div className="space-y-2 border-t-[1.5px] border-foreground pt-4 text-sm lab:border lab:border-border lab:p-4">
          <p className="font-medium">{t('habits.emptyTitle')}</p>
          <p className="text-muted-foreground">{t('habits.emptyBody')}</p>
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('habits.noItems')}</p>
      ) : (
        <div className="space-y-6">
          {byCategory.map((group) => (
            <section key={group.category} className="space-y-2">
              <h3 className="font-heading text-base font-semibold lab:font-mono lab:text-xs lab:uppercase lab:tracking-wider">
                {t(CATEGORY_KEYS[group.category])}
              </h3>
              <ul className="divide-y divide-border border-y border-border lab:border">
                {group.items.map((item) => (
                  <HabitRow
                    key={item.id}
                    item={item}
                    projectId={projectId}
                    disabled={busy}
                    onEdit={() => setEdit({ item })}
                    onDelete={() => setRemove(item)}
                  />
                ))}
              </ul>
            </section>
          ))}
          {profile && profile.sources.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => setConfirmRebuild(true)}
            >
              <RefreshCw className="h-4 w-4" />
              {t('habits.rebuild')}
            </Button>
          )}
        </div>
      )}

      <HabitEditDialog
        target={edit}
        onOpenChange={(open) => {
          if (!open) setEdit(null)
        }}
        onSave={async (category, statement) => {
          try {
            if (edit?.item)
              await service.updateItem(projectId, edit.item.id, { category, statement })
            else await service.addItem(projectId, { category, statement })
            setEdit(null)
            await reload()
          } catch (err) {
            toast({
              variant: 'error',
              title: t('habits.saveFailed'),
              description: friendlyAIError(err),
            })
          }
        }}
      />
      <ConfirmDialog
        open={remove !== null}
        onOpenChange={(open) => {
          if (!open) setRemove(null)
        }}
        title={t('habits.deleteTitle')}
        description={remove?.statement}
        variant="destructive"
        confirmLabel={t('common.delete')}
        onConfirm={async () => {
          if (remove) await service.deleteItem(projectId, remove.id)
          setRemove(null)
          await reload()
        }}
      />
      <ConfirmDialog
        open={confirmRebuild}
        onOpenChange={setConfirmRebuild}
        title={t('habits.rebuildTitle')}
        description={t('habits.rebuildBody')}
        confirmLabel={t('habits.rebuild')}
        onConfirm={() => {
          setConfirmRebuild(false)
          void analyze(true)
        }}
      />
    </div>
  )
}

function HabitRow({
  item,
  projectId,
  disabled,
  onEdit,
  onDelete,
}: {
  item: QuestionHabitItem
  projectId: string
  disabled: boolean
  onEdit: () => void
  onDelete: () => void
}): JSX.Element {
  const { t } = useTranslation()
  return (
    <li className="space-y-1.5 py-3 lab:px-3">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 break-words text-sm">{item.statement}</p>
        {item.userEdited && <Badge variant="secondary">{t('habits.yours')}</Badge>}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          disabled={disabled}
          aria-label={t('habits.edit')}
          title={t('habits.edit')}
          onClick={onEdit}
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0"
          disabled={disabled}
          aria-label={t('common.delete')}
          title={t('common.delete')}
          onClick={onDelete}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
      {item.evidence.length > 0 ? (
        <details className="text-xs text-muted-foreground">
          <summary className="focus-ring cursor-pointer select-none rounded-sm">
            {t('habits.evidence', { count: item.evidence.length })}
          </summary>
          <ul className="mt-2 space-y-2">
            {item.evidence.map((evidence, index) => (
              <li key={index} className="space-y-1">
                <blockquote className="break-words border-l-2 border-border pl-3 text-foreground/80">
                  {evidence.quote}
                </blockquote>
                <Link
                  to={evidenceLink(projectId, evidence)}
                  className="focus-ring ml-3 inline-flex min-h-8 items-center gap-1 rounded-sm text-sm font-medium text-primary underline-offset-2 hover:underline"
                >
                  {t('habits.openSource')}
                  <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </details>
      ) : (
        <p className="text-xs text-muted-foreground">{t('habits.noEvidence')}</p>
      )}
    </li>
  )
}

function evidenceLink(projectId: string, evidence: QuestionHabitEvidence): string {
  if ((evidence.kind === 'homework' || evidence.kind === 'exam') && evidence.setId)
    return `/projects/${projectId}/homework/${evidence.setId}`
  if (evidence.kind === 'practice') return `/projects/${projectId}/practice`
  return `/projects/${projectId}/documents/${evidence.documentId}`
}

function HabitEditDialog({
  target,
  onOpenChange,
  onSave,
}: {
  target: EditTarget | null
  onOpenChange: (open: boolean) => void
  onSave: (category: QuestionHabitCategory, statement: string) => Promise<void>
}): JSX.Element {
  const { t } = useTranslation()
  const [category, setCategory] = useState<QuestionHabitCategory>('structure')
  const [statement, setStatement] = useState('')
  useEffect(() => {
    if (!target) return
    setCategory(target.item?.category ?? 'structure')
    setStatement(target.item?.statement ?? '')
  }, [target])

  return (
    <Dialog open={target !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            if (statement.trim()) void onSave(category, statement)
          }}
        >
          <DialogHeader>
            <DialogTitle>{t(target?.item ? 'habits.editTitle' : 'habits.addTitle')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="habit-category">{t('habits.categoryLabel')}</Label>
            <Select
              value={category}
              onValueChange={(value) => setCategory(value as QuestionHabitCategory)}
            >
              <SelectTrigger id="habit-category">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {QUESTION_HABIT_CATEGORIES.map((each) => (
                  <SelectItem key={each} value={each}>
                    {t(CATEGORY_KEYS[each])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="habit-statement">{t('habits.statementLabel')}</Label>
            <Textarea
              id="habit-statement"
              rows={3}
              maxLength={240}
              value={statement}
              onChange={(event) => setStatement(event.target.value)}
            />
            <p className="text-xs text-muted-foreground">{t('habits.editHint')}</p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!statement.trim()}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
