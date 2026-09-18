import { useEffect, useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import type { CourseAnalysis, Topic } from '@/entities/courseAnalysis/types'
import type { QuizConfig, QuizDifficulty } from '@/entities/quiz/types'
import type { QuestionType } from '@/entities/question/types'
import { QUESTION_TYPES, QUESTION_TYPE_LABEL_KEYS } from '@/entities/question/types'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { Input } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/shared/ui/Select2'
import { cn } from '@/shared/lib/utils'
import { useTranslation, type TranslationKey } from '@/i18n'

export interface QuizConfigDialogProps {
  projectId: string
  onStart: (config: QuizConfig) => void
  busy?: boolean
  progress?: { stage: string; progress: number } | null
}

const DIFFICULTIES: Array<{ value: QuizDifficulty; labelKey: TranslationKey }> = [
  { value: 'adaptive', labelKey: 'quizConfig.adaptive' },
  { value: 'beginner', labelKey: 'difficulty.beginner' },
  { value: 'basic', labelKey: 'difficulty.basic' },
  { value: 'intermediate', labelKey: 'difficulty.intermediate' },
  { value: 'advanced', labelKey: 'difficulty.advanced' },
  { value: 'challenge', labelKey: 'difficulty.challenge' },
]

const STAGE_LABEL_KEYS: Record<string, TranslationKey> = {
  starting: 'quiz.starting',
  collecting: 'stage.collectingShort',
  generating: 'stage.generating',
  storing: 'stage.storing',
  done: 'stage.done',
}

export function QuizConfigDialog({ projectId, onStart, busy, progress }: QuizConfigDialogProps): JSX.Element {
  const { t } = useTranslation()
  const [analysis, setAnalysis] = useState<CourseAnalysis | null>(null)
  const [topics, setTopics] = useState<Topic[]>([])
  const [topicId, setTopicId] = useState<string>('__mixed__')
  const [count, setCount] = useState(5)
  const [difficulty, setDifficulty] = useState<QuizDifficulty>('adaptive')
  const [types, setTypes] = useState<QuestionType[]>(['multiple_choice'])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const repo = new CourseAnalysisRepository()
        const [a, ts] = await Promise.all([repo.getByProject(projectId), repo.listTopics(projectId)])
        if (cancelled) return
        setAnalysis(a ?? null)
        setTopics(ts)
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId])

  function toggleType(type: QuestionType) {
    setTypes((prev) => {
      if (prev.includes(type)) {
        if (prev.length === 1) return prev // keep at least one
        return prev.filter((item) => item !== type)
      }
      return [...prev, type]
    })
  }

  function handleStart() {
    const topic = topics.find((item) => item.id === topicId)
    const config: QuizConfig = {
      mode: topicId === '__mixed__' ? 'mixed' : 'topic',
      count,
      difficulty,
      types,
      ...(topic ? { topicId: topic.id, topicName: topic.name } : {}),
    }
    onStart(config)
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t('quizConfig.loadingOptions')}
        </CardContent>
      </Card>
    )
  }

  if (!analysis || analysis.status !== 'ready') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t('quizConfig.needAnalysis')}</CardTitle>
          <CardDescription>
            {t('quizConfig.needAnalysisHint')}
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-4 w-4" />
          {t('quizConfig.title')}
        </CardTitle>
        <CardDescription>
          {t('quizConfig.description')}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="quiz-topic">{t('quizConfig.topic')}</Label>
            <Select value={topicId} onValueChange={setTopicId}>
              <SelectTrigger id="quiz-topic">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__mixed__">{t('quizConfig.mixedReview')}</SelectItem>
                {topics.map((topic) => (
                  <SelectItem key={topic.id} value={topic.id}>
                    {topic.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="quiz-count">{t('quizConfig.questionCount')}</Label>
            <Input
              id="quiz-count"
              type="number"
              min={1}
              max={30}
              value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
            />
            <p className="text-xs text-muted-foreground">{t('quizConfig.questionCountHint')}</p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="quiz-difficulty">{t('quizConfig.difficulty')}</Label>
          <Select value={difficulty} onValueChange={(v) => setDifficulty(v as QuizDifficulty)}>
            <SelectTrigger id="quiz-difficulty">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DIFFICULTIES.map((d) => (
                <SelectItem key={d.value} value={d.value}>
                  {t(d.labelKey)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {difficulty === 'adaptive' && (
            <p className="text-xs text-muted-foreground">
              {t('quizConfig.difficultyHint')}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label>{t('quizConfig.questionTypes')}</Label>
          <div className="flex flex-wrap gap-2">
            {QUESTION_TYPES.map((type) => {
              const active = types.includes(type)
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggleType(type)}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-xs transition-colors',
                    active ? 'border-foreground/40 bg-accent' : 'hover:bg-accent/50',
                  )}
                  aria-pressed={active}
                >
                  {t(QUESTION_TYPE_LABEL_KEYS[type])}
                </button>
              )
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            {t('quizConfig.questionTypesHint')}
          </p>
        </div>

        {busy && progress && (
          <div className="space-y-1">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-[width]" style={{ width: `${progress.progress}%` }} />
            </div>
            <p className="text-xs capitalize text-muted-foreground">
              {(STAGE_LABEL_KEYS[progress.stage]
                ? t(STAGE_LABEL_KEYS[progress.stage])
                : progress.stage) + '…'}
            </p>
          </div>
        )}

        <Button onClick={handleStart} disabled={busy} className="w-full sm:w-auto">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {busy ? t('quizConfig.generating') : t('quizConfig.title')}
        </Button>
      </CardContent>
    </Card>
  )
}