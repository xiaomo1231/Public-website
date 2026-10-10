import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { QuizService } from '@/services/quizService'
import { collectQuizSnippets } from '@/services/sourceContext'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import type { AIService } from '@/services/aiService'
import type { QuizConfig } from '@/entities/quiz/types'
import type { ChatMessage } from '@/infrastructure/ai/types'

let db: AppDatabase

async function seed(pages: number) {
  const p = await new ProjectService(db).create({ name: 'Anatomy', subject: 'medicine' })
  const docs = new DocumentRepository(db)
  const doc = await docs.create({ projectId: p.id, type: 'pdf', name: 'atlas.pdf', sizeBytes: 1 })
  await docs.update(doc.id, { status: 'ready' })
  const chunks = await new ChunkRepository(db).addMany(
    Array.from({ length: pages }, (_, i) => ({
      documentId: doc.id,
      projectId: p.id,
      contentType: 'paragraph' as const,
      text: `Page ${i + 1}: the ${i === pages - 1 ? 'glenoid labrum' : `structure number ${i + 1}`} is described here.`,
      sourceReference: 'atlas.pdf',
      order: i,
      pageNumber: i + 1,
    })),
  )
  await new CourseAnalysisRepository(db).reseedProject(
    p.id,
    {
      topics: [{ name: 'Shoulder', description: 'd', sourceRefs: [] }],
      concepts: [],
      formulas: [],
      symbols: [],
      examples: [],
      exercises: [],
      prerequisites: [],
      topicsByName: new Map([['Shoulder', 't1']]),
      documentIds: [doc.id],
    },
    'en',
  )
  return { projectId: p.id, documentId: doc.id, chunks }
}

const config = (count: number, types: QuizConfig['types']): QuizConfig =>
  ({ mode: 'mixed', count, difficulty: 'basic', types }) as QuizConfig

/** A model that answers each plan line with its type, optionally dropping some. */
function planAI(drop: (call: number, index: number) => boolean = () => false) {
  let call = 0
  const chatJSON = vi.fn(async (messages: ChatMessage[], _options?: { maxTokens?: number }) => {
    call++
    const plan = [...messages[1]!.content.matchAll(/^\s*\d+\. type=(\w+)/gm)].map((m) => m[1]!)
    return {
      data: {
        questions: plan
          .map((type, i) => ({
            prompt: `Q${call}.${i} (${type})`,
            type,
            correctAnswer: type === 'true_false' ? 'true' : '3',
            solution: '',
            knowledgePoint: 'K',
            difficulty: 'basic',
            hints: [],
          }))
          .filter((_, i) => !drop(call, i)),
      },
    }
  })
  const ai = { chatJSON, currentProvider: {}, maxOutputTokens: 2048 } as unknown as AIService
  return { ai, chatJSON }
}

beforeEach(() => {
  db = new AppDatabase()
  setDbForTesting(db)
})

describe('quiz generation for large quizzes', () => {
  it('asks in batches with room for every question', async () => {
    const { projectId } = await seed(30)
    const { ai, chatJSON } = planAI()
    const quiz = await new QuizService({ ai, db }).generateQuiz(projectId, config(12, ['numeric']))
    expect(quiz.questionIds).toHaveLength(12)
    expect(chatJSON).toHaveBeenCalledTimes(3) // 5 + 5 + 2
    const budgets = chatJSON.mock.calls.map((c) => c[1]?.maxTokens)
    expect(budgets).toEqual([5524, 5524, 2824])
    // Later batches are told what was already asked.
    expect((chatJSON.mock.calls[2]![0] as ChatMessage[])[1]!.content).toContain('Avoid repeating')
  })

  it('tops up dropped questions, keeps every type in place and counts the title right', async () => {
    const { projectId } = await seed(10)
    // The first answer drops its second question (a true/false).
    const { ai, chatJSON } = planAI((call, index) => call === 1 && index === 1)
    const service = new QuizService({ ai, db })
    const quiz = await service.generateQuiz(projectId, config(4, ['numeric', 'true_false']))
    expect(chatJSON).toHaveBeenCalledTimes(2)
    const questions = await service.getQuestions(quiz.id)
    expect(questions.map((q) => q.type)).toEqual(['numeric', 'true_false', 'numeric', 'true_false'])
    // Each stored type matches its own question, never a shifted plan entry.
    for (const q of questions) expect(q.prompt).toContain(`(${q.type})`)
    expect(quiz.title).toContain('4')
  })

  it('reports the real count when the model keeps falling short', async () => {
    const { projectId } = await seed(10)
    const { ai } = planAI((_, index) => index >= 3)
    const quiz = await new QuizService({ ai, db }).generateQuiz(projectId, config(5, ['numeric']))
    // 3 + 2 asked again → 5; a model that always stops at 3 still reaches 5 in two rounds.
    expect(quiz.questionIds).toHaveLength(5)
    const short = planAI(() => true)
    await expect(new QuizService({ ai: short.ai, db }).generateQuiz(projectId, config(3, ['numeric']))).rejects.toThrow()
  })
})

describe('quiz source passages', () => {
  it('spread over the whole material and prefer the topic sources and knowledge points', async () => {
    const { documentId, chunks } = await seed(100)
    const snippets = await collectQuizSnippets({
      documentIds: [documentId],
      chunks: new ChunkRepository(db),
      preferChunkIds: [chunks[50]!.id],
      keywords: ['glenoid labrum'],
      limit: 8,
    })
    const pages = snippets.map((s) => s.pageNumber!)
    expect(pages).toHaveLength(8)
    expect(pages).toContain(51)
    expect(pages).toContain(100)
    expect(Math.max(...pages) - Math.min(...pages)).toBeGreaterThan(80)
  })
})
