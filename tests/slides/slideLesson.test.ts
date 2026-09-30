import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { VisualSourceRepository } from '@/entities/visualSource/repository'
import {
  SlideLessonService,
  buildSlideMaterial,
  normalizeSlideLessonOutput,
} from '@/services/slideLessonService'
import { computeSlideContentHash } from '@/entities/slideLesson/contentHash'
import type { AIService } from '@/services/aiService'
import type { DocumentChunk } from '@/entities/chunk/types'

type StubMessage = { role: string; content: string }

/** A tiny AI stand-in that branches on the system prompt. */
function stubAI(handler: (system: string, user: string) => unknown, chatReply = 'Answer.') {
  const chatJSON = vi.fn(async (messages: StubMessage[]) => ({
    data: await handler(messages[0]?.content ?? '', messages[1]?.content ?? ''),
    raw: { model: 'fake' },
  }))
  const chat = vi.fn(async () => ({ content: chatReply, model: 'fake' }))
  return { ai: { chatJSON, chat } as unknown as AIService, chatJSON, chat }
}

describe('buildSlideMaterial', () => {
  function chunk(partial: Partial<DocumentChunk>): DocumentChunk {
    return {
      id: partial.id ?? 'c',
      documentId: 'd',
      projectId: 'p',
      contentType: 'paragraph',
      text: '',
      sourceReference: 'x',
      order: 0,
      createdAt: 0,
      ...partial,
    } as DocumentChunk
  }

  it('separates title, body and speaker notes', () => {
    const result = buildSlideMaterial([
      chunk({ id: 'a', contentType: 'heading', text: 'Derivatives', order: 0 }),
      chunk({ id: 'b', contentType: 'paragraph', text: 'The slope of the tangent.', order: 1 }),
      chunk({ id: 'c', contentType: 'note', text: 'Mention the limit definition.', order: 2 }),
    ])
    expect(result.title).toBe('Derivatives')
    expect(result.text).toContain('slope of the tangent')
    expect(result.notes).toContain('limit definition')
    expect(result.material).toContain('Speaker notes:')
    expect(result.material).toContain('Title: Derivatives')
    expect(result.material).not.toContain('Mention the limit definition.\nSpeaker')
  })

  it('returns an empty material for a slide with no text', () => {
    const result = buildSlideMaterial([])
    expect(result.material).toBe('')
    expect(result.title).toBeUndefined()
  })
})

describe('normalizeSlideLessonOutput', () => {
  it('accepts a complete payload', () => {
    expect(normalizeSlideLessonOutput({ explanation: 'x', question: 'y' })).toEqual({
      explanation: 'x',
      question: 'y',
    })
  })
  it('rejects a missing question or explanation', () => {
    expect(() => normalizeSlideLessonOutput({ explanation: 'x' })).toThrow()
    expect(() => normalizeSlideLessonOutput({ question: 'y' })).toThrow()
    expect(() => normalizeSlideLessonOutput(null)).toThrow()
  })
})

describe('computeSlideContentHash', () => {
  const base = { material: 'Title: A', promptVersion: 'v1', language: 'en', hasImage: false }
  it('is stable for identical input', () => {
    expect(computeSlideContentHash(base)).toBe(computeSlideContentHash({ ...base }))
  })
  it('changes when the slide content changes', () => {
    expect(computeSlideContentHash(base)).not.toBe(
      computeSlideContentHash({ ...base, material: 'Title: B' }),
    )
  })
  it('changes when the prompt version, language or image flag changes', () => {
    expect(computeSlideContentHash(base)).not.toBe(
      computeSlideContentHash({ ...base, promptVersion: 'v2' }),
    )
    expect(computeSlideContentHash(base)).not.toBe(
      computeSlideContentHash({ ...base, language: 'zh' }),
    )
    expect(computeSlideContentHash(base)).not.toBe(
      computeSlideContentHash({ ...base, hasImage: true }),
    )
  })
})

describe('SlideLessonService', () => {
  let db: AppDatabase
  let projectId: string
  let documentId: string
  let chunks: ChunkRepository
  let visuals: VisualSourceRepository
  let slide1ChunkId: string

  beforeEach(async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    const project = await new ProjectService(db).create({ name: 'Calculus', subject: 'calculus' })
    projectId = project.id

    const documents = new DocumentRepository(db)
    const doc = await documents.create({
      projectId,
      type: 'pptx',
      name: 'Lecture 03.pptx',
      sizeBytes: 0,
    })
    await documents.update(doc.id, { status: 'ready', metadata: { slideCount: 10 } })
    documentId = doc.id

    chunks = new ChunkRepository(db)
    const stored = await chunks.addMany([
      { documentId, projectId, pageNumber: 1, contentType: 'heading', text: 'Limits', sourceReference: 'x', order: 0 },
      { documentId, projectId, pageNumber: 1, contentType: 'paragraph', text: 'The limit of x^2 at 3 is 9.', sourceReference: 'x', order: 1 },
      { documentId, projectId, pageNumber: 1, contentType: 'note', text: 'Emphasise substitution.', sourceReference: 'x', order: 2 },
      { documentId, projectId, pageNumber: 2, contentType: 'heading', text: 'Derivatives', sourceReference: 'x', order: 3 },
      { documentId, projectId, pageNumber: 2, contentType: 'paragraph', text: 'The slope of the tangent line.', sourceReference: 'x', order: 4 },
      { documentId, projectId, pageNumber: 3, contentType: 'paragraph', text: 'A worked example.', sourceReference: 'x', order: 5 },
    ])
    slide1ChunkId = stored[1]!.id

    visuals = new VisualSourceRepository(db)
    const visual = {
      id: crypto.randomUUID(),
      projectId,
      documentId,
      pageNumber: 2,
      type: 'illustration' as const,
      caption: 'Image from slide 2.',
      sourceChunkIds: [stored[3]!.id],
      imageMimeType: 'image/png',
      createdAt: Date.now(),
    }
    await visuals.upsert(visual)
    await visuals.putImage(visual, new Uint8Array([1, 2, 3]).buffer, 'image/png')
  })

  function service(ai: AIService | null) {
    return new SlideLessonService({ ai, db, chunks, visuals })
  }

  const okHandler = () => ({ explanation: '## Limits\n\nA limit describes a value.', question: 'Why substitute?' })

  it('lists the presentation with its real slide count', async () => {
    const { ai } = stubAI(okHandler)
    const docs = await service(ai).listSlideDocuments(projectId)
    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({ ready: true, slideCount: 10 })
  })

  it('builds a slide index with titles and image flags', async () => {
    const { ai } = stubAI(okHandler)
    const index = await service(ai).buildIndex(documentId)
    expect(index.slideTotal).toBe(10)
    expect(index.slides).toHaveLength(10)
    const slide1 = index.slides.find((s) => s.slideNumber === 1)!
    expect(slide1.title).toBe('Limits')
    expect(slide1.hasText).toBe(true)
    expect(slide1.hasImage).toBe(false)
    const slide2 = index.slides.find((s) => s.slideNumber === 2)!
    expect(slide2.hasImage).toBe(true)
  })

  it('generates a grounded lesson and caches it', async () => {
    const { ai, chatJSON } = stubAI(okHandler)
    const svc = service(ai)
    const result = await svc.generate({ projectId, documentId, slideNumber: 1, language: 'en' })
    expect(result.fromCache).toBe(false)
    expect(result.lesson.status).toBe('ready')
    expect(result.lesson.content).toContain('limit')
    expect(result.lesson.question).toBe('Why substitute?')
    expect(result.lesson.sourceChunkIds).toContain(slide1ChunkId)
    expect(result.lesson.sourceRefs[0]!.chunkId).toBe(result.lesson.sourceChunkIds[0])
    expect(chatJSON).toHaveBeenCalledTimes(1)

    const again = await svc.generate({ projectId, documentId, slideNumber: 1, language: 'en' })
    expect(again.fromCache).toBe(true)
    expect(chatJSON).toHaveBeenCalledTimes(1)
  })

  it('invalidates the cache when the slide content changes', async () => {
    const { ai, chatJSON } = stubAI(okHandler)
    const svc = service(ai)
    await svc.generate({ projectId, documentId, slideNumber: 1, language: 'en' })
    await db.chunks.update(slide1ChunkId, { text: 'The limit of x^3 at 2 is 8.' })
    const result = await svc.generate({ projectId, documentId, slideNumber: 1, language: 'en' })
    expect(result.fromCache).toBe(false)
    expect(chatJSON).toHaveBeenCalledTimes(2)
  })

  it('keeps a separate cache row per teaching language', async () => {
    const { ai, chatJSON } = stubAI(okHandler)
    const svc = service(ai)
    await svc.generate({ projectId, documentId, slideNumber: 1, language: 'en' })
    await svc.generate({ projectId, documentId, slideNumber: 1, language: 'zh' })
    expect(chatJSON).toHaveBeenCalledTimes(2)
    const en = await svc.getLesson({ projectId, documentId, slideNumber: 1, language: 'en' })
    const zh = await svc.getLesson({ projectId, documentId, slideNumber: 1, language: 'zh' })
    expect(en?.id).not.toBe(zh?.id)
  })

  it('isolates a failed slide from the others and can retry it', async () => {
    let failSlide2 = true
    const { ai } = stubAI((system, user) => {
      if (failSlide2 && user.includes('slide 2 of')) throw new Error('provider exploded')
      void system
      return okHandler()
    })
    const svc = service(ai)

    const one = await svc.generate({ projectId, documentId, slideNumber: 1, language: 'en' })
    expect(one.lesson.status).toBe('ready')
    const two = await svc.generate({ projectId, documentId, slideNumber: 2, language: 'en' })
    expect(two.lesson.status).toBe('failed')
    expect(two.lesson.errorMessage).toBeTruthy()
    // Slide 1 is untouched.
    expect((await svc.getLesson({ projectId, documentId, slideNumber: 1, language: 'en' }))?.status).toBe('ready')

    failSlide2 = false
    const retried = await svc.regenerate({ projectId, documentId, slideNumber: 2, language: 'en' })
    expect(retried.lesson.status).toBe('ready')
  })

  it('persists the Q&A thread and rejects an empty message', async () => {
    const { ai } = stubAI(okHandler, 'Start by substituting x = 3.')
    const svc = service(ai)
    const { lesson } = await svc.generate({ projectId, documentId, slideNumber: 1, language: 'en' })
    const withAnswer = await svc.ask(lesson.id, 'How do I start?')
    expect(withAnswer.messages).toHaveLength(2)
    expect(withAnswer.messages[0]!.role).toBe('student')
    expect(withAnswer.messages[1]!.content).toContain('substituting')

    await expect(svc.ask(lesson.id, '   ')).rejects.toMatchObject({ code: 'INVALID_INPUT' })
  })

  it('refuses to explain a slide with nothing on it', async () => {
    const { ai } = stubAI(okHandler)
    await expect(
      service(ai).generate({ projectId, documentId, slideNumber: 9, language: 'en' }),
    ).rejects.toMatchObject({ code: 'SLIDE_EMPTY' })
  })

  it('resumes the most recently studied slide', async () => {
    const { ai } = stubAI(okHandler)
    const svc = service(ai)
    await svc.generate({ projectId, documentId, slideNumber: 3, language: 'en' })
    expect(await svc.resumeSlideNumber(documentId)).toBe(3)
  })

  it('reports no provider without an AI service', async () => {
    const svc = service(null)
    const result = await svc.generate({ projectId, documentId, slideNumber: 1, language: 'en' })
    expect(result.lesson.status).toBe('failed')
    expect(result.lesson.errorMessage).toBeTruthy()
  })
})
