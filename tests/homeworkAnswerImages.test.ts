import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { HomeworkService } from '@/services/homeworkService'
import { DocumentService } from '@/services/documentService'
import { DataManagementService } from '@/services/dataManagementService'
import { HomeworkAnswerImageService } from '@/services/homeworkAnswerImageService'
import { isVisionUnsupportedError } from '@/services/answerImagesAI'
import { DocumentRepository } from '@/entities/document/repository'
import { HomeworkRepository } from '@/entities/homework/repository'
import { answerImageKey, fitWithin, moveId } from '@/entities/homework/answerImages'
import type { AIService } from '@/services/aiService'
import type { ChatMessage } from '@/infrastructure/ai/types'
import type { HomeworkQuestion, HomeworkSet } from '@/entities/homework/types'
import { AIProviderError, AuthFailedError } from '@/infrastructure/ai/errors'
import { t } from '@/i18n'

/** Test preparer: no canvas in jsdom, so the bytes pass through unchanged. */
async function passThrough(file: Blob) {
  // FileReader, like DocumentRepository: jsdom's Blob.arrayBuffer() yields a
  // buffer that fake-indexeddb cannot clone.
  const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file)
  })
  return {
    bytes,
    mimeType: file.type as 'image/png',
    width: 10,
    height: 10,
  }
}

function png(...bytes: number[]): Blob {
  return new Blob([Uint8Array.from(bytes)], { type: 'image/png' })
}

const CHECK_RESULT = {
  status: 'ready',
  similarityPercent: 80,
  verdict: 'partial',
  feedback: 'Mostly right.',
  matchedPoints: ['Result'],
  missingPoints: ['Reasoning'],
}

/** AI stub that records every request; `rejectImages` mimics a text-only model. */
function stubAI(options: { rejectImages?: boolean } = {}) {
  const requests: ChatMessage[][] = []
  const respond = async (messages: ChatMessage[]) => {
    requests.push(messages)
    if (options.rejectImages && messages.some((message) => message.images?.length)) {
      throw new AIProviderError('image_url is not supported by this model', 'INVALID_REQUEST', 400)
    }
    return { data: CHECK_RESULT, raw: {} }
  }
  const ai = {
    streamJSON: vi.fn(respond),
    chatJSON: vi.fn(respond),
    chat: vi.fn(async (messages: ChatMessage[]) => {
      requests.push(messages)
      if (options.rejectImages && messages.some((message) => message.images?.length)) {
        throw new AIProviderError('Model does not support image input', 'INVALID_REQUEST', 400)
      }
      return { content: 'Look at line 2.' }
    }),
    maxOutputTokens: 2048,
  } as unknown as AIService
  return { ai, requests }
}

describe('homework answer images', () => {
  let db: AppDatabase
  let projectId: string
  let documentId: string
  let setId: string
  let repo: HomeworkRepository
  let images: HomeworkAnswerImageService

  function question(partial: Partial<HomeworkQuestion>): HomeworkQuestion {
    return {
      id: crypto.randomUUID(),
      projectId,
      setId,
      documentId,
      documentName: 'hw.txt',
      order: 0,
      prompt: 'Explain why the matrix is invertible.',
      sourceRefs: [],
      hints: ['h'],
      solution: 'Its determinant is 5, which is not zero.',
      generationStatus: 'ready',
      promptVersion: 'v1',
      draftText: '',
      revealedHints: 0,
      solutionRevealed: false,
      messages: [],
      createdAt: 1,
      updatedAt: 1,
      ...partial,
    }
  }

  beforeEach(async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    const project = await new ProjectService(db).create({
      name: 'Linear algebra',
      subject: 'linear_algebra',
    })
    projectId = project.id
    const doc = await new DocumentRepository(db).create({
      projectId,
      type: 'text',
      materialType: 'homework',
      name: 'hw.txt',
      sizeBytes: 3,
      blob: new Blob(['abc'], { type: 'text/plain' }),
    })
    documentId = doc.id
    repo = new HomeworkRepository(db)
    setId = crypto.randomUUID()
    const set: HomeworkSet = {
      id: setId,
      projectId,
      documentId,
      documentName: 'hw.txt',
      title: 'hw.txt',
      status: 'ready',
      language: 'en',
      questionCount: 2,
      promptVersion: 'v1',
      createdAt: 1,
      updatedAt: 1,
    }
    await repo.upsertSet(set)
    await repo.upsertQuestion(question({ id: 'q1', order: 0 }))
    await repo.upsertQuestion(question({ id: 'q2', order: 1, prompt: 'Find the rank.' }))
    images = new HomeworkAnswerImageService({ db, prepare: passThrough })
  })

  afterEach(() => db.close())

  it('adds, removes and reorders a question’s images', async () => {
    const a = await images.add('q1', png(1))
    const b = await images.add('q1', png(2), 'pen')
    const c = await images.add('q1', png(3))
    await images.add('q2', png(9))
    expect((await images.list('q1')).map((image) => image.id)).toEqual([a.id, b.id, c.id])
    expect(b.source).toBe('pen')
    expect(b.setId).toBe(setId)
    expect(b.projectId).toBe(projectId)

    await images.move('q1', c.id, -1)
    expect((await images.list('q1')).map((image) => image.id)).toEqual([a.id, c.id, b.id])
    await images.move('q1', a.id, -1) // already first: unchanged
    expect((await images.list('q1')).map((image) => image.order)).toEqual([0, 1, 2])

    await images.remove('q1', c.id)
    const rest = await images.list('q1')
    expect(rest.map((image) => [image.id, image.order])).toEqual([
      [a.id, 0],
      [b.id, 1],
    ])
    // Removing through the wrong question does nothing.
    await images.remove('q2', a.id)
    expect(await images.list('q1')).toHaveLength(2)
    expect(await images.list('q2')).toHaveLength(1)
  })

  it('refuses non-images, oversized results and a deleted question', async () => {
    await expect(
      images.add('q1', new Blob(['x'], { type: 'application/pdf' })),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await expect(
      images.add('q1', new Blob(['<svg/>'], { type: 'image/svg+xml' })),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    const huge = new HomeworkAnswerImageService({
      db,
      prepare: async () => ({
        bytes: new ArrayBuffer(8 * 1024 * 1024 + 1),
        mimeType: 'image/jpeg',
        width: 1,
        height: 1,
      }),
    })
    await expect(huge.add('q1', png(1))).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    await expect(images.add('missing', png(1))).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(await images.list('q1')).toHaveLength(0)
  })

  it('pure helpers: fit within 2000 px, move ids, image key', () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 2000, height: 1500 })
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 })
    expect(moveId(['a', 'b', 'c'], 'c', -1)).toEqual(['a', 'c', 'b'])
    expect(moveId(['a', 'b', 'c'], 'a', 5)).toEqual(['b', 'c', 'a'])
    expect(answerImageKey([])).toBe('')
    expect(answerImageKey([{ id: 'x' }, { id: 'y' }])).toBe('x,y')
  })

  it('sends only the current question’s images with the answer check', async () => {
    await images.add('q1', png(1, 2, 3))
    await images.add('q1', png(4))
    await images.add('q2', png(250, 251))
    const { ai, requests } = stubAI()
    const check = await new HomeworkService({ ai, db }).checkAnswer(
      'q1',
      'det = 5 so invertible',
      'en',
    )
    expect(check).toMatchObject({ method: 'ai', imageCount: 2 })
    expect(check.imagesIgnored).toBeUndefined()
    expect(requests).toHaveLength(1)
    const sent = requests[0]!.flatMap((message) => message.images ?? [])
    expect(sent).toEqual([
      `data:image/png;base64,${btoa(String.fromCharCode(1, 2, 3))}`,
      `data:image/png;base64,${btoa(String.fromCharCode(4))}`,
    ])
    expect(sent.join()).not.toContain(btoa(String.fromCharCode(250, 251)))
    expect(requests[0]!.at(-1)!.content).toContain('handwritten working for THIS question')
  })

  it('checks an answer given only as images, and goes stale when images change', async () => {
    const first = await images.add('q1', png(7))
    const { ai, requests } = stubAI()
    const service = new HomeworkService({ ai, db })
    const check = await service.checkAnswer('q1', '', 'en')
    expect(check.method).toBe('ai')
    // Cached while nothing changed…
    await service.checkAnswer('q1', '', 'en')
    expect(requests).toHaveLength(1)
    // …redone after the images change.
    await images.add('q1', png(8))
    await service.checkAnswer('q1', '', 'en')
    expect(requests).toHaveLength(2)
    await images.remove('q1', first.id)
    await images.remove('q1', (await images.list('q1'))[0]!.id)
    await expect(service.checkAnswer('q1', '', 'en')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    })
  })

  it('falls back to the typed text when the model cannot read images', async () => {
    await images.add('q1', png(1))
    const { ai, requests } = stubAI({ rejectImages: true })
    const service = new HomeworkService({ ai, db })
    const check = await service.checkAnswer('q1', 'det = 5', 'en')
    expect(check.imagesIgnored).toBe(true)
    expect(requests).toHaveLength(2)
    expect(requests[1]!.some((message) => message.images)).toBe(false)

    // No typed text to fall back on: the actionable message, nothing saved.
    await repo.updateQuestion('q2', { answerCheck: undefined })
    await images.add('q2', png(2))
    await expect(service.checkAnswer('q2', '', 'en')).rejects.toMatchObject({
      code: 'VISION_UNSUPPORTED',
      message: t('homework.images.visionUnsupported'),
    })
    expect((await repo.getQuestion('q2'))?.answerCheck).toBeUndefined()
  })

  it('attaches this question’s images to the AI conversation, with the same fallback', async () => {
    await images.add('q1', png(5))
    await images.add('q2', png(6))
    const ok = stubAI()
    const reply = await new HomeworkService({ ai: ok.ai, db }).ask('q1', 'Is line 2 right?')
    expect(reply.imagesIgnored).toBeUndefined()
    expect(ok.requests[0]!.flatMap((message) => message.images ?? [])).toEqual([
      `data:image/png;base64,${btoa(String.fromCharCode(5))}`,
    ])
    const stored = (await repo.getQuestion('q1'))!.messages
    expect(stored.at(-2)).toMatchObject({ role: 'student', imageCount: 1 })

    const textOnly = stubAI({ rejectImages: true })
    const fallback = await new HomeworkService({ ai: textOnly.ai, db }).ask('q1', 'And line 3?')
    expect(fallback).toMatchObject({ role: 'assistant', imagesIgnored: true })
    expect(textOnly.requests).toHaveLength(2)
  })

  it('reads only image-related provider errors as missing vision support', () => {
    expect(
      isVisionUnsupportedError(new AIProviderError('bad request', 'INVALID_REQUEST', 400)),
    ).toBe(true)
    expect(
      isVisionUnsupportedError(
        new AIProviderError('this model does not support vision', 'PROVIDER_UNAVAILABLE', 500),
      ),
    ).toBe(true)
    expect(isVisionUnsupportedError(new AuthFailedError('image denied'))).toBe(false)
    expect(isVisionUnsupportedError(new Error('network down'))).toBe(false)
  })

  it('counts images as student work and blocks deleting the homework file', async () => {
    const documents = new DocumentService({
      db,
      documents: new DocumentRepository(db),
      projects: new ProjectService(db),
    })
    const before = await documents.getDeleteImpact(documentId, projectId)
    expect(before.studentWork.homeworkAnswers).toBe(0)
    await images.add('q2', png(1))
    const impact = await documents.getDeleteImpact(documentId, projectId)
    expect(impact.studentWork.homeworkAnswers).toBe(1)
    expect(impact.blocked).toBe(true)
    await expect(documents.delete(documentId, projectId)).rejects.toMatchObject({
      code: 'FILE_IN_USE',
    })
    expect(await images.list('q2')).toHaveLength(1)
  })

  it('deletes images with the assignment, a question and the project', async () => {
    await images.add('q1', png(1))
    await images.add('q2', png(2))
    const service = new HomeworkService({ ai: null, db })
    await service.deleteQuestion('q2')
    expect(await db.homeworkAnswerImages.where('questionId').equals('q2').count()).toBe(0)
    expect(await db.homeworkAnswerImages.count()).toBe(1)
    await service.deleteAssignment(setId, projectId)
    expect(await db.homeworkAnswerImages.count()).toBe(0)

    // Project deletion (a second assignment in the same course).
    await repo.upsertSet({
      id: 's2',
      projectId,
      documentId,
      documentName: 'hw.txt',
      title: 'hw.txt',
      status: 'ready',
      language: 'en',
      questionCount: 1,
      promptVersion: 'v1',
      createdAt: 1,
      updatedAt: 1,
    })
    await repo.upsertQuestion(question({ id: 'q3', setId: 's2' }))
    await images.add('q3', png(3))
    await new DataManagementService(db).deleteProject(projectId)
    expect(await db.homeworkAnswerImages.count()).toBe(0)
  })

  it('round-trips image bytes and order through export and restore', async () => {
    const a = await images.add('q1', png(0, 1, 127, 128, 255))
    const b = await images.add('q1', png(42), 'pen')
    await images.move('q1', b.id, -1)
    const data = new DataManagementService(db)
    const { blobs } = await data.exportAll()
    expect(blobs.filter((blob) => blob.kind === 'homeworkAnswerImage')).toHaveLength(2)
    const file = await data.exportFile()

    await data.deleteProject(projectId)
    expect(await db.homeworkAnswerImages.count()).toBe(0)
    const summary = await data.restoreFromFile(file)
    expect(summary.skippedFiles).toBe(0)

    const restored = await images.list('q1')
    expect(restored.map((image) => [image.id, image.order, image.source])).toEqual([
      [b.id, 0, 'pen'],
      [a.id, 1, 'upload'],
    ])
    expect(Array.from(new Uint8Array(restored[1]!.bytes))).toEqual([0, 1, 127, 128, 255])
    expect(restored[0]).toMatchObject({ projectId, setId, questionId: 'q1', mimeType: 'image/png' })
  })
})

describe('migration to v19', () => {
  it('adds homeworkAnswerImages and keeps existing rows', async () => {
    await Dexie.delete('ai-learning-platform')
    const old = new Dexie('ai-learning-platform')
    old.version(18).stores({
      projects: 'id, name, subject, createdAt, updatedAt',
      homeworkQuestions: 'id, projectId, setId, order, [setId+order]',
      interviewSessions: 'id, projectId, [projectId+updatedAt]',
    })
    await old.open()
    await old.table('projects').put({ id: 'p1', name: 'Old', subject: 'cs', createdAt: 1 })
    await old.table('homeworkQuestions').put({ id: 'q1', projectId: 'p1', setId: 's1', order: 0 })
    old.close()

    const db = new AppDatabase()
    await db.open()
    expect(db.verno).toBeGreaterThanOrEqual(19)
    expect(db.tables.map((table) => table.name)).toContain('homeworkAnswerImages')
    expect((await db.projects.get('p1'))?.name).toBe('Old')
    expect(await db.homeworkQuestions.count()).toBe(1)
    expect(await db.homeworkAnswerImages.count()).toBe(0)
    db.close()
  })
})
