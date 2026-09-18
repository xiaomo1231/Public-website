import { useEffect, useState } from 'react'
import { BookOpenCheck, ChevronRight } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { Badge } from '@/shared/ui/Badge'
import { LoadingState } from '@/shared/ui/LoadingState'
import { Progress } from '@/shared/ui/Progress'
import { WeaknessService, type WeaknessReport } from '@/services/weaknessService'
import { useTranslation } from '@/i18n'

export interface WeaknessPanelProps {
  projectId: string
  onReview?: () => void
  /** Compact mode is used on the dashboard. */
  compact?: boolean
}

/**
 * "Areas that may need review" — deliberately non-judgemental wording.
 */
export function WeaknessPanel({ projectId, onReview, compact }: WeaknessPanelProps): JSX.Element {
  const { t } = useTranslation()
  const [report, setReport] = useState<WeaknessReport | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const data = await new WeaknessService().analyze(projectId, { limit: compact ? 4 : 8 })
        if (!cancelled) setReport(data)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, compact])

  if (loading) return <LoadingState label={t('weakness.checking')} inline />

  if (!report || report.areas.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <BookOpenCheck className="h-4 w-4" />
            {t('weakness.title')}
          </CardTitle>
          <CardDescription>{t('weakness.none')}</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between space-y-0">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <BookOpenCheck className="h-4 w-4" />
            {t('weakness.title')}
          </CardTitle>
          <CardDescription>
            {t('weakness.summary', { count: report.totalMistakes })}
          </CardDescription>
        </div>
        {onReview && (
          <Button variant="outline" size="sm" onClick={onReview}>
            {t('weakness.reviewNow')}
            <ChevronRight className="h-4 w-4" />
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        {report.areas.map((area) => (
          <div key={area.knowledgePoint} className="space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-medium">{area.knowledgePoint}</span>
              <Badge variant="outline">
                {t('weakness.count', { count: area.mistakeCount })}
              </Badge>
              {area.mastery !== null && (
                <Badge variant="secondary">
                  {t('weakness.mastery', { value: `${Math.round(area.mastery * 100)}%` })}
                </Badge>
              )}
              <span className="ml-auto tabular-nums text-xs text-muted-foreground">
                {Math.round(area.weaknessScore * 100)}%
              </span>
            </div>
            <Progress value={area.weaknessScore * 100} className="h-1.5" />
            <p className="text-xs text-muted-foreground">{area.reason}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}