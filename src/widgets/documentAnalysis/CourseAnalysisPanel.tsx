import { useEffect, useMemo, useState } from 'react'
import { Brain, Loader2, RotateCcw, Sparkles, Sigma, Tag, FileText } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { Badge } from '@/shared/ui/Badge'
import { EmptyState } from '@/shared/ui/EmptyState'
import { LoadingState } from '@/shared/ui/LoadingState'
import { Progress } from '@/shared/ui/Progress'
import { TruncatedText } from '@/shared/ui/TruncatedText'
import { toast } from '@/features/toast/toastStore'
import { CourseContentService } from '@/services/courseContentService'
import type { CourseAnalysis, Formula, Topic, CourseSymbol } from '@/entities/courseAnalysis/types'
import { CourseContentRepository } from '@/entities/courseContent/repository'
import type { CourseContentFreshness } from '@/entities/courseContent/types'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { cn } from '@/shared/lib/utils'
import { useUiStyle } from '@/features/theme/useAppearance'
import { LAB_TABLE_HEAD_CLASS } from '@/widgets/dashboard/Figures'
import { useTranslation } from '@/i18n'

export interface CourseAnalysisPanelProps {
  projectId: string
  onStartTutor?: (topicId: string) => void
}

/**
 * One readable source line: the primary document with its page, plus a count of
 * any further citations rather than a comma-joined wall of file names.
 */
function describeSources(refs: Topic['sourceRefs']): string {
  const primary = refs[0]
  if (!primary) return ''
  const label = `${primary.documentName}${primary.page !== undefined ? ` p${primary.page}` : ''}`
  return refs.length > 1 ? `${label} +${refs.length - 1}` : label
}

export function CourseAnalysisPanel({
  projectId,
  onStartTutor,
}: CourseAnalysisPanelProps): JSX.Element {
  const { t } = useTranslation()
  const lab = useUiStyle().uiStyle === 'lab'
  const content = useMemo(() => new CourseContentRepository(), [])
  const [analysis, setAnalysis] = useState<CourseAnalysis | null>(null)
  const [topics, setTopics] = useState<Topic[]>([])
  const [formulas, setFormulas] = useState<Formula[]>([])
  const [symbols, setSymbols] = useState<CourseSymbol[]>([])
  const [freshness, setFreshness] = useState<CourseContentFreshness | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState<string | undefined>()

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const a = await content.getAnalysis(projectId)
        if (cancelled) return
        setAnalysis(a ?? null)
        const [ts, fs, ss, fr] = await Promise.all([
          content.getTopics(projectId),
          content.getFormulas(projectId),
          content.getSymbols(projectId),
          content.isFresh(projectId),
        ])
        if (cancelled) return
        setTopics(ts)
        setFormulas(fs)
        setSymbols(ss)
        setFreshness(fr)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, content])

  async function analyze() {
    setRunning(true)
    setProgress(0)
    setMessage(t('analysis.preparing'))
    try {
      // Through the content service: shares any run already in flight for this
      // project and commits practice-question relinks in the same transaction.
      const result = await new CourseContentService().ensureAnalyzed(projectId, {
        force: true,
        onProgress: (p) => {
          setProgress(p.progress)
          setMessage(p.message)
        },
      })
      if (result.reason === 'no-provider') {
        toast({
          variant: 'error',
          title: t('analysis.noProvider'),
          description: t('analysis.noProviderHint'),
        })
        return
      }
      if (result.reason === 'no-documents') {
        toast({
          variant: 'error',
          title: t('analysis.failed'),
          description: t('errors.noProcessedDocuments'),
        })
        return
      }
      if (result.reason === 'failed') {
        throw result.cause ?? new Error(result.error ?? t('errors.analysisFailed'))
      }
      const [a, ts, fs, ss, fr] = await Promise.all([
        content.getAnalysis(projectId),
        content.getTopics(projectId),
        content.getFormulas(projectId),
        content.getSymbols(projectId),
        content.isFresh(projectId),
      ])
      setAnalysis(a ?? null)
      setTopics(ts)
      setFormulas(fs)
      setSymbols(ss)
      setFreshness(fr)
      toast({
        variant: 'success',
        title: t('analysis.complete'),
        description: t('analysis.completeBody', {
          topics: ts.length,
          formulas: fs.length,
          symbols: ss.length,
        }),
      })
    } catch (err) {
      const msg = friendlyAIError(err)
      toast({ variant: 'error', title: t('analysis.failed'), description: msg })
    } finally {
      setRunning(false)
    }
  }

  if (loading) {
    return <LoadingState label={t('analysis.loading')} />
  }

  if (!analysis && topics.length === 0) {
    return (
      <EmptyState
        icon={<Brain className="h-10 w-10" />}
        title={t('analysis.empty')}
        description={t('analysis.emptyHint')}
        action={
          <Button onClick={analyze} disabled={running}>
            {running ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {running ? t('analysis.analyzing') : t('analysis.analyze')}
          </Button>
        }
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={analyze} disabled={running}>
          {running ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RotateCcw className="h-4 w-4" />
          )}
          {running ? t('analysis.analyzing') : t('analysis.reanalyze')}
        </Button>
        {analysis && (
          <Badge variant="outline">
            {analysis.language === 'mixed'
              ? t('language.bilingual')
              : analysis.language.toUpperCase()}
          </Badge>
        )}
        {analysis?.promptVersion && (
          <Badge variant="outline" title={analysis.promptVersion}>
            {/* Full provenance (with the subject profile) stays in the tooltip. */}
            {t('analysis.prompt', {
              version: analysis.promptVersion.split('+')[0] ?? analysis.promptVersion,
            })}
          </Badge>
        )}
        {analysis && !running && freshness?.fresh && (
          <Badge variant="outline">{t('analysis.saved')}</Badge>
        )}
      </div>

      {analysis &&
        !running &&
        freshness &&
        !freshness.fresh &&
        freshness.reasons.some((reason) => reason !== 'missing') && (
          <div className="space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-sm">
            <p className="font-medium">
              {freshness.reasons.every((reason) => reason === 'input-truncated')
                ? t('analysis.staleTruncated')
                : t('analysis.stale')}
            </p>
            <p className="text-muted-foreground">{t('analysis.staleHint')}</p>
          </div>
        )}
      {running && (
        <div className="space-y-1">
          <Progress value={progress} />
          <p className="text-xs text-muted-foreground">
            {message ?? t('analysis.working', { stage: `${progress}%` })}
          </p>
        </div>
      )}

      {analysis?.status === 'failed' && analysis.errorMessage && (
        <div className="space-y-1 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
          <p className="font-medium text-destructive">{t('analysis.failed')}</p>
          <p className="text-muted-foreground">
            {t('analysis.failedReason', { reason: analysis.errorMessage })}
          </p>
          <p className="text-xs text-muted-foreground">{t('analysis.failedHint')}</p>
        </div>
      )}

      {topics.length > 0 && (
        <section aria-labelledby="analysis-topics" className="min-w-0">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h3
              id="analysis-topics"
              className="flex items-center gap-2 font-heading text-base font-semibold text-foreground lecture:text-[21px] lecture:font-bold lab:font-mono lab:text-[11px] lab:font-medium lab:uppercase lab:tracking-[0.06em] lab:text-muted-foreground"
            >
              <Tag className="h-4 w-4 lecture:hidden lab:h-3.5 lab:w-3.5" aria-hidden />
              {lab ? t('analysis.topics') : t('analysis.toc.title')}
            </h3>
            <p className="data-num text-xs text-muted-foreground lab:font-mono">
              {t('analysis.topicsCount', { count: topics.length })}
            </p>
          </div>
          {lab ? (
            <TopicTable topics={topics} onStartTutor={onStartTutor} />
          ) : (
            <TopicContents topics={topics} onStartTutor={onStartTutor} />
          )}
        </section>
      )}

      {formulas.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sigma className="h-4 w-4" /> {t('analysis.formulas')}
            </CardTitle>
            <CardDescription>
              {t('analysis.formulasCount', { count: formulas.length })}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {formulas.slice(0, 10).map((f) => (
              <div key={f.id} className="min-w-0 rounded-lg border bg-muted/30 px-3 py-2">
                <div className="flex min-w-0 flex-wrap items-baseline gap-2">
                  <TruncatedText text={f.name} className="font-medium" />
                  <code className="max-w-full break-all rounded bg-background px-1 font-mono text-xs">
                    {f.latex}
                  </code>
                </div>
                <p className="break-words text-xs text-muted-foreground">{f.description}</p>
                {f.variables.length > 0 && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {t('analysis.variables', {
                      variables: f.variables.map((v) => `${v.symbol} = ${v.meaning}`).join(', '),
                    })}
                  </p>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {symbols.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4" /> {t('analysis.symbols')}
            </CardTitle>
            <CardDescription>
              {t('analysis.symbolsCount', { count: symbols.length })}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {symbols.slice(0, 18).map((s) => (
              <div key={s.id} className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                <div className="flex items-baseline gap-2">
                  <code className="rounded bg-background px-1 font-mono text-sm">{s.symbol}</code>
                  {s.unit && <span className="text-xs text-muted-foreground">[{s.unit}]</span>}
                </div>
                <p className="text-xs">{s.meaning}</p>
                <p className="text-[11px] text-muted-foreground">{s.context}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  )
}
interface ChapterGroup {
  key: string
  label: string | null
  topics: Array<{ topic: Topic; index: number }>
}

/** Consecutive topics of the same chapter, in analysis order. */
function groupByChapter(topics: Topic[], otherLabel: string): ChapterGroup[] {
  const anyChapter = topics.some((topic) => topic.chapterId || topic.chapterTitle)
  const groups: ChapterGroup[] = []
  topics.forEach((topic, index) => {
    const key = topic.chapterId ?? topic.chapterTitle ?? ''
    const last = groups[groups.length - 1]
    if (last && last.key === key) {
      last.topics.push({ topic, index })
      return
    }
    const title = [topic.chapterNumber, topic.chapterTitle].filter(Boolean).join('  ')
    groups.push({
      key,
      label: anyChapter ? title || otherLabel : null,
      topics: [{ topic, index }],
    })
  })
  return groups
}

function topicNumber(topic: Topic, index: number): string {
  return topic.sectionNumber ?? String(index + 1).padStart(2, '0')
}

/** Lecture: a table of contents — chapters in the serif, topics as ruled rows. */
function TopicContents({
  topics,
  onStartTutor,
}: {
  topics: Topic[]
  onStartTutor?: (topicId: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  const groups = groupByChapter(topics, t('analysis.toc.other'))
  return (
    <div className="border-t border-border">
      {groups.map((group, groupIndex) => (
        <div key={`${group.key}:${groupIndex}`}>
          {group.label && (
            <p className="pb-1.5 pt-4 font-heading text-[16px] font-bold text-foreground">
              {group.label}
            </p>
          )}
          <ul>
            {group.topics.map(({ topic, index }) => (
              <li key={topic.id} className="border-b border-border">
                <button
                  type="button"
                  onClick={() => onStartTutor?.(topic.id)}
                  className="focus-ring group grid w-full min-w-0 grid-cols-[3rem_minmax(0,1fr)] gap-x-2 rounded-sm py-2.5 text-left"
                >
                  <span className="data-num pt-px text-sm text-muted-foreground transition-colors duration-150 group-hover:text-primary">
                    {topicNumber(topic, index)}
                  </span>
                  <span className="min-w-0">
                    <TruncatedText
                      text={topic.name}
                      className="text-[15px] text-foreground transition-colors duration-150 group-hover:text-primary"
                    />
                    {topic.description && (
                      <span className="line-clamp-1 break-words text-xs text-muted-foreground">
                        {topic.description}
                      </span>
                    )}
                    {topic.sourceRefs.length > 0 && (
                      <TruncatedText
                        text={t('analysis.source', { source: describeSources(topic.sourceRefs) })}
                        className="text-xs text-muted-foreground/80"
                      />
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

/** Lab: a hairline table — mono numbers, topic, primary source. */
function TopicTable({
  topics,
  onStartTutor,
}: {
  topics: Topic[]
  onStartTutor?: (topicId: string) => void
}): JSX.Element {
  const { t } = useTranslation()
  const head = 'px-3 py-2 text-left font-medium'
  const cell = 'border-t border-border px-3 py-2 align-top'
  return (
    <div className="overflow-x-auto border border-border bg-card">
      <table className="data-num w-full min-w-[520px] border-collapse text-[13px]">
        <thead className={LAB_TABLE_HEAD_CLASS}>
          <tr>
            <th scope="col" className={cn(head, 'w-14')}>
              #
            </th>
            <th scope="col" className={head}>
              {t('analysis.col.topic')}
            </th>
            <th scope="col" className={cn(head, 'hidden w-56 md:table-cell')}>
              {t('analysis.col.source')}
            </th>
          </tr>
        </thead>
        <tbody>
          {topics.map((topic, index) => (
            <tr key={topic.id} className="transition-colors duration-150 hover:bg-accent/50">
              <td className={cn(cell, 'font-mono text-muted-foreground')}>
                {topicNumber(topic, index)}
              </td>
              <td className={cell}>
                <button
                  type="button"
                  onClick={() => onStartTutor?.(topic.id)}
                  className="focus-ring block w-full min-w-0 rounded-sm text-left"
                >
                  <TruncatedText
                    text={topic.name}
                    className="font-medium text-foreground transition-colors duration-150 hover:text-primary"
                  />
                  {topic.description && (
                    <span className="line-clamp-1 break-words text-xs text-muted-foreground">
                      {topic.description}
                    </span>
                  )}
                </button>
              </td>
              <td
                className={cn(cell, 'hidden font-mono text-xs text-muted-foreground md:table-cell')}
              >
                {topic.sourceRefs.length > 0 ? (
                  <TruncatedText text={describeSources(topic.sourceRefs)} />
                ) : (
                  '—'
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
