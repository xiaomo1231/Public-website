import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { ProjectService } from '@/services/projectService'
import { DocumentAnalysisService } from '@/services/documentAnalysisService'
import {
  legacyInputWasTruncated,
  planAnalysisSegments,
  segmentText,
  type AnalysisInputDocument,
} from '@/entities/courseContent/analysisInput'
import { buildCandidateChunkLabel } from '@/entities/courseContent/topicDependency'
import { mergeDocumentAnalyses } from '@/entities/courseAnalysis/mergeAnalyses'
import { evaluateFreshness, type CourseContentVersions } from '@/entities/courseContent/types'
import type { DocumentChunk } from '@/entities/chunk/types'
import type { DocumentAnalysisOutput } from '@/infrastructure/ai/prompts/types'
import type { AIService } from '@/services/aiService'
import type { ChatMessage } from '@/infrastructure/ai/types'

function chunk(id: string, text: string, order: number, chapter?: number, section?: string): DocumentChunk {
  return {
    id,
    documentId: 'doc',
    projectId: 'p',
    contentType: 'paragraph',
    text,
    sourceReference: 'book.pdf',
    order,
    createdAt: 0,
    ...(chapter !== undefined ? { chapterId: `ch${chapter}`, chapterNumber: String(chapter) } : {}),
    ...(section ? { sectionId: section } : {}),
  }
}

const plain = (c: DocumentChunk) => c.text

describe('planning the analysis parts', () => {
  it('keeps a course that fits in one request, in the old input format', () => {
    const doc: AnalysisInputDocument = { id: 'doc', name: 'book.pdf', chunks: [chunk('a', 'one', 0, 1), chunk('b', 'two', 1, 2)] }
    const format = (c: DocumentChunk) => `[${buildCandidateChunkLabel(c)}] ${c.text}`
    const segments = planAnalysisSegments([doc], format)
    expect(segments).toHaveLength(1)
    expect(segmentText(segments[0]!, format)).toBe('=== doc ===\n[c:a · Ch 1] one\n\n[c:b · Ch 2] two')
    expect(segments[0]!.label).toBe('Ch 1 – Ch 2')
  })

  it('packs whole chapters into parts and never drops a chunk', () => {
    const chunks = [1, 2, 3, 4].flatMap((ch) => [0, 1].map((i) => chunk(`c${ch}${i}`, 'x'.repeat(20), ch * 10 + i, ch)))
    // Each chapter is 2 × (20 + 2) = 44 characters; two chapters fit in 100.
    const segments = planAnalysisSegments([{ id: 'doc', name: 'book.pdf', chunks }], plain, 100)
    expect(segments.map((s) => s.chapterIds)).toEqual([['ch1', 'ch2'], ['ch3', 'ch4']])
    expect(segments.flatMap((s) => s.documents.flatMap((d) => d.chunks.map((c) => c.id)))).toEqual(chunks.map((c) => c.id))
    expect(segments[1]!.label).toBe('Ch 3 – Ch 4')
  })

  it('splits a chapter that is too long by section, then by chunk', () => {
    const chunks = [
      ...[0, 1, 2].map((i) => chunk(`s1-${i}`, 'x'.repeat(28), i, 1, '1.1')),
      ...[0, 1, 2, 3, 4, 5].map((i) => chunk(`s2-${i}`, 'x'.repeat(28), 10 + i, 1, '1.2')),
    ]
    // Section 1.1 is 90 characters and fits; 1.2 (180) is cut every three chunks.
    const segments = planAnalysisSegments([{ id: 'doc', name: 'book.pdf', chunks }], plain, 100)
    expect(segments.map((s) => s.documents[0]!.chunks.map((c) => c.id))).toEqual([
      ['s1-0', 's1-1', 's1-2'],
      ['s2-0', 's2-1', 's2-2'],
      ['s2-3', 's2-4', 's2-5'],
    ])
    // All three parts belong to chapter 1, so topics they share are merged.
    expect(segments.every((s) => s.chapterIds.join() === 'ch1')).toBe(true)
  })

  it('recognises material the old single request would have cut short', () => {
    const short = [{ id: 'doc', name: 'n', chunks: [chunk('a', 'text', 0)] }]
    expect(legacyInputWasTruncated(short)).toBe(false)
    const manyChunks = [{ id: 'doc', name: 'n', chunks: Array.from({ length: 201 }, (_, i) => chunk(`c${i}`, 't', i)) }]
    expect(legacyInputWasTruncated(manyChunks)).toBe(true)
    const longText = [{ id: 'doc', name: 'n', chunks: Array.from({ length: 60 }, (_, i) => chunk(`c${i}`, 'x'.repeat(900), i)) }]
    expect(legacyInputWasTruncated(longText)).toBe(true)
  })
})

function analysis(partial: Partial<DocumentAnalysisOutput>): DocumentAnalysisOutput {
  return { language: 'zh', topics: [], concepts: [], formulas: [], symbols: [], examples: [], exercises: [], prerequisites: [], ...partial }
}

const ref = (page: number) => ({ documentId: '', documentName: 'book.pdf', page })

describe('merging the parts', () => {
  it('combines repeated concepts, formulas and symbols', () => {
    const merged = mergeDocumentAnalyses([
      {
        label: 'Ch 1',
        chapterIds: ['ch1'],
        output: analysis({
          topics: [{ name: '导数', description: 'd', sourceRefs: [] }],
          concepts: [{ name: '导数', definition: '变化率', topicNames: ['导数'], sourceRefs: [ref(1)] }],
          formulas: [{ name: 'f', latex: 'f\'(x) = \\lim', description: '', variables: [], sourceRefs: [ref(1)] }],
        }),
      },
      {
        label: 'Ch 2',
        chapterIds: ['ch2'],
        output: analysis({
          topics: [{ name: '积分', description: 'i', sourceRefs: [] }],
          concepts: [{ name: ' 导数 ', definition: '另一种说法', topicNames: ['积分'], sourceRefs: [ref(9)] }],
          formulas: [{ name: 'f', latex: "f'(x)=\\lim", description: '', variables: [], sourceRefs: [ref(9)] }],
        }),
      },
    ])
    expect(merged.topics.map((t) => t.name)).toEqual(['导数', '积分'])
    expect(merged.concepts).toHaveLength(1)
    expect(merged.concepts[0]).toMatchObject({ definition: '变化率', topicNames: ['导数', '积分'] })
    expect(merged.concepts[0]!.sourceRefs.map((r) => r.page)).toEqual([1, 9])
    expect(merged.formulas).toHaveLength(1)
  })

  it('merges a topic split across parts of one chapter, and renames a reused name elsewhere', () => {
    const summary = (chunkId: string) => ({ name: '本章小结', description: 's', sourceRefs: [], sourceChunkIds: [chunkId] })
    const merged = mergeDocumentAnalyses([
      { label: 'Ch 1', chapterIds: ['ch1'], output: analysis({ topics: [summary('a')] }) },
      { label: 'Ch 1', chapterIds: ['ch1'], output: analysis({ topics: [summary('b')] }) },
      {
        label: 'Ch 2',
        chapterIds: ['ch2'],
        output: analysis({
          topics: [summary('c')],
          examples: [{ title: 'e', problem: 'p', topicNames: ['本章小结'], sourceRefs: [] }],
        }),
      },
    ])
    expect(merged.topics.map((t) => t.name)).toEqual(['本章小结', '本章小结 · Ch 2'])
    expect(merged.topics[0]!.sourceChunkIds).toEqual(['a', 'b'])
    expect(merged.examples[0]!.topicNames).toEqual(['本章小结 · Ch 2'])
  })
})

describe('freshness of analyses written before parts', () => {
  const current: CourseContentVersions = { sourceHash: 'h', promptVersion: 'v', schemaVersion: '1', structureVersion: 0, structureHash: '' }
  const saved = { sourceHash: 'h', promptVersion: 'v', schemaVersion: '1', status: 'ready' as const }

  it('re-analyses only courses the old limits cut short', () => {
    expect(evaluateFreshness(saved, current).fresh).toBe(true)
    expect(evaluateFreshness(saved, { ...current, legacyInputTruncated: true }).reasons).toEqual(['input-truncated'])
    expect(evaluateFreshness({ ...saved, inputCoverage: 'complete' }, { ...current, legacyInputTruncated: true }).fresh).toBe(true)
  })
})

describe('analysing a long textbook', () => {
  let db: AppDatabase
  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
  })

  /** Answers each part with one topic built from the first chunk it was shown. */
  function partAI(fail?: number) {
    let calls = 0
    const streamJSON = vi.fn(async (messages: ChatMessage[]) => {
      calls++
      if (calls === fail) throw new Error('provider down')
      const user = messages[1]!.content
      const firstChunk = /\[c:([^\s\]·]+)/.exec(user)![1]!
      const part = /This is part (\d+) of/.exec(user)?.[1] ?? '1'
      return {
        data: {
          language: 'en',
          topics: [{ name: `Topic ${part}`, description: 'd', sourceChunkIds: [firstChunk], sourceRefs: [] }],
          concepts: [{ name: 'Limit', definition: `from part ${part}`, topicNames: [`Topic ${part}`], sourceRefs: [] }],
        },
        raw: { content: '{}', finishReason: 'stop', model: 'm' },
      }
    })
    const ai = { streamJSON, chatJSON: vi.fn(), currentProvider: { id: 'custom' }, maxOutputTokens: 2048 } as unknown as AIService
    return { ai, streamJSON }
  }

  async function seedBook(chapters: number, chunksPerChapter: number, chars: number) {
    const projects = new ProjectService(db)
    const p = await projects.create({ name: 'Anatomy', subject: 'medicine' })
    const docs = new DocumentRepository(db)
    const doc = await docs.create({ projectId: p.id, type: 'pdf', name: 'atlas.pdf', sizeBytes: 1 })
    await docs.update(doc.id, { status: 'ready' })
    await new ChunkRepository(db).addMany(
      Array.from({ length: chapters * chunksPerChapter }, (_, i) => {
        const ch = Math.floor(i / chunksPerChapter) + 1
        return {
          documentId: doc.id,
          projectId: p.id,
          contentType: 'paragraph' as const,
          text: `Chapter ${ch} passage ${i} `.padEnd(chars, 'x'),
          sourceReference: 'atlas.pdf',
          order: i,
          chapterId: `ch-${ch}`,
          chapterNumber: String(ch),
        }
      }),
    )
    return { projects, projectId: p.id }
  }

  function service(projects: ProjectService, ai: AIService) {
    return new DocumentAnalysisService({ ai, projects, db })
  }

  it('sends every chapter, in parts, and stores the merged result', async () => {
    // 4 chapters × 60 chunks × ~500 characters: 240 chunks, far beyond the old cut.
    const { projects, projectId } = await seedBook(4, 60, 500)
    const { ai, streamJSON } = partAI()
    const progress: string[] = []
    await service(projects, ai).analyzeProject(projectId, { onProgress: (p) => p.message && progress.push(p.message) })

    expect(streamJSON).toHaveBeenCalledTimes(4)
    const users = streamJSON.mock.calls.map((call) => (call[0] as ChatMessage[])[1]!.content)
    const parts = users.map((u) => /This is part (\d) of 4 of the course material \((Ch \d+)\)/.exec(u)?.slice(1).join(' '))
    expect(parts.sort()).toEqual(['1 Ch 1', '2 Ch 2', '3 Ch 3', '4 Ch 4'])
    expect(users.some((u) => u.includes('Chapter 4 passage 239'))).toBe(true)

    const analyses = new CourseAnalysisRepository(db)
    const topics = await analyses.listTopics(projectId)
    expect(topics.map((t) => t.name).sort()).toEqual(['Topic 1', 'Topic 2', 'Topic 3', 'Topic 4'])
    // The last part's topic depends on a chunk the old cut never sent.
    const last = topics.find((t) => t.name === 'Topic 4')!
    expect(last.sourceChunkIds).toHaveLength(1)
    expect(last.chapterId).toBe('ch-4')
    expect(await analyses.listConcepts(projectId)).toHaveLength(1)
    expect(await analyses.getByProject(projectId)).toMatchObject({ status: 'ready', inputCoverage: 'complete', inputParts: 4 })
    expect(progress).toContain('Asking AI to extract knowledge (part 4 of 4)')
  })

  it('analyses a short course in one request with the unchanged prompt', async () => {
    const { projects, projectId } = await seedBook(2, 3, 100)
    const { ai, streamJSON } = partAI()
    await service(projects, ai).analyzeProject(projectId)
    expect(streamJSON).toHaveBeenCalledTimes(1)
    expect((streamJSON.mock.calls[0]![0] as ChatMessage[])[1]!.content).not.toContain('This is part')
    expect(await new CourseAnalysisRepository(db).getByProject(projectId)).toMatchObject({ inputCoverage: 'complete', inputParts: 1 })
  })

  it('stores nothing when one part fails, keeping the previous analysis', async () => {
    const { projects, projectId } = await seedBook(4, 60, 500)
    await service(projects, partAI().ai).analyzeProject(projectId)
    const before = await new CourseAnalysisRepository(db).listTopics(projectId)

    await expect(service(projects, partAI(3).ai).analyzeProject(projectId)).rejects.toThrow('provider down')
    const analyses = new CourseAnalysisRepository(db)
    expect((await analyses.listTopics(projectId)).map((t) => t.id)).toEqual(before.map((t) => t.id))
    expect(await analyses.getByProject(projectId)).toMatchObject({ status: 'ready', inputParts: 4 })
  })
})
