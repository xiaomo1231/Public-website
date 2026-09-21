import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Check, ClipboardList, Loader2, Upload, X } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/Card'
import { Badge } from '@/shared/ui/Badge'
import { Input } from '@/shared/ui/Input'
import { EmptyState } from '@/shared/ui/EmptyState'
import { LoadingState } from '@/shared/ui/LoadingState'
import { PageContainer, PageContent, PageHeader } from '@/shared/ui/Page'
import { RichText } from '@/shared/ui/RichText'
import { VisualSourceFigure } from '@/widgets/source/VisualSourceFigure'
import { DocumentUploadDialog } from '@/widgets/documents/DocumentUploadDialog'
import { PracticeService, type PracticeFeedback, type PracticeProgress } from '@/services/practiceService'
import { CourseContextService } from '@/services/courseContextService'
import type { PracticeQuestion, PracticeSet, ProfessorQuestionStyleProfile } from '@/entities/practice/types'
import type { TutorVisual } from '@/entities/tutorLesson/types'
import { cn } from '@/shared/lib/utils'
import { useTranslation } from '@/i18n'

function QuestionCard({
  question,
  onChecked,
}: {
  question: PracticeQuestion
  onChecked: () => void
}): JSX.Element {
  const { t } = useTranslation()
  const [answer, setAnswer] = useState('')
  const [feedback, setFeedback] = useState<PracticeFeedback | null>(null)
  const [busy, setBusy] = useState(false)

  const isChoice = question.type === 'single_choice' || question.type === 'true_false'
  const visual: TutorVisual | null = question.visualSourceId
    ? {
        id: question.visualSourceId,
        documentId: question.documentId,
        pageNumber: question.pageNumber ?? 0,
        type: 'unknown',
        caption: question.pageNumber
          ? t('practice.source', { page: question.pageNumber })
          : t('practice.title'),
        hasImage: true,
      }
    : null

  async function check(): Promise<void> {
    if (!answer.trim()) return
    setBusy(true)
    try {
      setFeedback(await new PracticeService().recordAttempt(question.id, answer.trim()))
      onChecked()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader className="space-y-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {question.number ? (
            <span className="text-muted-foreground">{t('practice.number', { number: question.number })}</span>
          ) : null}
          <Badge variant={question.status === 'verified' ? 'secondary' : 'outline'}>
            {question.status === 'verified' ? t('practice.verified') : t('practice.needsReview')}
          </Badge>
        </CardTitle>
        <RichText
          text={question.prompt}
          format="markdown"
          paragraphClassName="text-[16px] leading-[1.7]"
        />
      </CardHeader>
      <CardContent className="space-y-3">
        {visual && <VisualSourceFigure visual={visual} />}

        {isChoice ? (
          <ul className="space-y-1.5">
            {question.options.map((option, index) => {
              const label = String.fromCharCode(65 + index)
              return (
                <li key={option.id}>
                  <button
                    type="button"
                    onClick={() => setAnswer(label)}
                    className={cn(
                      'flex w-full items-start gap-2 rounded-md border px-3 py-2 text-left text-[15px] transition-colors',
                      answer === label ? 'border-primary bg-primary/5' : 'hover:bg-accent/50',
                    )}
                    aria-pressed={answer === label}
                  >
                    <span className="font-medium">{label}.</span>
                    <span className="min-w-0 break-words">{option.label}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <div className="space-y-1.5">
            <label htmlFor={`answer-${question.id}`} className="text-sm font-medium">
              {t('practice.yourAnswer')}
            </label>
            <Input
              id={`answer-${question.id}`}
              value={answer}
              onChange={(event) => setAnswer(event.target.value)}
              placeholder={t('practice.placeholder')}
              className="text-[16px]"
            />
          </div>
        )}

        <Button size="sm" onClick={() => void check()} disabled={busy || !answer.trim()}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          {t('practice.check')}
        </Button>

        {feedback && (
          <div
            className={cn(
              'space-y-1.5 rounded-md border p-3 text-sm',
              feedback.isCorrect === true && 'border-emerald-500/40 bg-emerald-50/40 dark:bg-emerald-950/20',
              feedback.isCorrect === false && 'border-destructive/40 bg-destructive/5',
              feedback.isCorrect === undefined && 'border-border',
            )}
          >
            <p className="flex items-center gap-1.5 font-medium">
              {feedback.isCorrect === true && <Check className="h-4 w-4 text-emerald-600" />}
              {feedback.isCorrect === false && <X className="h-4 w-4 text-destructive" />}
              {feedback.isCorrect === true
                ? t('practice.correctFeedback')
                : feedback.isCorrect === false
                  ? t('practice.incorrectFeedback')
                  : t('practice.cannotJudge')}
            </p>
            {feedback.expectedAnswer && (
              <p className="text-muted-foreground">
                {t('practice.expected')}: {feedback.expectedAnswer}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {feedback.answerSource === 'professor'
                ? t('practice.answerSourceProfessor')
                : t('practice.answerSourceNone')}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function PracticePage(): JSX.Element {
  const { id: projectId } = useParams<{ id: string }>()
  const { t } = useTranslation()
  const [loading, setLoading] = useState(true)
  const [sets, setSets] = useState<PracticeSet[]>([])
  const [questions, setQuestions] = useState<PracticeQuestion[]>([])
  const [progress, setProgress] = useState<PracticeProgress | null>(null)
  const [style, setStyle] = useState<ProfessorQuestionStyleProfile | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)

  const load = useCallback(async () => {
    if (!projectId) return
    const service = new PracticeService()
    const nextSets = await service.listSets(projectId)
    setSets(nextSets)
    const first = nextSets[0]
    if (first) {
      setQuestions(await service.listQuestions(first.id))
      setProgress(await service.progress(first.id))
    } else {
      setQuestions([])
      setProgress(null)
    }
    const context = await new CourseContextService().get(projectId)
    setStyle(context?.questionStyleProfile ?? null)
  }, [projectId])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        await load()
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [load])

  if (!projectId) return <div />

  if (loading) {
    return (
      <PageContainer>
        <PageContent>
          <LoadingState label={t('common.loading')} />
        </PageContent>
      </PageContainer>
    )
  }

  return (
    <PageContainer>
      <PageHeader
        title={
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="icon" aria-label={t('common.back')}>
              <Link to={`/projects/${projectId}/quiz`}>
                <ArrowLeft className="h-4 w-4" />
              </Link>
            </Button>
            <ClipboardList className="h-4 w-4" />
            {t('practice.title')}
          </div>
        }
        description={t('practice.subtitle')}
        actions={
          <Button variant="outline" size="sm" onClick={() => setUploadOpen(true)}>
            <Upload className="h-4 w-4" />
            {t('practice.upload')}
          </Button>
        }
      />
      <PageContent>
        <div className="mx-auto w-full max-w-[48rem] space-y-4">
          {style && (
            <Card>
              <CardHeader className="space-y-1">
                <CardTitle className="text-base">{t('practice.style')}</CardTitle>
                <p className="text-xs text-muted-foreground">
                  {t('practice.styleSample', { count: style.sampleSize })} ·{' '}
                  {t(`practice.styleConfidence.${style.confidence}`)}
                </p>
              </CardHeader>
              <CardContent className="space-y-1 text-xs text-muted-foreground">
                <p>
                  {t('practice.calculationVsConceptual', {
                    calculation: style.calculationVsConceptual.calculation,
                    conceptual: style.calculationVsConceptual.conceptual,
                    mixed: style.calculationVsConceptual.mixed,
                  })}
                </p>
                {style.instructionPatterns.length > 0 && (
                  <p>{style.instructionPatterns.join(', ')}</p>
                )}
              </CardContent>
            </Card>
          )}

          {sets.length === 0 ? (
            <EmptyState
              icon={<ClipboardList className="h-10 w-10" />}
              title={t('practice.empty')}
              description={t('practice.uploadHint')}
              action={
                <Button onClick={() => setUploadOpen(true)}>
                  <Upload className="h-4 w-4" />
                  {t('practice.upload')}
                </Button>
              }
            />
          ) : (
            <>
              {progress && (
                <p className="text-sm text-muted-foreground">
                  {t('practice.progress', { done: progress.completed, total: progress.total })} ·{' '}
                  {t('practice.correct', { count: progress.correct })} ·{' '}
                  {t('practice.reviewCount', { count: progress.needsReview })}
                </p>
              )}
              {questions.map((question) => (
                <QuestionCard key={question.id} question={question} onChecked={() => void load()} />
              ))}
            </>
          )}
        </div>
      </PageContent>

      <DocumentUploadDialog
        projectId={projectId}
        open={uploadOpen}
        onOpenChange={(next) => {
          setUploadOpen(next)
          if (!next) void load()
        }}
        materialType="professor_practice"
      />
    </PageContainer>
  )
}
