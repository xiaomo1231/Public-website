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
    setMessage('Preparing…')
    try {
      const bundle = await buildAIServices()
      if (!bundle) {
        toast({ variant: 'error', title: 'Configure AI provider first', description: 'Open Settings → AI Settings to add your API key.' })
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
      toast({ variant: 'success', title: 'Analysis complete', description: `${ts.length} topics, ${fs.length} formulas, ${ss.length} symbols` })
    } catch (err) {
      const msg = friendlyAIError(err)
      toast({ variant: 'error', title: 'Analysis failed', description: msg })
    } finally {
      setRunning(false)
    }
  }

  if (loading) {
    return <LoadingState label="Loading analysis" />
  }

  if (!analysis && topics.length === 0) {
    return (
      <EmptyState
        icon={<Brain className="h-10 w-10" />}
        title="Course not analysed yet"
        description="Let the AI read your documents and extract topics, formulas, symbols, and prerequisites."
        action={
          <Button onClick={analyze} disabled={running}>
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {running ? 'Analysing…' : 'Analyze Course'}
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
          {running ? 'Analysing…' : 'Re-analyze'}
        </Button>
        {analysis && (
          <Badge variant="outline">
            {analysis.language === 'mixed' ? 'Bilingual' : analysis.language.toUpperCase()}
          </Badge>
        )}
        {analysis?.promptVersion && <Badge variant="outline">prompt {analysis.promptVersion}</Badge>}
      </div>
      {running && (
        <div className="space-y-1">
          <Progress value={progress} />
          <p className="text-xs text-muted-foreground">{message ?? `Working… ${progress}%`}</p>
        </div>
      )}

      {topics.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Tag className="h-4 w-4" /> Topics
            </CardTitle>
            <CardDescription>
              {topics.length} topic{topics.length === 1 ? '' : 's'} identified across your documents.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            {topics.map((t) => (
              <button
                key={t.id}
                onClick={() => onStartTutor?.(t.id)}
                className="flex flex-col gap-1 rounded-md border bg-card p-3 text-left transition-colors hover:bg-accent"
              >
                <span className="text-sm font-medium">{t.name}</span>
                <span className="line-clamp-2 text-xs text-muted-foreground">{t.description}</span>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  Source: {t.sourceRefs.map((r) => r.documentName + (r.page ? ` p${r.page}` : '')).slice(0, 2).join(', ')}
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
              <Sigma className="h-4 w-4" /> Formulas
            </CardTitle>
            <CardDescription>{formulas.length} formula{formulas.length === 1 ? '' : 's'} extracted.</CardDescription>
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
                    Variables: {f.variables.map((v) => `${v.symbol} = ${v.meaning}`).join(', ')}
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
              <FileText className="h-4 w-4" /> Symbols
            </CardTitle>
            <CardDescription>{symbols.length} symbol{symbols.length === 1 ? '' : 's'} recognised.</CardDescription>
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