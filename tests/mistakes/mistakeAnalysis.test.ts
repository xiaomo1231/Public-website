import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { MistakeService } from '@/services/mistakeService'
import { MistakeAnalysisService, normalizeAnalysis } from '@/services/mistakeAnalysisService'
import { ProjectService } from '@/services/projectService'
import type { AIService } from '@/services/aiService'

function fakeAI(chatJSON: ReturnType<typeof vi.fn>): AIService {
  return {
    chatJSON,
    chat: vi.fn(),
    streamChat: vi.fn(),
    testConnection: vi.fn(),
    reset: vi.fn(),
    currentProvider: {},
  } as unknown as AIService
}

const validOutput = {
  whereWrong: 'The derivative of the outer function was applied without the inner factor.',
  firstError: 'The factor 2 from the inner function 2x is missing.',
  whyWrong: 'The chain rule requires multiplying by the derivative of the inner function.',
  correctApproach: 'Differentiate sin(2x) as cos(2x) · 2 = 2cos(2x).',
  possibleCause: 'This may indicate the chain rule is not yet automatic.',
  mistakeType: 'formula' as const,
  reviewKnowledgePoints: ['Chain Rule'],
  shouldPracticeMore: true,
  similarExample: {
    prompt: 'Differentiate cos(3x)',
    answer: '-3sin(3x)',
    explanation: 'Same pattern.',
  },
  continuePrompt: 'Would you like to try a similar question?',
}

describe('normalizeAnalysis', () => {
  it('accepts a well-formed analysis', () => {
    const a = normalizeAnalysis(validOutput)
    expect(a.mistakeType).toBe('formula')
    expect(a.reviewKnowledgePoints).toEqual(['Chain Rule'])
    expect(a.similarExample?.prompt).toBe('Differentiate cos(3x)')
    expect(a.promptVersion).toBe('v2')
  })

  it('falls back to unknown for an invalid mistake type', () => {
    const a = normalizeAnalysis({ ...validOutput, mistakeType: 'bogus' as never })
    expect(a.mistakeType).toBe('unknown')
  })

  it('supplies neutral defaults for missing fields', () => {
    const a = normalizeAnalysis({})
    expect(a.whereWrong).toBeTruthy()
    expect(a.firstError).toBeTruthy()
    expect(a.correctApproach).toBeTruthy()
    expect(a.possibleCause).toBeTruthy()
    expect(a.reviewKnowledgePoints).toEqual([])
    expect(a.similarExample).toBeUndefined()
  })

  it('rewrites any careless-style wording', () => {
    const a = normalizeAnalysis({ ...validOutput, possibleCause: 'The student was careless.' })
    expect(a.possibleCause.toLowerCase()).not.toContain('careless')
    expect(a.possibleCause).toMatch(/possible cause|explore/i)
  })

  it('removes Chinese judgemental wording from every text field', () => {
    const a = normalizeAnalysis({
      ...validOutput,
      possibleCause: '学生太粗心了。',
      whyWrong: '链式法则需要乘以内层导数。这里是马虎导致的。',
      firstError: 'The student was just lazy here. The factor 2 is missing.',
      correctApproach: '不认真审题，应先求内层导数。',
      continuePrompt: '下次别再不仔细了！',
      similarExample: {
        prompt: 'Differentiate cos(3x)',
        answer: '-3sin(3x)',
        explanation: '懒得写中间步骤会出错。',
      },
      reviewKnowledgePoints: ['Chain Rule', '粗心'],
    })
    const text = [
      a.possibleCause,
      a.whyWrong,
      a.firstError,
      a.correctApproach,
      a.continuePrompt,
      a.similarExample?.explanation ?? '',
      ...a.reviewKnowledgePoints,
    ].join(' ')
    expect(text).not.toMatch(/粗心|马虎|不认真|不仔细|懒|lazy|careless/i)
    // Unrelated sentences survive; nothing English-only like "unclear" is spliced in.
    expect(a.whyWrong).toContain('链式法则需要乘以内层导数。')
    expect(a.firstError).toContain('The factor 2 is missing.')
    expect(text).not.toContain('unclear')
    expect(a.reviewKnowledgePoints).toEqual(['Chain Rule'])
  })

  it('keeps technical terms such as lazy evaluation', () => {
    const a = normalizeAnalysis({
      ...validOutput,
      whyWrong: 'Lazy evaluation delays the call. x = 3.14 here.',
    })
    expect(a.whyWrong).toBe('Lazy evaluation delays the call. x = 3.14 here.')
  })

  it('handles a null response', () => {
    const a = normalizeAnalysis(null)
    expect(a.mistakeType).toBe('unknown')
    expect(a.shouldPracticeMore).toBe(false)
  })
})

describe('MistakeAnalysisService', () => {
  let db: AppDatabase
  let mistakes: MistakeService

  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
    mistakes = new MistakeService(db)
  })

  async function seedMistake() {
    const projects = new ProjectService(db)
    const p = await projects.create({ name: 'P', subject: 'calculus' })
    const m = await mistakes.addManual({
      projectId: p.id,
      question: 'Differentiate sin(2x)',
      studentAnswer: 'cos(2x)',
      correctAnswer: '2cos(2x)',
      knowledgePoint: 'Chain Rule',
    })
    return { project: p, mistake: m }
  }

  it('analyses a mistake and persists the result', async () => {
    const { mistake } = await seedMistake()
    const chatJSON = vi
      .fn()
      .mockResolvedValue({ data: validOutput, raw: { content: '{}', model: 'm' } })
    const svc = new MistakeAnalysisService({ ai: fakeAI(chatJSON), mistakes })
    const updated = await svc.analyze(mistake.id)
    expect(updated.analysisStatus).toBe('ready')
    expect(updated.mistakeType).toBe('formula')
    expect(updated.analysis?.firstError).toMatch(/factor 2/)
  })

  it('records failure state when the AI call throws', async () => {
    const { mistake } = await seedMistake()
    const chatJSON = vi.fn().mockRejectedValue(new Error('rate limited'))
    const svc = new MistakeAnalysisService({ ai: fakeAI(chatJSON), mistakes })
    await expect(svc.analyze(mistake.id)).rejects.toThrow(/rate limited/)
    const after = await mistakes.get(mistake.id)
    expect(after!.analysisStatus).toBe('failed')
    expect(after!.analysisError).toMatch(/rate limited/)
  })

  it('explains without persisting', async () => {
    const { mistake } = await seedMistake()
    const chatJSON = vi
      .fn()
      .mockResolvedValue({ data: validOutput, raw: { content: '{}', model: 'm' } })
    const svc = new MistakeAnalysisService({ ai: fakeAI(chatJSON), mistakes })
    const analysis = await svc.explain(mistake)
    expect(analysis.firstError).toBeTruthy()
    const stored = await mistakes.get(mistake.id)
    expect(stored!.analysisStatus).toBe('pending')
  })

  it('throws NOT_FOUND for an unknown mistake id', async () => {
    const svc = new MistakeAnalysisService({ ai: fakeAI(vi.fn()), mistakes })
    await expect(svc.analyze('missing')).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('handles malformed AI output without crashing', async () => {
    const { mistake } = await seedMistake()
    const chatJSON = vi
      .fn()
      .mockResolvedValue({ data: { junk: true }, raw: { content: '{}', model: 'm' } })
    const svc = new MistakeAnalysisService({ ai: fakeAI(chatJSON), mistakes })
    // Nothing usable: no placeholder-only analysis is saved, the card says why.
    await expect(svc.analyze(mistake.id)).rejects.toThrow()
    const failed = await mistakes.get(mistake.id)
    expect(failed?.analysisStatus).toBe('failed')
    expect(failed?.analysis).toBeUndefined()
    expect(failed?.analysisError).toBeTruthy()

    // A partial reply is completed with neutral defaults.
    chatJSON.mockResolvedValue({
      data: { whyWrong: 'The sign of the derivative was dropped.', mistakeType: 'bogus' },
      raw: { content: '{}', model: 'm' },
    })
    const updated = await svc.analyze(mistake.id)
    expect(updated.analysisStatus).toBe('ready')
    expect(updated.analysis?.mistakeType).toBe('unknown')
    expect(updated.analysis?.possibleCause).toBeTruthy()
  })
})
