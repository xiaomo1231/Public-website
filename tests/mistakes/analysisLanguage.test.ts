import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { MistakeService } from '@/services/mistakeService'
import { MistakeAnalysisService } from '@/services/mistakeAnalysisService'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import type { AIService } from '@/services/aiService'
import type { ChatMessage } from '@/infrastructure/ai/types'

function fakeAI(): { ai: AIService; chatJSON: ReturnType<typeof vi.fn> } {
  const chatJSON = vi.fn(async (messages: ChatMessage[]) => {
    const user = messages.find((m) => m.role === 'user')?.content ?? ''
    return {
      data: {
        whereWrong: 'w',
        firstError: 'f',
        whyWrong: 'y',
        correctApproach: 'c',
        possibleCause: 'A possible cause is a sign slip.',
        mistakeType: 'sign',
        reviewKnowledgePoints: [],
        shouldPracticeMore: true,
        continuePrompt: 'Ready?',
        // Echo back which language instruction the prompt carried, so the
        // test can assert on it.
        _prompt: user,
      },
      raw: { content: '{}', model: 'fake' },
    }
  })
  return {
    ai: {
      chatJSON,
      chat: vi.fn(),
      streamChat: vi.fn(),
      testConnection: vi.fn(),
      reset: vi.fn(),
      currentProvider: {},
    } as unknown as AIService,
    chatJSON,
  }
}

describe('MistakeAnalysisService language', () => {
  let db: AppDatabase

  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
  })

  async function setup(language: 'zh' | 'en' | 'mixed' | null) {
    const projects = new ProjectService(db)
    const project = await projects.create({ name: 'Calculus', subject: 'calculus' })
    const analyses = new CourseAnalysisRepository(db)
    if (language) {
      await analyses.reseedProject(
        project.id,
        {
          topics: [{ name: 'Derivatives', description: '', sourceRefs: [] }],
          concepts: [],
          formulas: [],
          symbols: [],
          examples: [],
          exercises: [],
          prerequisites: [],
          topicsByName: new Map([['Derivatives', 't1']]),
          documentIds: [],
        },
        language,
      )
    }
    const mistakes = new MistakeService(db)
    const mistake = await mistakes.addManual({
      projectId: project.id,
      question: 'Q',
      studentAnswer: 'a',
      correctAnswer: 'b',
      knowledgePoint: 'Power Rule',
    })
    const { ai, chatJSON } = fakeAI()
    const service = new MistakeAnalysisService({ ai, mistakes, analyses })
    return { project, mistake, mistakes, service, chatJSON }
  }

  it('uses the project course-analysis language when it is English', async () => {
    const { project, service } = await setup('en')
    expect(await service.resolveLanguage(project.id)).toBe('en')
  })

  it('uses the project course-analysis language when it is Chinese', async () => {
    const { project, service } = await setup('zh')
    expect(await service.resolveLanguage(project.id)).toBe('zh')
  })

  it('follows a bilingual project', async () => {
    const { project, service } = await setup('mixed')
    expect(await service.resolveLanguage(project.id)).toBe('mixed')
  })

  it('falls back to English when the project has no analysis', async () => {
    const { project, service } = await setup(null)
    expect(await service.resolveLanguage(project.id)).toBe('en')
  })

  it('lets a caller override the language', async () => {
    const { project, service } = await setup('en')
    expect(await service.resolveLanguage(project.id, 'zh')).toBe('zh')
  })

  it('sends the project language to the AI prompt', async () => {
    const { mistake, service, chatJSON } = await setup('zh')
    await service.explain(mistake)
    const userPrompt = chatJSON.mock.calls[0]?.[0]?.find((m: ChatMessage) => m.role === 'user')?.content as string
    expect(userPrompt).toContain('Simplified Chinese')
  })

  it('sends the overridden language to the AI prompt', async () => {
    const { mistake, service, chatJSON } = await setup('en')
    await service.explain(mistake, { language: 'zh' })
    const userPrompt = chatJSON.mock.calls[0]?.[0]?.find((m: ChatMessage) => m.role === 'user')?.content as string
    expect(userPrompt).toContain('Simplified Chinese')
  })

  it('uses bilingual instructions for a mixed project', async () => {
    const { mistake, service, chatJSON } = await setup('mixed')
    await service.explain(mistake)
    const userPrompt = chatJSON.mock.calls[0]?.[0]?.find((m: ChatMessage) => m.role === 'user')?.content as string
    expect(userPrompt).toMatch(/English with key Chinese terms/i)
  })

  it('does not hardcode English for a Chinese project', async () => {
    const { mistake, service, chatJSON } = await setup('zh')
    await service.explain(mistake)
    const userPrompt = chatJSON.mock.calls[0]?.[0]?.find((m: ChatMessage) => m.role === 'user')?.content as string
    expect(userPrompt).not.toContain('Respond in: English.')
  })

  it('persists the analysis when invoked through analyze()', async () => {
    const { mistake, service, mistakes } = await setup('zh')
    const updated = await service.analyze(mistake.id)
    expect(updated.analysisStatus).toBe('ready')
    const stored = await mistakes.get(mistake.id)
    expect(stored!.analysis?.mistakeType).toBe('sign')
  })
})
