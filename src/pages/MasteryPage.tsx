import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Brain, TrendingDown, TrendingUp } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { Badge } from '@/shared/ui/Badge'
import { EmptyState } from '@/shared/ui/EmptyState'
import { LoadingState } from '@/shared/ui/LoadingState'
import { Progress } from '@/shared/ui/Progress'
import { PageContainer, PageContent, PageHeader } from '@/shared/ui/Page'
import { MasteryService } from '@/services/masteryService'
import type { KnowledgeMastery } from '@/entities/knowledgeMastery/types'
import { cn, relativeTime } from '@/shared/lib/utils'

function toneFor(mastery: number): { label: string; className: string } {
  if (mastery >= 0.8) return { label: 'Strong', className: 'text-emerald-600' }
  if (mastery >= 0.6) return { label: 'Solid', className: 'text-foreground' }
  if (mastery >= 0.4) return { label: 'Developing', className: 'text-amber-600' }
  return { label: 'Needs work', className: 'text-destructive' }
}

export function MasteryPage(): JSX.Element {
  const { id: projectId } = useParams<{ id: string }>()
  const [rows, setRows] = useState<KnowledgeMastery[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!projectId) return
    let cancelled = false
    void (async () => {
      try {
        const service = new MasteryService()
        const data = await service.listByProject(projectId)
        if (!cancelled) setRows(data.sort((a, b) => a.mastery - b.mastery))
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId])

  if (!projectId) return <div />

  const practiced = rows.filter((r) => r.attempts > 0)
  const average =
    practiced.length > 0 ? practiced.reduce((acc, r) => acc + r.mastery, 0) / practiced.length : 0

  return (
    <PageContainer>
      <PageHeader
        title={
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="icon" aria-label="Back to project">
              <Link to={`/projects/${projectId}`}>
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <Brain className="h-4 w-4" />
            Knowledge Mastery
          </div>
        }
        description="An estimate derived from your practice history — not a measurement of true ability."
        actions={
          <Button variant="outline" asChild>
            <Link to={`/projects/${projectId}/quiz`}>Take a quiz</Link>
          </Button>
        }
      />
      <PageContent className="space-y-6">
        {loading ? (
          <LoadingState label="Loading mastery" />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Brain className="h-10 w-10" />}
            title="No mastery data yet"
            description="Complete a quiz and the system will start estimating your knowledge-point mastery."
            action={
              <Button asChild>
                <Link to={`/projects/${projectId}/quiz`}>Generate a quiz</Link>
              </Button>
            }
          />
        ) : (
          <>
            <Card>
              <CardContent className="grid gap-6 p-6 sm:grid-cols-3">
                <div>
                  <div className="text-3xl font-semibold tabular-nums">{Math.round(average * 100)}%</div>
                  <div className="text-xs text-muted-foreground">Average mastery estimate</div>
                </div>
                <div>
                  <div className="text-3xl font-semibold tabular-nums">{practiced.length}</div>
                  <div className="text-xs text-muted-foreground">Knowledge points practised</div>
                </div>
                <div>
                  <div className="flex items-center gap-2 text-sm">
                    <TrendingDown className="h-4 w-4 text-destructive" />
                    <span>{practiced.filter((r) => r.mastery < 0.6).length} below 60%</span>
                  </div>
                  <div className="mt-1 flex items-center gap-2 text-sm">
                    <TrendingUp className="h-4 w-4 text-emerald-600" />
                    <span>{practiced.filter((r) => r.mastery >= 0.8).length} above 80%</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Knowledge points</CardTitle>
                <CardDescription>Weakest first — focus your study time here.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {rows.map((row) => {
                  const tone = toneFor(row.mastery)
                  const pct = Math.round(row.mastery * 100)
                  return (
                    <div key={row.id} className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2 text-sm">
                        <span className="font-medium">{row.knowledgePoint}</span>
                        <span className={cn('text-xs', tone.className)}>{tone.label}</span>
                        <span className="ml-auto tabular-nums text-muted-foreground">{pct}%</span>
                      </div>
                      <Progress value={pct} className="h-1.5" />
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <Badge variant="outline">
                          {row.correct}/{row.attempts} correct
                        </Badge>
                        {row.attempts === 0 && <span>No graded attempts yet</span>}
                        <span className="ml-auto">Updated {relativeTime(row.lastUpdated)}</span>
                      </div>
                    </div>
                  )
                })}
              </CardContent>
            </Card>

            <p className="text-xs text-muted-foreground">
              Mastery is computed from weighted practice history: recent answers and harder questions count more.
              Treat it as a rough signal, not an absolute measure.
            </p>
          </>
        )}
      </PageContent>
    </PageContainer>
  )
}