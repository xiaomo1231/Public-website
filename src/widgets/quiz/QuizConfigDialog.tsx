import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Loader2, Mic, Sparkles } from 'lucide-react'
import type { CourseAnalysis, Topic } from '@/entities/courseAnalysis/types'
import {
  ORAL_DEFAULT_TIMER_SECONDS,
  ORAL_MAX_TOPICS,
  type QuizConfig,
  type QuizDifficulty,
} from '@/entities/quiz/types'
import { SyllabusService } from '@/services/syllabusService'
import type { QuestionType } from '@/entities/question/types'
import {
  QUESTION_TYPE_LABEL_KEYS,
  defaultQuestionTypes,
  questionTypesForSubject,
} from '@/entities/question/types'
import { targetLanguageOf } from '@/shared/lib/language'
import { useProject } from '@/features/project/useProjects'
import { useAuth } from '@/features/auth/useAuth'
import {
  DEFAULT_QUESTION_LANGUAGE,
  QUESTION_LANGUAGES,
  type QuestionLanguage,
} from '@/entities/user/types'
import { CourseContentRepository } from '@/entities/courseContent/repository'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/shared/ui/Card'
import { Input } from '@/shared/ui/Input'
import { Label } from '@/shared/ui/Label'
import { Progress } from '@/shared/ui/Progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/ui/Select2'
import { cn } from '@/shared/lib/utils'
import { ExamScopePicker, type ExamScopeChoice } from '@/widgets/syllabus/ExamScopePicker'
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

const QUESTION_LANGUAGE_LABEL_KEYS: Record<QuestionLanguage, TranslationKey> = {
  zh_terms: 'questionLanguage.zh_terms',
  source: 'questionLanguage.source',
  en: 'questionLanguage.en',
}

const STAGE_LABEL_KEYS: Record<string, TranslationKey> = {
  starting: 'quiz.starting',
  collecting: 'stage.collectingShort',
  generating: 'stage.generating',
  storing: 'stage.storing',
  done: 'stage.done',
}

export function QuizConfigDialog({
  projectId,
  onStart,
  busy,
  progress,
}: QuizConfigDialogProps): JSX.Element {
  const { t } = useTranslation()
  const { project } = useProject(projectId)
  const targetLanguage = targetLanguageOf(project)
  const availableTypes = questionTypesForSubject(project?.subject, targetLanguage)
  const [analysis, setAnalysis] = useState<CourseAnalysis | null>(null)
  const [topics, setTopics] = useState<Topic[]>([])
  const [topicId, setTopicId] = useState<string>('__mixed__')
  // Optional: quiz an exam scope of the course syllabus instead of a topic.
  const [examScope, setExamScope] = useState<ExamScopeChoice | null>(null)
  const [count, setCount] = useState(5)
  const [difficulty, setDifficulty] = useState<QuizDifficulty>('adaptive')
  const [types, setTypes] = useState<QuestionType[]>(['multiple_choice'])
  // A language course starts with its drills ticked (once the course is known).
  const subject = project?.subject
  useEffect(() => {
    if (subject) setTypes(defaultQuestionTypes(subject, targetLanguage))
  }, [subject, targetLanguage])
  // Oral-exam rehearsal: offered for medicine and for any course with a
  // syllabus; preselected by the exam-topic list's 「口试练习」 link (`?oral=1`).
  const [params] = useSearchParams()
  const [oral, setOral] = useState(params.get('oral') === '1')
  const [oralCount, setOralCount] = useState(params.get('examTopic') ? 1 : 3)
  const [oralTimer, setOralTimer] = useState(true)
  const [hasSyllabus, setHasSyllabus] = useState(false)
  useEffect(() => {
    let cancelled = false
    void new SyllabusService()
      .listSyllabi(projectId)
      .then((rows) => {
        if (!cancelled) setHasSyllabus(rows.some((row) => row.data.scopes.length > 0))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [projectId])
  const oralOffered = subject === 'medicine' || hasSyllabus || oral
  const [loading, setLoading] = useState(true)
  // The saved preference; changing it here saves it for every later quiz.
  const { profile, setQuestionLanguage } = useAuth()
  const questionLanguage = profile?.questionLanguage ?? DEFAULT_QUESTION_LANGUAGE

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const content = new CourseContentRepository()
        const [a, ts] = await Promise.all([
          content.getAnalysis(projectId),
          content.getTopics(projectId),
        ])
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
    if (oral) {
      onStart({
        mode: 'oral',
        count: oralCount,
        difficulty,
        types: ['short_answer'],
        questionLanguage,
        oral: oralTimer ? { timerSeconds: ORAL_DEFAULT_TIMER_SECONDS } : {},
        ...(examScope
          ? { topicName: examScope.label, examScope: examScope.selection }
          : topic
            ? { topicId: topic.id, topicName: topic.name }
            : {}),
      })
      return
    }
    const config: QuizConfig = {
      mode: topicId === '__mixed__' ? 'mixed' : 'topic',
      count,
      difficulty,
      types,
      questionLanguage,
      ...(topic ? { topicId: topic.id, topicName: topic.name } : {}),
    }
    onStart(
      examScope
        ? {
            ...config,
            mode: 'mixed',
            topicId: undefined,
            topicName: examScope.label,
            examScope: examScope.selection,
          }
        : config,
    )
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
          <CardDescription>{t('quizConfig.needAnalysisHint')}</CardDescription>
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
        <CardDescription>{t('quizConfig.description')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="quiz-topic">{t('quizConfig.topic')}</Label>
            <Select value={topicId} onValueChange={setTopicId} disabled={examScope !== null}>
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

          <div className={cn('space-y-2', oral && 'hidden')}>
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

        <ExamScopePicker projectId={projectId} value={examScope} onChange={setExamScope} />

        {oralOffered && (
          <div className="space-y-3 border-t pt-4">
            <label className="flex cursor-pointer items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="focus-ring mt-0.5 h-4 w-4 shrink-0 accent-primary"
                checked={oral}
                onChange={(event) => setOral(event.target.checked)}
              />
              <span>
                <span className="flex items-center gap-1.5 font-medium">
                  <Mic className="h-4 w-4" aria-hidden />
                  {t('oral.config.toggle')}
                </span>
                <span className="block text-xs text-muted-foreground">{t('oral.config.hint')}</span>
              </span>
            </label>
            {oral && (
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="oral-count">{t('oral.config.topicCount')}</Label>
                  <Input
                    id="oral-count"
                    type="number"
                    min={1}
                    max={ORAL_MAX_TOPICS}
                    value={oralCount}
                    disabled={topicId !== '__mixed__' && examScope === null}
                    onChange={(e) =>
                      setOralCount(
                        Math.max(1, Math.min(ORAL_MAX_TOPICS, Number(e.target.value) || 1)),
                      )
                    }
                  />
                  <p className="text-xs text-muted-foreground">{t('oral.config.topicCountHint')}</p>
                </div>
                <label className="flex cursor-pointer items-start gap-3 self-center text-sm">
                  <input
                    type="checkbox"
                    className="focus-ring mt-0.5 h-4 w-4 shrink-0 accent-primary"
                    checked={oralTimer}
                    onChange={(event) => setOralTimer(event.target.checked)}
                  />
                  <span>
                    {t('oral.config.timer', { minutes: ORAL_DEFAULT_TIMER_SECONDS / 60 })}
                    <span className="block text-xs text-muted-foreground">
                      {t('oral.config.timerHint')}
                    </span>
                  </span>
                </label>
              </div>
            )}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="quiz-language">{t('quizConfig.questionLanguage')}</Label>
          <Select
            value={questionLanguage}
            onValueChange={(v) => void setQuestionLanguage(v as QuestionLanguage)}
          >
            <SelectTrigger id="quiz-language">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {QUESTION_LANGUAGES.map((value) => (
                <SelectItem key={value} value={value}>
                  {t(QUESTION_LANGUAGE_LABEL_KEYS[value])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">{t('quizConfig.questionLanguageHint')}</p>
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
            <p className="text-xs text-muted-foreground">{t('quizConfig.difficultyHint')}</p>
          )}
        </div>

        <div className={cn('space-y-2', oral && 'hidden')}>
          <Label>{t('quizConfig.questionTypes')}</Label>
          <div className="flex flex-wrap gap-2">
            {availableTypes.map((type) => {
              const active = types.includes(type)
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => toggleType(type)}
                  className={cn(
                    'rounded-lg border px-3 py-1.5 text-xs transition-colors',
                    active ? 'border-foreground/40 bg-accent' : 'hover:bg-accent/50',
                  )}
                  aria-pressed={active}
                >
                  {t(QUESTION_TYPE_LABEL_KEYS[type])}
                </button>
              )
            })}
          </div>
          <p className="text-xs text-muted-foreground">{t('quizConfig.questionTypesHint')}</p>
        </div>

        {busy && progress && (
          <div className="space-y-1">
            <Progress value={progress.progress} className="h-1.5" />
            <p className="text-xs text-muted-foreground">
              {(STAGE_LABEL_KEYS[progress.stage]
                ? t(STAGE_LABEL_KEYS[progress.stage])
                : progress.stage) + '…'}
            </p>
          </div>
        )}

        <Button onClick={handleStart} disabled={busy} className="w-full sm:w-auto">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {busy
            ? t('quizConfig.generating')
            : oral
              ? t('oral.config.start')
              : t('quizConfig.title')}
        </Button>
      </CardContent>
    </Card>
  )
}
