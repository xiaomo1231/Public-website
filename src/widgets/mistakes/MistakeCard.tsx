import { useState } from 'react'
import {
  Archive,
  ArchiveRestore,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Sparkles,
  Trash2,
} from 'lucide-react'
import type { Mistake } from '@/entities/mistake/types'
import { MISTAKE_TYPE_LABEL_KEYS } from '@/entities/mistake/types'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardHeader } from '@/shared/ui/Card'
import { MistakeAnalysisView, AnalysisPlaceholder } from './MistakeAnalysisView'
import { PracticeMoreMenu } from './PracticeMoreMenu'
import { QuestionSource } from '@/widgets/quiz/QuestionSource'
import { relativeTime } from '@/shared/lib/utils'
import { cn } from '@/shared/lib/utils'
import { useTranslation } from '@/i18n'
import { DIFFICULTY_LABEL_KEYS } from '@/infrastructure/ai/prompts/types'

export interface MistakeCardProps {
  mistake: Mistake
  onAnalyze: (id: string) => Promise<void>
  onMarkUnderstood: (id: string) => Promise<void>
  onArchive: (id: string) => Promise<void>
  onRestore: (id: string) => Promise<void>
  onRemove: (id: string) => Promise<void>
  onPractice: (id: string, mode: 'same_concept' | 'similar' | 'easier' | 'harder' | 'weakness') => Promise<void>
}

export function MistakeCard({
  mistake,
  onAnalyze,
  onMarkUnderstood,
  onArchive,
  onRestore,
  onRemove,
  onPractice,
}: MistakeCardProps): JSX.Element {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)

  async function run(key: string, fn: () => Promise<void>) {
    setBusy(key)
    try {
      await fn()
    } finally {
      setBusy(null)
    }
  }

  const statusTone =
    mistake.status === 'understood'
      ? 'border-emerald-500/40'
      : mistake.status === 'archived'
        ? 'border-muted'
        : 'border-l-4 border-l-amber-500/60'

  return (
    <Card className={cn(statusTone)}>
      <CardHeader className="flex flex-row flex-wrap items-start gap-2 space-y-0 py-3">
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{t(MISTAKE_TYPE_LABEL_KEYS[mistake.mistakeType])}</Badge>
            <Badge variant="outline">{mistake.knowledgePoint}</Badge>
            <Badge variant="outline">{t(DIFFICULTY_LABEL_KEYS[mistake.difficulty])}</Badge>
            {mistake.status === 'understood' && (
              <Badge variant="default">
                <CheckCircle2 className="mr-1 h-3 w-3" /> {t('mistakeCard.understood')}
              </Badge>
            )}
            {mistake.status === 'archived' && (
              <Badge variant="secondary">{t('mistakeCard.archived')}</Badge>
            )}
            {mistake.source === 'manual' && (
              <Badge variant="secondary">{t('mistakeCard.addedByYou')}</Badge>
            )}
            {mistake.attemptCount > 1 && (
              <Badge variant="secondary">
                ×{t('mistakeCard.attempts', { count: mistake.attemptCount })}
              </Badge>
            )}
          </div>
          <p className="line-clamp-2 text-sm font-medium">{mistake.question}</p>
          <p className="text-xs text-muted-foreground">
            {t('mistakeCard.answerLine', {
              yours: mistake.studentAnswer || t('quizResult.blank'),
              correct: mistake.correctAnswer,
            })}
          </p>
        </div>
        <span className="text-xs text-muted-foreground">{relativeTime(mistake.createdAt)}</span>
        <Button variant="ghost" size="icon" aria-label={t('common.expand')} onClick={() => setExpanded((e) => !e)}>
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </Button>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-3 pt-0">
          {mistake.analysis ? (
            <MistakeAnalysisView analysis={mistake.analysis} onPractice={() => run('practice', () => onPractice(mistake.id, 'same_concept'))} />
          ) : mistake.analysisStatus === 'analyzing' ? (
            <AnalysisPlaceholder message={t('mistakeCard.analysing')} />
          ) : mistake.analysisStatus === 'failed' ? (
            <div className="space-y-2">
              <AnalysisPlaceholder
                message={mistake.analysisError ?? t('mistakeCard.analysisFailed')}
              />
              <Button variant="outline" size="sm" onClick={() => run('analyze', () => onAnalyze(mistake.id))} disabled={busy === 'analyze'}>
                {busy === 'analyze' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {t('mistakeCard.retry')}
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <AnalysisPlaceholder message={t('mistakeCard.runAnalysis')} />
              <Button size="sm" onClick={() => run('analyze', () => onAnalyze(mistake.id))} disabled={busy === 'analyze'}>
                {busy === 'analyze' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {t('mistakeCard.explain')}
              </Button>
            </div>
          )}

          <PracticeMoreMenu onSelect={(mode) => run(`practice-${mode}`, () => onPractice(mistake.id, mode))} busy={busy?.startsWith('practice') ?? false} />

          <QuestionSource sourceRefs={mistake.sourceRefs} projectId={mistake.projectId} />

          <div className="flex flex-wrap items-center gap-2 border-t pt-3">
            {mistake.status === 'active' && (
              <Button variant="outline" size="sm" onClick={() => run('understood', () => onMarkUnderstood(mistake.id))} disabled={busy === 'understood'}>
                <CheckCircle2 className="h-4 w-4" />
                {t('mistakeCard.markUnderstood')}
              </Button>
            )}
            {mistake.status !== 'archived' ? (
              <Button variant="outline" size="sm" onClick={() => run('archive', () => onArchive(mistake.id))} disabled={busy === 'archive'}>
                <Archive className="h-4 w-4" />
                {t('mistakeCard.archive')}
              </Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => run('restore', () => onRestore(mistake.id))} disabled={busy === 'restore'}>
                <ArchiveRestore className="h-4 w-4" />
                {t('mistakeCard.restore')}
              </Button>
            )}
            {confirmDelete ? (
              <div className="ml-auto flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{t('mistakeCard.removeConfirm')}</span>
                <Button variant="destructive" size="sm" onClick={() => run('remove', () => onRemove(mistake.id))} disabled={busy === 'remove'}>
                  {t('common.confirm')}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>
                  {t('common.cancel')}
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto text-destructive hover:text-destructive"
                onClick={() => setConfirmDelete(true)}
              >
                <Trash2 className="h-4 w-4" />
                {t('mistakeCard.remove')}
              </Button>
            )}
          </div>
        </CardContent>
      )}
    </Card>
  )
}