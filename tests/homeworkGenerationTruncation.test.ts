import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { HomeworkService } from '@/services/homeworkService'
import type { HomeworkQuestion } from '@/entities/homework/types'
import type { AIService } from '@/services/aiService'
import { OutputLimitError, OutputTruncatedError } from '@/infrastructure/ai/errors'

const PROMPT = 'Problem 6: Consider a vector space and determine whether each stated subset is a subspace. '.repeat(5)

describe('homework help after model output stops early', () => {
  let db: AppDatabase
  let row: HomeworkQuestion

  beforeEach(async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    row = {
      id: crypto.randomUUID(), projectId: 'project-1', setId: 'set-1',
      documentId: 'document-1', documentName: 'hw.pdf', order: 0,
      prompt: PROMPT, sourceRefs: [], hints: ['old hint'], solution: 'old solution',
      generationStatus: 'ready', promptVersion: 'v1', draftText: 'my working',
      revealedHints: 1, solutionRevealed: true,
      messages: [{ id: 'm1', role: 'student', content: 'my question', createdAt: 1 }],
      createdAt: 1, updatedAt: 1,
    }
    await db.homeworkQuestions.put(row)
  })

  it('uses a compact response after raising the per-question budget', async () => {
    const budgets: number[] = []
    const streamJSON = vi.fn(async (messages: Array<{ content: string }>, _delta: unknown, options: { maxTokens: number }) => {
      budgets.push(options.maxTokens)
      if (!messages[0]!.content.includes('Keep the JSON compact')) {
        throw new OutputTruncatedError(options.maxTokens)
      }
      return { data: { hints: ['Try the zero vector.'], solution: 'Test closure and the zero vector.' }, raw: {} }
    })
    const service = new HomeworkService({ db, ai: { streamJSON, maxOutputTokens: 32_000 } as unknown as AIService })

    const result = await service.generateContent(row.id)
    expect(result?.generationStatus).toBe('ready')
    expect(result?.solution).toContain('Test closure')
    expect(result?.draftText).toBe('my working')
    expect(result?.messages).toEqual(row.messages)
    expect(budgets.some((budget) => budget > 8_192)).toBe(true)
  })

  it('prepares hints and solution separately when a combined response remains truncated', async () => {
    const modes: string[] = []
    const streamJSON = vi.fn(async (messages: Array<{ content: string }>, _delta: unknown, options: { maxTokens: number }) => {
      const system = messages[0]!.content
      if (system.includes('one field: {"hints"')) {
        modes.push('hints')
        return { data: { hints: ['First identify the zero vector.', 'Then test closure.'] }, raw: {} }
      }
      if (system.includes('one field: {"solution"')) {
        modes.push('solution')
        return { data: { solution: 'The zero vector belongs; test addition and scalar multiplication.' }, raw: {} }
      }
      modes.push('combined')
      throw new OutputTruncatedError(options.maxTokens)
    })
    const service = new HomeworkService({ db, ai: { streamJSON, maxOutputTokens: 4_096 } as unknown as AIService })

    const result = await service.generateContent(row.id)
    expect(modes).toContain('hints')
    expect(modes).toContain('solution')
    expect(result).toMatchObject({
      generationStatus: 'ready', draftText: 'my working', revealedHints: 1,
      solutionRevealed: true,
    })
    expect(result?.hints).toHaveLength(2)
    expect(result?.messages).toEqual(row.messages)
  })

  it('splits a long multi-part exercise and completes each part with a compact reply', async () => {
    row.prompt = 'Decide whether each set is a subspace: (a) the zero set. (b) a line through the origin.'
    await db.homeworkQuestions.put(row)
    const streamJSON = vi.fn(async (messages: Array<{ content: string }>, _delta: unknown, options: { maxTokens: number }) => {
      const user = messages[1]!.content
      if (user.includes('(a)') && user.includes('(b)')) throw new OutputTruncatedError(options.maxTokens)
      if (!messages[0]!.content.includes('Keep the JSON compact')) throw new OutputTruncatedError(options.maxTokens)
      return { data: { hints: ['Check closure.'], solution: 'It is closed under both operations.' }, raw: {} }
    })
    const service = new HomeworkService({ db, ai: { streamJSON, maxOutputTokens: 4_096 } as unknown as AIService })

    const result = await service.generateContent(row.id)
    expect(result?.generationStatus).toBe('ready')
    expect(result?.solution).toContain('### (a)')
    expect(result?.solution).toContain('### (b)')
    expect(result?.draftText).toBe('my working')
  })

  it('keeps previous help and student work if the provider also rejects a smaller output limit', async () => {
    const streamJSON = vi.fn(async (_messages: unknown, _delta: unknown, options: { maxTokens: number }) => {
      if (options.maxTokens > 1_024) throw new OutputLimitError()
      throw new OutputTruncatedError(options.maxTokens)
    })
    const service = new HomeworkService({ db, ai: { streamJSON, maxOutputTokens: 4_096 } as unknown as AIService })

    const result = await service.generateContent(row.id)
    expect(result?.generationStatus).toBe('failed')
    expect(result?.hints).toEqual(['old hint'])
    expect(result?.solution).toBe('old solution')
    expect(result?.draftText).toBe('my working')
    expect(result?.messages).toEqual(row.messages)
    expect(streamJSON.mock.calls.length).toBeLessThanOrEqual(7)
  })
})
