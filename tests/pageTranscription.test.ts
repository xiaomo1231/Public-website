import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { VisualSourceRepository } from '@/entities/visualSource/repository'
import { PageTranscriptionService, shouldAutoTranscribe } from '@/services/pageTranscriptionService'
import { readPageTranscription } from '@/infrastructure/ai/prompts/page-transcribe/v1'
import { prompts } from '@/infrastructure/ai/prompts'
import { parseAnswerEntries } from '@/entities/homework/answerMatching'
import type { AIService } from '@/services/aiService'

function fakeAI(replies: unknown[]) {
  const chatJSON = vi.fn()
  for (const reply of replies) chatJSON.mockResolvedValueOnce({ data: reply })
  return { chatJSON, ai: { chatJSON } as unknown as AIService }
}

describe('PageTranscriptionService', () => {
  let db: AppDatabase
  let documents: DocumentRepository
  let chunks: ChunkRepository
  let visuals: VisualSourceRepository
  let projectId: string

  beforeEach(async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    const project = await new ProjectService(db).create({ name: 'Econ', subject: 'other' })
    projectId = project.id
    documents = new DocumentRepository(db)
    chunks = new ChunkRepository(db)
    visuals = new VisualSourceRepository(db)
  })

  async function scannedKey() {
    const doc = await documents.create({
      projectId,
      type: 'pdf',
      materialType: 'homework_answer',
      name: 'key.pdf',
      sizeBytes: 3,
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'application/pdf' }),
    })
    await documents.update(doc.id, { status: 'ready' })
    const base = { documentId: doc.id, projectId, sourceReference: 'key.pdf' }
    const rows = await chunks.addMany([
      {
        ...base,
        pageNumber: 1,
        contentType: 'ocr',
        text: 'Ouestion 1 ...',
        order: 0,
        layoutWarnings: ['ocr'],
      },
      { ...base, pageNumber: 2, contentType: 'paragraph', text: 'Typed page two', order: 1 },
      {
        ...base,
        pageNumber: 3,
        contentType: 'ocr',
        text: 'garbled',
        order: 2,
        layoutWarnings: ['ocr'],
      },
    ])
    const source = {
      id: 'v1',
      projectId,
      documentId: doc.id,
      pageNumber: 1,
      type: 'screenshot' as const,
      caption: 'Page 1',
      sourceChunkIds: [rows[0]!.id],
      imageMimeType: 'image/png',
      createdAt: 1,
    }
    await visuals.upsert(source)
    await visuals.putImage(source, new Uint8Array([137, 80, 78, 71]).buffer, 'image/png')
    return { doc, rows }
  }

  it('lists the pages recognised from a picture', async () => {
    const { doc } = await scannedKey()
    expect(await new PageTranscriptionService(null, { db }).candidates(doc.id)).toEqual([1, 3])
  })

  it('replaces only the read pages and proposes the marked options as answers', async () => {
    const { doc, rows } = await scannedKey()
    const { ai, chatJSON } = fakeAI([
      {
        text: '(1.) What is the opportunity cost?\n(a) $ 12,000\n(b) $ 47,000',
        confidence: 0.9,
        marks: [{ question: '1', option: 'B' }],
      },
      { blank: true, text: '', marks: [] },
    ])
    const render = vi
      .fn()
      .mockResolvedValue({ page: 3, bytes: new ArrayBuffer(4), mimeType: 'image/png' })
    const result = await new PageTranscriptionService(ai, {
      db,
      model: 'vision-x',
      renderPage: render,
    }).transcribe(doc.id)
    expect(result).toEqual({ pages: [1], failed: [3], marks: 1 })
    // Page 1 used its stored rendering; page 3 had none and was rendered.
    expect(render).toHaveBeenCalledTimes(1)
    const sent = chatJSON.mock.calls[0]![0] as Array<{ images?: string[] }>
    expect(sent[1]!.images![0]).toMatch(/^data:image\/png;base64,/)

    const stored = (await chunks.listByDocument(doc.id)).sort((a, b) => a.order - b.order)
    expect(stored.map((chunk) => chunk.order)).toEqual(stored.map((_, i) => i))
    // The typed page keeps its id; the unread page keeps its OCR text.
    expect(stored.some((chunk) => chunk.id === rows[1]!.id)).toBe(true)
    expect(stored.some((chunk) => chunk.text === 'garbled')).toBe(true)
    const read = stored.filter((chunk) => chunk.pageNumber === 1)
    expect(read.every((chunk) => chunk.contentType === 'ocr' || /^Answer/.test(chunk.text))).toBe(
      true,
    )
    expect(read.map((chunk) => chunk.text).join('\n')).toContain('(b) $ 47,000')
    const entries = parseAnswerEntries(stored)
    expect(entries.find((entry) => entry.number === '1')?.text).toBe('(b)')
    const updated = await documents.get(doc.id)
    expect(updated.metadata.transcribedPages).toEqual([1])
    expect(updated.metadata.transcribedModel).toBe('vision-x')
  })

  it('stops with a clear error when the model cannot read images', async () => {
    const { doc } = await scannedKey()
    const chatJSON = vi
      .fn()
      .mockRejectedValue(
        Object.assign(new Error('image input is not supported'), { code: 'INVALID_REQUEST' }),
      )
    await expect(
      new PageTranscriptionService({ chatJSON } as unknown as AIService, { db }).transcribe(doc.id),
    ).rejects.toMatchObject({ code: 'VISION_UNSUPPORTED' })
    // Nothing changed.
    expect((await chunks.listByDocument(doc.id)).map((chunk) => chunk.text).sort()).toEqual(
      ['Ouestion 1 ...', 'Typed page two', 'garbled'].sort(),
    )
  })

  it('reads photographed exam pages by default only when allowed', () => {
    const photo = {
      type: 'image' as const,
      materialType: 'past_exam' as const,
      status: 'ready' as const,
    }
    expect(shouldAutoTranscribe(photo, { hasAI: true, mode: undefined })).toBe(true)
    expect(shouldAutoTranscribe(photo, { hasAI: true, mode: 'online' })).toBe(true)
    expect(shouldAutoTranscribe(photo, { hasAI: true, mode: 'local' })).toBe(false)
    expect(shouldAutoTranscribe(photo, { hasAI: false, mode: 'auto' })).toBe(false)
    expect(
      shouldAutoTranscribe({ ...photo, materialType: 'textbook' }, { hasAI: true, mode: 'auto' }),
    ).toBe(false)
    expect(
      shouldAutoTranscribe({ ...photo, type: 'pdf' as const }, { hasAI: true, mode: 'auto' }),
    ).toBe(false)
  })
})

describe('page-transcribe/v1', () => {
  it('validates the reply and the marks', () => {
    expect(readPageTranscription({ text: '', blank: false })).toBeNull()
    expect(readPageTranscription('nope')).toBeNull()
    expect(
      readPageTranscription({
        text: 'x',
        confidence: 82,
        marks: [
          { question: '(7.)', option: '(C)' },
          { question: '7', option: 'd' },
          { question: 'two', option: 'a' },
          { question: '8', option: 'z' },
        ],
      }),
    ).toEqual({
      text: 'x',
      confidence: 0.82,
      marks: [{ question: '7', option: 'c' }],
      blank: false,
    })
  })

  it('keeps printed marks and never solves (system prompt rules)', () => {
    const system = prompts.pageTranscribe.buildSystemPrompt()
    expect(system).toContain('PRINTED value')
    expect(system).toContain('NEVER correct, solve')
    expect(system).toContain('Security rules')
  })
})
