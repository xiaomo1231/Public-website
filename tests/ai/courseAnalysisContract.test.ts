import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { DocumentAnalysisService } from '@/services/documentAnalysisService'
import { extractJSON } from '@/infrastructure/ai/openaiCompatible'
import { stripThinkBlocks } from '@/infrastructure/ai/responseText'
import { prompts } from '@/infrastructure/ai/prompts'
import type { AIService } from '@/services/aiService'
import type { ChatMessage } from '@/infrastructure/ai/types'

/**
 * End-to-end contract for the Course Analysis AI response.
 *
 * Unlike the service unit tests (which mock `streamJSON`), these feed the raw
 * model text through the *real* extraction pipeline
 * (`stripThinkBlocks` → `extractJSON`), so a regression in JSON handling is
 * caught here rather than surfacing as a misleading schema error in the UI.
 */

const VALID_ANALYSIS = JSON.stringify({
  language: 'en',
  topics: [
    {
      name: 'Derivatives',
      description: 'Rates of change',
      sourceChunkIds: [],
      sourceRefs: [{ documentName: 'intro.txt' }],
    },
  ],
  concepts: [],
  formulas: [],
  symbols: [],
  examples: [],
  exercises: [],
  prerequisites: [],
})

/** The exact shape from the reported bug: a single topic, no collections. */
const TOPIC_ONLY = JSON.stringify({
  name: 'Derivatives',
  description: 'Rates of change',
  sourceChunkIds: ['chunk-1'],
  sourceRefs: [{ documentName: 'intro.txt' }],
})

function rawAI(raw: string): { ai: AIService; streamJSON: ReturnType<typeof vi.fn> } {
  const streamJSON = vi.fn(async (messages: ChatMessage[]) => {
    // Mirror AIService.streamJSON: hidden reasoning is stripped before parsing.
    void messages
    const content = stripThinkBlocks(raw)
    const data = extractJSON(content)
    return { data, raw: { content, model: 'test-model', finishReason: 'stop' } }
  })
  const ai = {
    streamJSON,
    maxOutputTokens: 2048,
    currentProvider: { id: 'custom' },
  } as unknown as AIService
  return { ai, streamJSON }
}

describe('Course Analysis response contract', () => {
  let db: AppDatabase
  let projectId: string
  let docs: DocumentRepository
  let chunks: ChunkRepository
  let analyses: CourseAnalysisRepository
  let projects: ProjectService

  beforeEach(async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    projects = new ProjectService(db)
    const project = await projects.create({ name: 'Calc', subject: 'calculus' })
    projectId = project.id

    docs = new DocumentRepository(db)
    const doc = await docs.create({ projectId, type: 'text', name: 'intro.txt', sizeBytes: 0 })
    await docs.update(doc.id, { status: 'ready' })
    chunks = new ChunkRepository(db)
    await chunks.addMany([
      {
        documentId: doc.id,
        projectId,
        contentType: 'paragraph',
        text: 'Derivatives are rates of change.',
        sourceReference: 'intro.txt',
        order: 0,
      },
    ])
    analyses = new CourseAnalysisRepository(db)
  })

  function service(raw: string) {
    const { ai, streamJSON } = rawAI(raw)
    const svc = new DocumentAnalysisService({ ai, projects, db, documents: docs, chunks, analyses })
    return { svc, streamJSON }
  }

  it('parses a normal analysis response and stores the topics', async () => {
    const { svc } = service(VALID_ANALYSIS)
    await svc.analyzeProject(projectId)

    const analysis = await analyses.getByProject(projectId)
    expect(analysis?.status).toBe('ready')
    expect(analysis?.topicCount).toBe(1)
    const topics = await analyses.listTopics(projectId)
    expect(topics[0]?.name).toBe('Derivatives')
  })

  it('rejects a topic-shaped response instead of treating it as an analysis', async () => {
    const { svc } = service(TOPIC_ONLY)
    await expect(svc.analyzeProject(projectId)).rejects.toMatchObject({
      code: 'MALFORMED_ANALYSIS',
    })
  })

  it('parses a <think>-wrapped response', async () => {
    const { svc } = service(`<think>let me reason about this</think>\n\n${VALID_ANALYSIS}`)
    await svc.analyzeProject(projectId)
    expect((await analyses.getByProject(projectId))?.status).toBe('ready')
  })

  it('parses a markdown-fenced response', async () => {
    const { svc } = service('```json\n' + VALID_ANALYSIS + '\n```')
    await svc.analyzeProject(projectId)
    expect((await analyses.getByProject(projectId))?.status).toBe('ready')
  })

  it('recovers an analysis whose LaTeX backslashes were not escaped', async () => {
    // `\sqrt` is not a legal JSON escape; without repair the whole payload is
    // unparseable and the first topic would be mistaken for the document.
    const raw =
      '{"language":"en","topics":[{"name":"Roots","description":"Square roots","sourceChunkIds":[],"sourceRefs":[]}],"concepts":[],"formulas":[{"name":"Root","latex":"\\sqrt{x}","description":"square root","variables":[],"sourceRefs":[]}],"symbols":[],"examples":[],"exercises":[],"prerequisites":[]}'
    const { svc } = service(raw)
    await svc.analyzeProject(projectId)

    const analysis = await analyses.getByProject(projectId)
    expect(analysis?.status).toBe('ready')
    expect(analysis?.topicCount).toBe(1)
    const formulas = await analyses.listFormulas(projectId)
    expect(formulas[0]?.latex).toBe('\\sqrt{x}')
  })

  it('never accepts a nested topic from a malformed analysis', async () => {
    const raw =
      '{"language":"en","topics":[{"name":"Derivatives","description":"Rates","sourceChunkIds":[],"sourceRefs":[]}],"formulas":[{"name" "broken"}]}'
    const { svc } = service(raw)
    // A JSON error — not a bogus "0 topics" success and not a topic-shaped data.
    await expect(svc.analyzeProject(projectId)).rejects.toMatchObject({ code: 'INVALID_JSON' })
  })

  it('uses the document-analyzer contract', async () => {
    const { svc, streamJSON } = service(VALID_ANALYSIS)
    await svc.analyzeProject(projectId)

    const messages = streamJSON.mock.calls[0]?.[0] as ChatMessage[]
    expect(messages[0]?.role).toBe('system')
    expect(messages[0]?.content).toBe(prompts.documentAnalyzer.buildSystemPrompt())
    expect(messages[0]?.content).not.toMatch(/visualization/i)
    expect(prompts.documentAnalyzer.PROMPT_KIND).toBe('document-analyzer')
  })
})
