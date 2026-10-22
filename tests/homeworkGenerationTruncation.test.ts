import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { HomeworkService } from '@/services/homeworkService'
import type { HomeworkQuestion } from '@/entities/homework/types'
import type { AIService } from '@/services/aiService'
import { OutputLimitError, OutputTruncatedError } from '@/infrastructure/ai/errors'

const PROMPT =
  'Problem 6: Consider a vector space and determine whether each stated subset is a subspace. '.repeat(
    5,
  )

describe('homework help after model output stops early', () => {
  let db: AppDatabase
  let row: HomeworkQuestion

  beforeEach(async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    row = {
      id: crypto.randomUUID(),
      projectId: 'project-1',
      setId: 'set-1',
      documentId: 'document-1',
      documentName: 'hw.pdf',
      order: 0,
      prompt: PROMPT,
      sourceRefs: [],
      hints: ['old hint'],
      solution: 'old solution',
      generationStatus: 'ready',
      promptVersion: 'v1',
      draftText: 'my working',
      revealedHints: 1,
      solutionRevealed: true,
      messages: [{ id: 'm1', role: 'student', content: 'my question', createdAt: 1 }],
      createdAt: 1,
      updatedAt: 1,
    }
    await db.homeworkQuestions.put(row)
  })

  it('never re-sends a combined reply cut off at the cap (no larger budget, no compact rewrite)', async () => {
    const calls: Array<{ system: string; options: Record<string, unknown> }> = []
    const streamJSON = vi.fn(
      async (
        messages: Array<{ content: string }>,
        _delta: unknown,
        options: Record<string, unknown> = {},
      ) => {
        const system = messages[0]!.content
        calls.push({ system, options })
        if (system.includes('one field: {"hints"'))
          return { data: { hints: ['Try the zero vector.'] }, raw: {} }
        if (system.includes('one field: {"solution"'))
          return { data: { solution: 'Test closure and the zero vector.' }, raw: {} }
        throw new OutputTruncatedError()
      },
    )
    const service = new HomeworkService({
      db,
      ai: { streamJSON, maxOutputTokens: 32_000 } as unknown as AIService,
    })

    const result = await service.generateContent(row.id)
    expect(result?.generationStatus).toBe('ready')
    expect(result?.solution).toContain('Test closure')
    expect(result?.draftText).toBe('my working')
    expect(result?.messages).toEqual(row.messages)
    // Combined once, then the hints / solution stages.
    expect(calls).toHaveLength(3)
    expect(calls.some((call) => call.system.includes('Keep the JSON compact'))).toBe(false)
    expect(calls.every((call) => !('maxTokens' in call.options))).toBe(true)
  })

  it('prepares hints and solution separately when a combined response remains truncated', async () => {
    const modes: string[] = []
    const streamJSON = vi.fn(
      async (
        messages: Array<{ content: string }>,
        _delta: unknown,
        options: { maxTokens: number },
      ) => {
        const system = messages[0]!.content
        if (system.includes('one field: {"hints"')) {
          modes.push('hints')
          return {
            data: { hints: ['First identify the zero vector.', 'Then test closure.'] },
            raw: {},
          }
        }
        if (system.includes('one field: {"solution"')) {
          modes.push('solution')
          return {
            data: { solution: 'The zero vector belongs; test addition and scalar multiplication.' },
            raw: {},
          }
        }
        modes.push('combined')
        throw new OutputTruncatedError(options.maxTokens)
      },
    )
    const service = new HomeworkService({
      db,
      ai: { streamJSON, maxOutputTokens: 4_096 } as unknown as AIService,
    })

    const result = await service.generateContent(row.id)
    expect(modes).toContain('hints')
    expect(modes).toContain('solution')
    expect(result).toMatchObject({
      generationStatus: 'ready',
      draftText: 'my working',
      revealedHints: 1,
      solutionRevealed: true,
    })
    expect(result?.hints).toHaveLength(2)
    expect(result?.messages).toEqual(row.messages)
  })

  it('splits a long multi-part exercise cut off at the cap and completes each part', async () => {
    row.prompt =
      'Decide whether each set is a subspace: (a) the zero set. (b) a line through the origin.'
    await db.homeworkQuestions.put(row)
    const streamJSON = vi.fn(
      async (
        messages: Array<{ content: string }>,
        _delta: unknown,
        options: { maxTokens: number },
      ) => {
        const user = messages[1]!.content
        if (user.includes('(a)') && user.includes('(b)'))
          throw new OutputTruncatedError(options.maxTokens)
        return {
          data: { hints: ['Check closure.'], solution: 'It is closed under both operations.' },
          raw: {},
        }
      },
    )
    const service = new HomeworkService({
      db,
      ai: { streamJSON, maxOutputTokens: 4_096 } as unknown as AIService,
    })

    const result = await service.generateContent(row.id)
    expect(result?.generationStatus).toBe('ready')
    expect(result?.solution).toContain('### (a)')
    expect(result?.solution).toContain('### (b)')
    expect(result?.draftText).toBe('my working')
  })

  it('keeps previous help and student work when the provider rejects the output limit', async () => {
    // The limit is probed inside AIService; a rejection reaching the service
    // is final for this question (no smaller budget of its own).
    const streamJSON = vi.fn(async () => {
      throw new OutputLimitError()
    })
    const service = new HomeworkService({
      db,
      ai: { streamJSON, maxOutputTokens: 4_096 } as unknown as AIService,
    })

    const result = await service.generateContent(row.id)
    expect(result?.generationStatus).toBe('failed')
    expect(result?.hints).toEqual(['old hint'])
    expect(result?.solution).toBe('old solution')
    expect(result?.draftText).toBe('my working')
    expect(result?.messages).toEqual(row.messages)
    expect(streamJSON).toHaveBeenCalledTimes(1)
  })
})
