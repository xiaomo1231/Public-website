import { Fragment, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  BookOpen,
  Combine,
  FileSearch,
  Link2,
  ListChecks,
  Loader2,
  Mic,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Upload,
} from 'lucide-react'
import type { Document } from '@/entities/document/types'
import {
  countExamTopics,
  MIN_LOCAL_TOPICS,
  type ExamScope,
  type ExamScopeKind,
  type ExamTopic,
} from '@/entities/syllabus/types'
import type { ExamTopicCoverage } from '@/entities/syllabus/coverage'
import { useSyllabusOverview } from '@/features/syllabus/useSyllabusOverview'
import { useDocuments } from '@/features/documents/useDocuments'
import { toast } from '@/features/toast/toastStore'
import { SyllabusService } from '@/services/syllabusService'
import { buildAIServices } from '@/services/aiServices'
import { DocumentUploadDialog } from '@/widgets/documents/DocumentUploadDialog'
import { TextPromptDialog } from './TextPromptDialog'
import { Button } from '@/shared/ui/Button'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { Input } from '@/shared/ui/Input'
import { LoadingState } from '@/shared/ui/LoadingState'
import { SectionHeading } from '@/shared/ui/Section'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { GenerationControls } from '@/shared/ui/GenerationControls'
import { useGenerationRun } from '@/shared/lib/useGenerationRun'
import { isGenerationInterruption } from '@/shared/lib/generationControl'
import { cn } from '@/shared/lib/utils'
import { useTranslation, type TranslationKey } from '@/i18n'
import { formatPercent } from '@/shared/lib/percent'

const KIND_LABEL_KEYS: Record<ExamScopeKind, TranslationKey> = {
  midterm: 'syllabus.kind.midterm',
  final: 'syllabus.kind.final',
  other: 'syllabus.kind.other',
}

interface PromptRequest {
  title: string
  initial?: string
  submit: (value: string) => void
}

interface ScopeRef {
  key: string
  document: Document
  scope: ExamScope
}

/**
 * 「考点清单」: the exam topics read from the course syllabus, each with its
 * coverage by the course material, practice count and a mastery estimate,
 * and links to study it or to quiz it. Lecture style: a ruled list under
 * scope headings; lab style: a hairline table with mono numbers.
 */
export function ExamTopicsPanel({ projectId }: { projectId: string }): JSX.Element {
  const { t } = useTranslation()
  const { documents, refresh } = useDocuments(projectId)
  const version = useMemo(
    () => documents.map((doc) => `${doc.id}:${doc.status}:${doc.materialType}`).join('|'),
    [documents],
  )
  const { overview, loading, reload } = useSyllabusOverview(projectId, version)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{
    title: string
    description: string
    run: () => Promise<void>
  } | null>(null)

  const [prompt, setPrompt] = useState<PromptRequest | null>(null)
  const service = useMemo(() => new SyllabusService(), [])
  // AI extraction is one request (停止); AI matching runs in batches (暂停 / 继续).
  const extractRun = useGenerationRun({ abortOnUnmount: true })
  const matchRun = useGenerationRun()
  const [matchTarget, setMatchTarget] = useState<{
    key: string
    done: number
    total: number
  } | null>(null)

  const scopes: ScopeRef[] = useMemo(
    () =>
      (overview?.syllabi ?? []).flatMap(({ document, data }) =>
        (data?.scopes ?? []).map((scope) => ({
          key: `${document.id}::${scope.id}`,
          document,
          scope,
        })),
      ),
    [overview],
  )
  const selected = scopes.find((item) => item.key === selectedKey) ?? scopes[0] ?? null

  async function run(label: string, task: () => Promise<void>) {
    setBusy(label)
    try {
      await task()
      await reload()
    } catch (err) {
      toast({
        variant: 'error',
        title: t('syllabus.actionFailed'),
        description: friendlyAIError(err),
      })
    } finally {
      setBusy(null)
    }
  }

  async function withAi<T>(
    task: (ai: NonNullable<Awaited<ReturnType<typeof buildAIServices>>>['ai']) => Promise<T>,
  ) {
    const bundle = await buildAIServices()
    if (!bundle) {
      toast({
        variant: 'error',
        title: t('quiz.noProvider'),
        description: t('quiz.noProviderHint'),
      })
      return undefined
    }
    return task(bundle.ai)
  }

  const extractLocally = (document: Document) => {
    const go = () =>
      run(`extract:${document.id}`, async () => {
        const data = await service.extractLocally(document.id)
        toast({
          variant: 'success',
          title: t('syllabus.extracted', { count: countExamTopics(data) }),
        })
      })
    if (document.syllabus?.editedAt) {
      setConfirm({
        title: t('syllabus.reextractTitle'),
        description: t('syllabus.reextractBody'),
        run: go,
      })
    } else void go()
  }

  const extractWithAi = (document: Document) =>
    run(`ai:${document.id}`, async () => {
      const control = extractRun.start()
      try {
        const result = await withAi((ai) => service.extractWithAi(document.id, ai, { control }))
        extractRun.reset()
        if (!result) return
        toast({
          variant: 'success',
          title: t('syllabus.extracted', { count: countExamTopics(result.data) }),
          ...(result.dropped > 0
            ? { description: t('syllabus.aiDropped', { count: result.dropped }) }
            : {}),
        })
      } catch (err) {
        // Stopped: the earlier list stays as it was.
        if (!isGenerationInterruption(err, control)) throw err
      } finally {
        control.finish()
      }
    })

  /** Match a scope's exam topics; `resume` continues a paused run with the rest. */
  const matchWithAi = (document: Document, scopeId: string, resume = false) =>
    run(`match:${document.id}`, async () => {
      const control = matchRun.start()
      setMatchTarget({ key: `${document.id}::${scopeId}`, done: 0, total: 0 })
      try {
        const result = await withAi((ai) =>
          service.matchWithAiRun(document.id, ai, { scopeId, control, resume }),
        )
        if (!result) {
          matchRun.reset()
          return
        }
        setMatchTarget({
          key: `${document.id}::${scopeId}`,
          done: result.done,
          total: result.total,
        })
        if (result.paused) return
        matchRun.reset()
        toast({ variant: 'success', title: t('syllabus.aiMatched', { count: result.matched }) })
      } finally {
        control.finish()
      }
    })

  const markAsSyllabus = (document: Document) =>
    setConfirm({
      title: t('syllabus.markTitle', { name: document.name }),
      description: t('syllabus.markBody'),
      run: () =>
        run(`mark:${document.id}`, async () => {
          const data = await service.markAsSyllabus(document.id, projectId)
          await refresh()
          toast({
            variant: 'success',
            title: t('syllabus.marked'),
            description: t('syllabus.extracted', { count: countExamTopics(data) }),
          })
        }),
    })

  if (loading && !overview) return <LoadingState label={t('syllabus.loading')} />

  const syllabi = overview?.syllabi ?? []
  const uploadButton = (
    <Button variant="outline" size="sm" onClick={() => setUploadOpen(true)}>
      <Upload className="h-4 w-4" />
      {t('syllabus.upload')}
    </Button>
  )

  return (
    <div className="space-y-6">
      <SectionHeading
        title={t('syllabus.title')}
        description={t('syllabus.description')}
        action={uploadButton}
      />

      {syllabi.length > 0 && overview && !overview.hasKnowledgeSource && (
        <div
          role="note"
          className="flex gap-3 rounded-lg border border-amber-500/40 bg-amber-50/50 p-3 text-sm lab:rounded-none dark:bg-amber-950/20"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-400" />
          <div className="space-y-1">
            <p className="font-medium">{t('syllabus.noContentTitle')}</p>
            <p className="text-muted-foreground">{t('syllabus.noContentBody')}</p>
            <Button asChild variant="link" size="sm" className="h-auto px-0">
              <Link to={`/projects/${projectId}`}>{t('syllabus.noContentAction')}</Link>
            </Button>
          </div>
        </div>
      )}

      {(overview?.suggestions.length ?? 0) > 0 && (
        <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3 text-sm lab:rounded-none">
          <p className="flex items-center gap-2 font-medium">
            <FileSearch className="h-4 w-4 shrink-0 text-muted-foreground" />
            {t('syllabus.suggestTitle')}
          </p>
          <ul className="space-y-1">
            {overview!.suggestions.map((document) => (
              <li key={document.id} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate" title={document.name}>
                  {document.name}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy !== null}
                  onClick={() => markAsSyllabus(document)}
                >
                  {t('syllabus.markAction')}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {syllabi.length === 0 ? (
        <div className="space-y-2 border-t-[1.5px] border-foreground pt-4 text-sm lab:border lab:border-border lab:p-4">
          <p className="font-medium">{t('syllabus.emptyTitle')}</p>
          <p className="text-muted-foreground">{t('syllabus.emptyBody')}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {syllabi.map(({ document, data }) => {
            const count = countExamTopics(data)
            return (
              <div
                key={document.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm lab:border lab:border-border lab:px-3 lab:py-2"
              >
                <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 max-w-full truncate font-medium" title={document.name}>
                  {document.name}
                </span>
                <span className="data-num text-xs text-muted-foreground lab:font-mono">
                  {t('syllabus.topicCount', { count })}
                  {data
                    ? ` · ${t(data.method === 'ai' ? 'syllabus.methodAi' : 'syllabus.methodLocal')}`
                    : ''}
                </span>
                <span className="ml-auto flex flex-wrap gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() => extractLocally(document)}
                  >
                    {busy === `extract:${document.id}` ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                    {t('syllabus.reextract')}
                  </Button>
                  {count < MIN_LOCAL_TOPICS && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy !== null}
                      onClick={() => void extractWithAi(document)}
                      title={t('syllabus.aiExtractHint')}
                    >
                      {busy === `ai:${document.id}` ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Sparkles className="h-4 w-4" />
                      )}
                      {t('syllabus.aiExtract')}
                    </Button>
                  )}
                  {busy === `ai:${document.id}` && (
                    <GenerationControls
                      kind="single"
                      state={extractRun.state}
                      onStopNow={extractRun.stopNow}
                      hideStatus
                    />
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy !== null}
                    onClick={() =>
                      setPrompt({
                        title: t('syllabus.addScopePrompt'),
                        submit: (label) =>
                          void run('scope', async () => {
                            await service.addScope(document.id, label)
                          }),
                      })
                    }
                  >
                    <Plus className="h-4 w-4" />
                    {t('syllabus.addScope')}
                  </Button>
                </span>
                {count === 0 && (
                  <p className="w-full text-xs text-muted-foreground">{t('syllabus.noneFound')}</p>
                )}
              </div>
            )
          })}

          {scopes.length > 1 && (
            <div
              role="tablist"
              aria-label={t('syllabus.scopes')}
              className="flex flex-wrap gap-2 lab:gap-0"
            >
              {scopes.map((item) => {
                const active = item.key === selected?.key
                return (
                  <button
                    key={item.key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setSelectedKey(item.key)}
                    className={cn(
                      'focus-ring max-w-full truncate rounded-full border px-3 py-1 text-xs transition-colors',
                      'lab:-ml-px lab:rounded-none lab:font-mono',
                      active
                        ? 'border-foreground/40 bg-accent text-foreground'
                        : 'text-muted-foreground hover:bg-accent/50',
                    )}
                  >
                    {item.scope.label || t('syllabus.scopeUntitled')}
                    <span className="data-num ml-1.5">{item.scope.topics.length}</span>
                  </button>
                )
              })}
            </div>
          )}

          {selected && (
            <ScopeView
              key={selected.key}
              projectId={projectId}
              entry={selected}
              coverage={overview!.coverage}
              busy={busy}
              onRun={run}
              onConfirm={setConfirm}
              onPrompt={setPrompt}
              onAiMatch={() => void matchWithAi(selected.document, selected.scope.id)}
              matchControls={
                matchTarget?.key === selected.key ? (
                  <GenerationControls
                    kind="parts"
                    state={matchRun.state}
                    done={matchTarget.done}
                    total={matchTarget.total}
                    stopRequested={matchRun.run?.stopRequested ?? false}
                    onPause={matchRun.requestPause}
                    onStopNow={matchRun.stopNow}
                    {...(busy === null
                      ? {
                          onResume: () =>
                            void matchWithAi(selected.document, selected.scope.id, true),
                        }
                      : {})}
                  />
                ) : null
              }
              canAiMatch={(overview?.topics.length ?? 0) > 0}
              service={service}
            />
          )}
        </div>
      )}

      <DocumentUploadDialog
        projectId={projectId}
        open={uploadOpen}
        onOpenChange={(open) => {
          setUploadOpen(open)
          if (!open) void reload()
        }}
        materialType="syllabus"
      />
      <TextPromptDialog
        open={prompt !== null}
        title={prompt?.title ?? ''}
        initial={prompt?.initial ?? ''}
        onOpenChange={(open) => {
          if (!open) setPrompt(null)
        }}
        onSubmit={(value) => prompt?.submit(value)}
      />
      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(open) => {
          if (!open) setConfirm(null)
        }}
        title={confirm?.title ?? ''}
        description={confirm?.description ?? ''}
        onConfirm={async () => {
          const task = confirm
          setConfirm(null)
          if (task) await task.run()
        }}
      />
    </div>
  )
}

function ScopeView({
  projectId,
  entry,
  coverage,
  busy,
  onRun,
  onConfirm,
  onPrompt,
  onAiMatch,
  matchControls,
  canAiMatch,
  service,
}: {
  projectId: string
  entry: ScopeRef
  coverage: Map<string, ExamTopicCoverage>
  busy: string | null
  onRun: (label: string, task: () => Promise<void>) => Promise<void>
  onConfirm: (value: { title: string; description: string; run: () => Promise<void> }) => void
  onPrompt: (value: PromptRequest) => void
  onAiMatch: () => void
  /** Pause / continue for a running or paused AI match of this scope. */
  matchControls?: ReactNode
  canAiMatch: boolean
  service: SyllabusService
}): JSX.Element {
  const { t } = useTranslation()
  const { document, scope } = entry
  const [merging, setMerging] = useState<string[] | null>(null)
  const [draft, setDraft] = useState('')
  const covered = scope.topics.filter((item) => coverage.get(item.id)?.covered).length
  const quizHref = (examTopicId?: string, oral = false) =>
    `/projects/${projectId}/quiz?${new URLSearchParams({
      examDoc: document.id,
      examScope: scope.id,
      ...(examTopicId ? { examTopic: examTopicId } : {}),
      // Oral-exam rehearsal preselected in the quiz setup.
      ...(oral ? { oral: '1' } : {}),
    }).toString()}`

  // Group labels are shown once, above the first topic of each group.
  const rows: Array<{ group?: string; item: ExamTopic; index: number }> = scope.topics.map(
    (item, index) => ({
      ...(item.group && item.group !== scope.topics[index - 1]?.group ? { group: item.group } : {}),
      item,
      index,
    }),
  )

  return (
    <section aria-labelledby={`scope-${scope.id}`} className="space-y-3">
      <header className="flex flex-wrap items-end gap-x-3 gap-y-2 border-b-[1.5px] border-foreground pb-2 lab:border lab:border-border lab:bg-card lab:px-3 lab:py-2">
        <div className="min-w-0 flex-1">
          <h3
            id={`scope-${scope.id}`}
            className="break-words font-heading text-base font-semibold lecture:text-[19px] lecture:font-bold lab:text-[14px]"
          >
            {scope.label || t('syllabus.scopeUntitled')}
          </h3>
          <p className="data-num text-xs text-muted-foreground lab:font-mono">
            {t(KIND_LABEL_KEYS[scope.kind])} ·{' '}
            {t('syllabus.coveredCount', { covered, total: scope.topics.length })}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild size="sm">
            <Link to={quizHref()}>
              <ListChecks className="h-4 w-4" />
              {t('syllabus.quizScope')}
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to={quizHref(undefined, true)}>
              <Mic className="h-4 w-4" />
              {t('syllabus.oralScope')}
            </Link>
          </Button>
          {canAiMatch && (
            <Button
              variant="outline"
              size="sm"
              disabled={busy !== null}
              onClick={onAiMatch}
              title={t('syllabus.aiMatchHint')}
            >
              {busy === `match:${document.id}` ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Link2 className="h-4 w-4" />
              )}
              {t('syllabus.aiMatch')}
            </Button>
          )}
          {matchControls}
          <Button
            variant="ghost"
            size="sm"
            disabled={busy !== null}
            onClick={() =>
              onPrompt({
                title: t('syllabus.renamePrompt'),
                initial: scope.label,
                submit: (label) =>
                  void onRun('rename', async () => {
                    await service.renameScope(document.id, scope.id, label)
                  }),
              })
            }
          >
            <Pencil className="h-4 w-4" />
            {t('syllabus.rename')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy !== null || scope.topics.length < 2}
            onClick={() => setMerging(merging ? null : [])}
            aria-pressed={merging !== null}
          >
            <Combine className="h-4 w-4" />
            {merging ? t('common.cancel') : t('syllabus.merge')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy !== null}
            onClick={() =>
              onConfirm({
                title: t('syllabus.deleteScopeTitle'),
                description: t('syllabus.deleteScopeBody', { label: scope.label }),
                run: () =>
                  onRun('delete-scope', async () => {
                    await service.deleteScope(document.id, scope.id)
                  }),
              })
            }
          >
            <Trash2 className="h-4 w-4" />
            <span className="sr-only">{t('syllabus.deleteScope')}</span>
          </Button>
        </div>
      </header>

      {merging && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">
            {t('syllabus.mergeHint', { count: merging.length })}
          </span>
          <Button
            size="sm"
            disabled={merging.length < 2 || busy !== null}
            onClick={() =>
              void onRun('merge', async () => {
                await service.mergeTopics(document.id, scope.id, merging)
                setMerging(null)
              })
            }
          >
            {t('syllabus.mergeSelected')}
          </Button>
        </div>
      )}

      {scope.topics.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('syllabus.scopeEmpty')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            {/* Visible in both styles: the numbers in a row need their column names. */}
            <thead>
              <tr className="text-xs text-muted-foreground lecture:border-b-[1.5px] lecture:border-foreground/70 lab:border lab:border-border lab:bg-muted/40 lab:font-mono lab:text-[11px] lab:uppercase lab:tracking-[0.06em]">
                <th scope="col" className="w-10 px-2 py-1.5 text-left font-medium">
                  #
                </th>
                <th scope="col" className="px-2 py-1.5 text-left font-medium">
                  {t('syllabus.col.topic')}
                </th>
                <th scope="col" className="px-2 py-1.5 text-left font-medium">
                  {t('syllabus.col.coverage')}
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">
                  {t('syllabus.col.practice')}
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">
                  {t('syllabus.col.mastery')}
                </th>
                <th scope="col" className="px-2 py-1.5 text-right font-medium">
                  {t('syllabus.col.actions')}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ group, item, index }) => {
                const info = coverage.get(item.id)
                const first = info?.topics[0]
                const checked = merging?.includes(item.id) ?? false
                return (
                  <Fragment key={item.id}>
                    {group && (
                      <tr>
                        <th
                          scope="colgroup"
                          colSpan={6}
                          className="px-2 pb-1 pt-4 text-left text-xs font-semibold text-muted-foreground lecture:font-heading lecture:text-[15px] lecture:text-foreground lab:border lab:border-border lab:bg-muted/20 lab:py-1.5 lab:font-mono lab:text-[11px]"
                        >
                          {group}
                        </th>
                      </tr>
                    )}
                    <tr className="border-b border-border/70 align-top lab:border lab:border-border">
                      <td className="data-num w-10 px-2 py-2.5 text-muted-foreground lab:font-mono lab:text-xs">
                        {merging ? (
                          <input
                            type="checkbox"
                            className="focus-ring h-4 w-4 accent-primary"
                            aria-label={t('syllabus.selectForMerge', { text: item.text })}
                            checked={checked}
                            onChange={(event) =>
                              setMerging((prev) =>
                                prev
                                  ? event.target.checked
                                    ? [...prev, item.id]
                                    : prev.filter((id) => id !== item.id)
                                  : prev,
                              )
                            }
                          />
                        ) : (
                          String(index + 1).padStart(2, '0')
                        )}
                      </td>
                      <td className="min-w-[14rem] px-2 py-2.5">
                        <span className="break-words leading-relaxed lecture:text-[15px]">
                          {item.text}
                        </span>
                        <span className="data-num mt-0.5 block text-[11px] text-muted-foreground lab:font-mono">
                          {item.source === 'manual'
                            ? t('syllabus.sourceManual')
                            : item.page !== undefined
                              ? t('syllabus.sourcePage', { page: item.page })
                              : t('syllabus.sourceDocument')}
                        </span>
                      </td>
                      <td className="min-w-[10rem] px-2 py-2.5">
                        {info?.covered ? (
                          <ul className="space-y-0.5">
                            {info.topics.map((topic) => (
                              <li key={topic.id}>
                                <Link
                                  to={`/projects/${projectId}/tutor/${topic.id}`}
                                  className="focus-ring break-words text-primary underline-offset-2 hover:underline"
                                >
                                  {topic.name}
                                </Link>
                              </li>
                            ))}
                            <li className="text-[11px] text-muted-foreground">
                              {item.matchedBy === 'ai'
                                ? t('syllabus.matchedAi')
                                : t('syllabus.matchedLocal')}
                            </li>
                          </ul>
                        ) : (
                          <span className="text-amber-700 dark:text-amber-400">
                            {t('syllabus.notInMaterial')}
                          </span>
                        )}
                      </td>
                      <td className="data-num px-2 py-2.5 text-right tabular-nums lab:font-mono">
                        {info?.practiceCount ? info.practiceCount : '—'}
                      </td>
                      <td
                        className="data-num px-2 py-2.5 text-right tabular-nums lab:font-mono"
                        title={t('syllabus.masteryHint')}
                      >
                        {info?.mastery !== null && info?.mastery !== undefined
                          ? formatPercent(info.mastery)
                          : '—'}
                      </td>
                      <td className="px-2 py-2.5">
                        <div className="flex justify-end gap-1">
                          {first ? (
                            <Button asChild variant="ghost" size="sm">
                              <Link to={`/projects/${projectId}/tutor/${first.id}`}>
                                {t('syllabus.study')}
                              </Link>
                            </Button>
                          ) : (
                            <Button variant="ghost" size="sm" disabled>
                              {t('syllabus.study')}
                            </Button>
                          )}
                          <Button asChild variant="ghost" size="sm">
                            <Link to={quizHref(item.id)}>{t('syllabus.quizTopic')}</Link>
                          </Button>
                          <Button asChild variant="ghost" size="sm">
                            <Link
                              to={quizHref(item.id, true)}
                              aria-label={t('syllabus.oralTopicLabel', { text: item.text })}
                            >
                              {t('syllabus.oralTopic')}
                            </Link>
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            disabled={busy !== null}
                            aria-label={t('syllabus.deleteTopic', { text: item.text })}
                            onClick={() =>
                              void onRun('delete-topic', async () => {
                                await service.deleteTopic(document.id, scope.id, item.id)
                              })
                            }
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          const text = draft.trim()
          if (!text) return
          void onRun('add-topic', async () => {
            await service.addTopic(document.id, scope.id, text)
            setDraft('')
          })
        }}
      >
        <Input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={t('syllabus.addTopicPlaceholder')}
          aria-label={t('syllabus.addTopic')}
          className="min-w-0 flex-1"
        />
        <Button type="submit" variant="outline" size="sm" disabled={!draft.trim() || busy !== null}>
          <Plus className="h-4 w-4" />
          {t('syllabus.addTopic')}
        </Button>
      </form>
    </section>
  )
}
