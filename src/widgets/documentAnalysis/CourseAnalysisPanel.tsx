import { useEffect, useMemo, useState } from 'react'
import { Brain, Loader2, RotateCcw, Sparkles, Sigma, Tag, FileText } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { Badge } from '@/shared/ui/Badge'
import { EmptyState } from '@/shared/ui/EmptyState'
import { LoadingState } from '@/shared/ui/LoadingState'
import { Progress } from '@/shared/ui/Progress'
import { toast } from '@/features/toast/toastStore'
import { buildAIServices } from '@/services/aiServices'
import type { CourseAnalysis, Formula, Topic, CourseSymbol } from '@/entities/courseAnalysis/types'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { friendlyAIError } from '@/shared/lib/aiErrors'
import { useTranslation } from '@/i18n'

export interface CourseAnalysisPanelProps {
  projectId: string
  subject?: string
  onStartTutor?: (topicId: string) => void
}

export function CourseAnalysisPanel({
  projectId,
  subject,
  onStartTutor,
}: CourseAnalysisPanelProps): JSX.Element {
  const { t } = useTranslation()
  const repo = useMemo(() => new CourseAnalysisRepository(), [])
  const [analysis, setAnalysis] = useState<CourseAnalysis | null>(null)
  const [topics, setTopics] = useState<Topic[]>([])
  const [formulas, setFormulas] = useState<Formula[]>([])
  const [symbols, setSymbols] = useState<CourseSymbol[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [message, setMessage] = useState<string | undefined>()

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const a = await repo.getByProject(projectId)
        if (cancelled) return
        setAnalysis(a ?? null)
        const [ts, fs, ss] = await Promise.all([repo.listTopics(projectId), repo.listFormulas(projectId), repo.listSymbols(projectId)])
        if (cancelled) return
        setTopics(ts)
        setFormulas(fs)
        setSymbols(ss)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, repo])

  async function analyze() {
    setRunning(true)
    setProgress(0)
    setMessage(t('analysis.preparing'))
    try {
      const bundle = await buildAIServices()
      if (!bundle) {
        toast({
          variant: 'error',
          title: t('analysis.noProvider'),
          description: t('analysis.noProviderHint'),
        })
        setRunning(false)
        return
      }
      await bundle.documentAnalysis.analyzeProject(projectId, {
        subject,
        onProgress: (p) => {
          setProgress(p.progress)
          setMessage(p.message)
        },
      })
      const [a, ts, fs, ss] = await Promise.all([
        repo.getByProject(projectId),
        repo.listTopics(projectId),
        repo.listFormulas(projectId),
        repo.listSymbols(projectId),
      ])
      setAnalysis(a ?? null)
      setTopics(ts)
      setFormulas(fs)
      setSymbols(ss)
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
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
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
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
          {running ? t('analysis.analyzing') : t('analysis.reanalyze')}
        </Button>
        {analysis && (
          <Badge variant="outline">
            {analysis.language === 'mixed' ? t('language.bilingual') : analysis.language.toUpperCase()}
          </Badge>
        )}
        {analysis?.promptVersion && (
          <Badge variant="outline">{t('analysis.prompt', { version: analysis.promptVersion })}</Badge>
        )}
      </div>
      {running && (
        <div className="space-y-1">
          <Progress value={progress} />
          <p className="text-xs text-muted-foreground">
            {message ?? t('analysis.working', { stage: `${progress}%` })}
          </p>
        </div>
      )}

      {analysis?.status === 'failed' && analysis.errorMessage && (
        <div className="space-y-1 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm">
          <p className="font-medium text-destructive">{t('analysis.failed')}</p>
          <p className="text-muted-foreground">
            {t('analysis.failedReason', { reason: analysis.errorMessage })}
          </p>
          <p className="text-xs text-muted-foreground">{t('analysis.failedHint')}</p>
        </div>
      )}

      {topics.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Tag className="h-4 w-4" /> {t('analysis.topics')}
            </CardTitle>
            <CardDescription>
              {t('analysis.topicsCount', { count: topics.length })}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {topics.map((topic) => (
              <button
                key={topic.id}
                onClick={() => onStartTutor?.(topic.id)}
                className="flex flex-col gap-1 rounded-md border bg-card p-3 text-left transition-colors hover:bg-accent"
              >
                <span className="text-sm font-medium">{topic.name}</span>
                <span className="line-clamp-2 text-xs text-muted-foreground">{topic.description}</span>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  {t('analysis.source', {
                    source: topic.sourceRefs
                      .map((r) => r.documentName + (r.page ? ` p${r.page}` : ''))
                      .slice(0, 2)
                      .join(', '),
                  })}
                </span>
              </button>
            ))}
          </CardContent>
        </Card>
      )}

      {formulas.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sigma className="h-4 w-4" /> {t('analysis.formulas')}
            </CardTitle>
            <CardDescription>{t('analysis.formulasCount', { count: formulas.length })}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {formulas.slice(0, 10).map((f) => (
              <div key={f.id} className="rounded-md border bg-muted/30 px-3 py-2">
                <div className="flex items-baseline gap-2">
                  <span className="font-medium">{f.name}</span>
                  <code className="rounded bg-background px-1 font-mono text-xs">{f.latex}</code>
                </div>
                <p className="text-xs text-muted-foreground">{f.description}</p>
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
            <CardDescription>{t('analysis.symbolsCount', { count: symbols.length })}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {symbols.slice(0, 18).map((s) => (
              <div key={s.id} className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
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