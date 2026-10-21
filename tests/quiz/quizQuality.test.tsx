import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { QuizService, quizLanguage } from '@/services/quizService'
import { evaluateDeterministic } from '@/services/answerEvaluationService'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { UserRepository } from '@/entities/user/repository'
import { shuffled } from '@/shared/lib/shuffle'
import { QuestionCard } from '@/widgets/quiz/QuestionCard'
import { APP_VERSION } from '@/shared/config/config'
import { version } from '../../package.json'
import type { AIService } from '@/services/aiService'
import type { QuizConfig } from '@/entities/quiz/types'
import type { ChatMessage } from '@/infrastructure/ai/types'

let db: AppDatabase
const TOPICS = ['Shoulder', 'Elbow', 'Hip', 'Knee', 'Ankle']

async function seed(topics = TOPICS, language: 'en' | 'zh' = 'en') {
  const p = await new ProjectService(db).create({ name: 'Anatomy', subject: 'medicine' })
  const docs = new DocumentRepository(db)
  const doc = await docs.create({ projectId: p.id, type: 'pdf', name: 'atlas.pdf', sizeBytes: 1 })
  await docs.update(doc.id, { status: 'ready' })
  await new ChunkRepository(db).addMany(
    topics.flatMap((topic, t) =>
      Array.from({ length: 20 }, (_, i) => ({
        documentId: doc.id,
        projectId: p.id,
        contentType: 'paragraph' as const,
        text: `${topic} joint passage ${i}: the ${topic}-L${i % 3} ligament and its attachments.`,
        sourceReference: 'atlas.pdf',
        order: t * 20 + i,
        pageNumber: t * 20 + i + 1,
        chapterId: `ch-${t}`,
      })),
    ),
  )
  await new CourseAnalysisRepository(db).reseedProject(
    p.id,
    {
      topics: topics.map((name) => ({ name, description: `${name} joint`, sourceRefs: [] })),
      concepts: topics.flatMap((topic) =>
        [0, 1].map((k) => ({
          name: `${topic}-L${k}`,
          definition: 'd',
          topicNames: [topic],
          sourceRefs: [],
        })),
      ),
      formulas: [],
      symbols: [],
      examples: [],
      exercises: [],
      prerequisites: [],
      topicsByName: new Map(topics.map((name) => [name, `topic-${name}`])),
      documentIds: [doc.id],
    },
    language,
  )
  return p.id
}

/** Answers each plan line with a choice question; the correct option always first, like a real model. */
function choiceAI(
  options: (call: number, index: number) => Array<{ label: string; isCorrect: boolean }> = () => [
    { label: 'right answer', isCorrect: true },
    { label: 'wrong one aa', isCorrect: false },
    { label: 'wrong two bb', isCorrect: false },
    { label: 'wrong three', isCorrect: false },
  ],
) {
  let call = 0
  const chatJSON = vi.fn(async (messages: ChatMessage[], _options?: { maxTokens?: number }) => {
    call++
    const plan = [...messages[1]!.content.matchAll(/^\s*\d+\. type=(\w+)/gm)]
    return {
      data: {
        questions: plan.map((_, i) => {
          const opts = options(call, i)
          return {
            prompt: `Q${call}.${i}`,
            type: 'multiple_choice',
            options: opts,
            correctAnswer: opts.find((o) => o.isCorrect)?.label ?? '',
            solution: '',
            knowledgePoint: 'K',
            difficulty: 'basic',
            hints: [],
          }
        }),
      },
    }
  })
  const ai = { chatJSON, currentProvider: {}, maxOutputTokens: 2048 } as unknown as AIService
  return { ai, chatJSON }
}

const mixed = (count: number, extra: Partial<QuizConfig> = {}): QuizConfig =>
  ({
    mode: 'mixed',
    count,
    difficulty: 'basic',
    types: ['multiple_choice'],
    ...extra,
  }) as QuizConfig

beforeEach(() => {
  db = new AppDatabase()
  setDbForTesting(db)
})

describe('answer positions', () => {
  it('shuffles options so the answer is not always A, and still grades by the answer', async () => {
    const projectId = await seed()
    const { ai } = choiceAI()
    const service = new QuizService({ ai, db })
    const quiz = await service.generateQuiz(projectId, mixed(30))
    const questions = await service.getQuestions(quiz.id)
    const positions = questions.map((q) => q.options!.findIndex((o) => o.isCorrect))
    expect(new Set(positions).size).toBeGreaterThan(1)
    for (const q of questions) {
      const right = q.options!.find((o) => o.isCorrect)!
      expect(evaluateDeterministic(q, right.id).isCorrect).toBe(true)
      expect(evaluateDeterministic(q, q.options!.find((o) => !o.isCorrect)!.id).isCorrect).toBe(
        false,
      )
    }
  })

  it('shuffles fairly', () => {
    const counts = [0, 0, 0, 0]
    let seed = 7
    const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647
    for (let i = 0; i < 4000; i++) counts[shuffled([0, 1, 2, 3], random).indexOf(0)]!++
    for (const n of counts) expect(n).toBeGreaterThan(850)
  })

  it('drops a giveaway answer or duplicate options and asks again', async () => {
    const projectId = await seed()
    const giveaway = [
      { label: 'Export of mature RNAs and RNPs, and import of nuclear proteins', isCorrect: true },
      { label: 'Export of GTP', isCorrect: false },
      { label: 'Import of DNA', isCorrect: false },
      { label: 'Export of fat', isCorrect: false },
    ]
    const duplicate = [
      { label: 'same', isCorrect: true },
      { label: 'same', isCorrect: false },
      { label: 'other one', isCorrect: false },
      { label: 'third one', isCorrect: false },
    ]
    const { ai, chatJSON } = choiceAI((call, index) =>
      call === 1 && index === 0
        ? giveaway
        : call === 1 && index === 1
          ? duplicate
          : [
              { label: 'balanced answer', isCorrect: true },
              { label: 'balanced wrong1', isCorrect: false },
              { label: 'balanced wrong2', isCorrect: false },
              { label: 'balanced wrong3', isCorrect: false },
            ],
    )
    const service = new QuizService({ ai, db })
    const quiz = await service.generateQuiz(
      projectId,
      mixed(3, { mode: 'topic', topicId: 'topic-Hip' }),
    )
    expect(chatJSON).toHaveBeenCalledTimes(2)
    const questions = await service.getQuestions(quiz.id)
    expect(questions).toHaveLength(3)
    expect(questions.every((q) => q.options!.some((o) => o.label === 'balanced answer'))).toBe(true)
  })
})

describe('mixed review across topics', () => {
  it('covers every topic and gives each batch only its own topics', async () => {
    const projectId = await seed()
    const { ai, chatJSON } = choiceAI()
    const service = new QuizService({ ai, db })
    const quiz = await service.generateQuiz(projectId, mixed(10))
    const questions = await service.getQuestions(quiz.id)
    expect(new Set(questions.map((q) => q.topicId))).toEqual(
      new Set(TOPICS.map((name) => `topic-${name}`)),
    )
    // Batch 1 (questions 1–5) and batch 2 (6–10) each cover the five topics once.
    for (const call of chatJSON.mock.calls) {
      const user = (call[0] as ChatMessage[])[1]!.content
      const joints = TOPICS.filter((topic) => user.includes(`${topic} joint passage`))
      expect(joints).toEqual(TOPICS)
    }
  })

  it('samples topics when there are more topics than questions, never just one', async () => {
    const projectId = await seed()
    const { ai, chatJSON } = choiceAI()
    const service = new QuizService({ ai, db })
    const quiz = await service.generateQuiz(projectId, mixed(3))
    const questions = await service.getQuestions(quiz.id)
    expect(new Set(questions.map((q) => q.topicId)).size).toBe(3)
    const user = (chatJSON.mock.calls[0]![0] as ChatMessage[])[1]!.content
    expect(TOPICS.filter((topic) => user.includes(`${topic} joint passage`))).toHaveLength(3)
  })
})

describe('question language', () => {
  const userPrompt = (chatJSON: ReturnType<typeof choiceAI>['chatJSON']) =>
    (chatJSON.mock.calls[0]![0] as ChatMessage[])[1]!.content

  it('writes Chinese with English terms by default, even from an English textbook', async () => {
    const projectId = await seed()
    const { ai, chatJSON } = choiceAI()
    await new QuizService({ ai, db }).generateQuiz(projectId, mixed(1))
    expect(userPrompt(chatJSON)).toContain(
      'Respond in: Simplified Chinese. At the first mention of each key technical term',
    )
  })

  it('follows the saved preference, and a quiz may override it', async () => {
    const projectId = await seed(TOPICS, 'en')
    await new UserRepository(db).update({ questionLanguage: 'source' })
    const first = choiceAI()
    await new QuizService({ ai: first.ai, db }).generateQuiz(projectId, mixed(1))
    expect(userPrompt(first.chatJSON)).toContain('Respond in: English.')
    const second = choiceAI()
    await new QuizService({ ai: second.ai, db }).generateQuiz(
      projectId,
      mixed(1, { questionLanguage: 'zh_terms' }),
    )
    expect(userPrompt(second.chatJSON)).toContain('Simplified Chinese')
    expect(quizLanguage('source', 'zh')).toBe('zh')
    expect(quizLanguage(undefined, 'en')).toBe('zh_terms')
  })
})

describe('display', () => {
  it('shows the difficulty as words, not its id', () => {
    render(
      <QuestionCard
        question={{
          id: 'q',
          projectId: 'p',
          knowledgePoint: 'K',
          type: 'true_false',
          difficulty: 'basic',
          prompt: 'P',
          correctAnswer: 'true',
          hints: [],
          sourceRefs: [],
          promptVersion: 'v6',
          createdAt: 1,
        }}
        index={0}
        total={1}
        difficulty="basic"
        value=""
        onChange={() => undefined}
        onSubmit={() => undefined}
        onNext={() => undefined}
        isLast
      />,
    )
    expect(screen.getByText('Basic')).toBeInTheDocument()
    expect(screen.queryByText('basic')).toBeNull()
  })

  it('reports the released version', () => {
    expect(APP_VERSION).toBe(version)
  })
})
