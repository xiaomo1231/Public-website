import { useEffect, useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import type { CourseAnalysis, Topic } from '@/entities/courseAnalysis/types'
import type { QuizConfig, QuizDifficulty } from '@/entities/quiz/types'
import type { QuestionType } from '@/entities/question/types'
import { QUESTION_TYPES, QUESTION_TYPE_LABELS } from '@/entities/question/types'
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

export interface QuizConfigDialogProps {
  projectId: string
  onStart: (config: QuizConfig) => void
  busy?: boolean
  progress?: { stage: string; progress: number } | null
}

const DIFFICULTIES: Array<{ value: QuizDifficulty; label: string }> = [
  { value: 'adaptive', label: 'Adaptive (recommended)' },
  { value: 'beginner', label: 'Beginner' },
  { value: 'basic', label: 'Basic' },
  { value: 'intermediate', label: 'Intermediate' },
  { value: 'advanced', label: 'Advanced' },
  { value: 'challenge', label: 'Challenge' },
]

export function QuizConfigDialog({ projectId, onStart, busy, progress }: QuizConfigDialogProps): JSX.Element {
  const [analysis, setAnalysis] = useState<CourseAnalysis | null>(null)
  const [topics, setTopics] = useState<Topic[]>([])
  const [topicId, setTopicId] = useState<string>('__mixed__')
  const [count, setCount] = useState(5)
  const [difficulty, setDifficulty] = useState<QuizDifficulty>('adaptive')
  const [types, setTypes] = useState<QuestionType[]>(['multiple_choice', 'short_answer'])
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
        return prev.filter((t) => t !== type)
      }
      return [...prev, type]
    })
  }

  function handleStart() {
    const topic = topics.find((t) => t.id === topicId)
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
          <Loader2 className="h-4 w-4 animate-spin" /> Loading quiz options…
        </CardContent>
      </Card>
    )
  }

  if (!analysis || analysis.status !== 'ready') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Analyze the course first</CardTitle>
          <CardDescription>
            Quizzes are generated from your analysed course material. Run Analyze Course on the project's Analysis tab.
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
          Generate Quiz
        </CardTitle>
        <CardDescription>
          The AI writes questions grounded in your uploaded documents. Difficulty adapts as you answer.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="quiz-topic">Topic</Label>
            <Select value={topicId} onValueChange={setTopicId}>
              <SelectTrigger id="quiz-topic">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__mixed__">Mixed review (all topics)</SelectItem>
                {topics.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="quiz-count">Number of questions</Label>
            <Input
              id="quiz-count"
              type="number"
              min={1}
              max={30}
              value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(30, Number(e.target.value) || 1)))}
            />
            <p className="text-xs text-muted-foreground">Between 1 and 30.</p>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="quiz-difficulty">Difficulty</Label>
          <Select value={difficulty} onValueChange={(v) => setDifficulty(v as QuizDifficulty)}>
            <SelectTrigger id="quiz-difficulty">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DIFFICULTIES.map((d) => (
                <SelectItem key={d.value} value={d.value}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {difficulty === 'adaptive' && (
            <p className="text-xs text-muted-foreground">
              Starts at Basic and adjusts after each answer based on accuracy, streaks, and knowledge-point mastery.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label>Question types</Label>
          <div className="flex flex-wrap gap-2">
            {QUESTION_TYPES.map((t) => {
              const active = types.includes(t)
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => toggleType(t)}
                  className={cn(
                    'rounded-md border px-3 py-1.5 text-xs transition-colors',
                    active ? 'border-foreground/40 bg-accent' : 'hover:bg-accent/50',
                  )}
                  aria-pressed={active}
                >
                  {QUESTION_TYPE_LABELS[t]}
                </button>
              )
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            Types cycle through the quiz in the order above. At least one type must be selected.
          </p>
        </div>

        {busy && progress && (
          <div className="space-y-1">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-primary transition-[width]" style={{ width: `${progress.progress}%` }} />
            </div>
            <p className="text-xs capitalize text-muted-foreground">{progress.stage}…</p>
          </div>
        )}

        <Button onClick={handleStart} disabled={busy} className="w-full sm:w-auto">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {busy ? 'Generating…' : 'Generate Quiz'}
        </Button>
      </CardContent>
    </Card>
  )
}