import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { ProcessingService } from '@/services/processingService'
import { TutorLessonService } from '@/services/tutorLessonService'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { ProcessingJobRepository } from '@/entities/processingJob/repository'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { VisualSourceRepository } from '@/entities/visualSource/repository'
import { extractPdf } from '@/infrastructure/files/pdfExtractor'
import type { AIService } from '@/services/aiService'

/**
 * pdf.js needs a worker, which Vitest cannot spawn. We replace it with a fake
 * that returns a controlled operator list, so the image-detection and pipeline
 * logic can be exercised deterministically.
 */
const pdfState = vi.hoisted(() => ({
  pages: [] as Array<{ text: string; imageOps: number[] }>,
}))

vi.mock('pdfjs-dist', () => {
  class FakePage {
    constructor(private readonly page: { text: string; imageOps: number[] }) {}
    async getOperatorList() {
      return { fnArray: this.page.imageOps, argsArray: [] }
    }
    async getTextContent() {
      const lines = this.page.text.split('\n').filter(Boolean)
      return {
        items: lines.map((str, i) => ({ str, transform: [1, 0, 0, 1, 50, 800 - i * 14] })),
      }
    }
    async cleanup() {}
  }
  class FakeDocument {
    get numPages() {
      return pdfState.pages.length
    }
    async getPage(index: number) {
      const page = pdfState.pages[index - 1]
      if (!page) throw new Error('no page')
      return new FakePage(page)
    }
    async getMetadata() {
      return { info: {} }
    }
    async cleanup() {}
    async destroy() {}
  }
  return {
    GlobalWorkerOptions: {},
    OPS: {
      paintImageXObject: 85,
      paintInlineImageXObject: 86,
      paintImageMaskXObject: 87,
      paintImageXObjectRepeat: 88,
      paintImageMaskXObjectRepeat: 89,
      paintSolidColorImageMask: 90,
    },
    getDocument: () => ({ promise: Promise.resolve(new FakeDocument()) }),
  }
})

/** The real-world broken transcription this feature exists for. */
const PUA_VENN = '\uF0C5 ( ) ( ) A B B A \u2212 \uF0C8 \u2212'

const PDF_BLOB = () => new Blob([new Uint8Array([1, 2, 3])], { type: 'application/pdf' })

describe('pdfExtractor — image detection', () => {
  it('counts image operators on a page', async () => {
    pdfState.pages = [{ text: '', imageOps: [85, 86] }]
    const result = await extractPdf(PDF_BLOB())
    expect(result.pages[0]!.imageCount).toBe(2)
  })

  it('reports zero for a text-only page', async () => {
    pdfState.pages = [{ text: 'Plain text.', imageOps: [] }]
    const result = await extractPdf(PDF_BLOB())
    expect(result.pages[0]!.imageCount).toBe(0)
  })
})

describe('ProcessingService — visual source preservation', () => {
  let db: AppDatabase
  let projects: ProjectService
  let documents: DocumentRepository
  let chunks: ChunkRepository
  let jobs: ProcessingJobRepository
  let visuals: VisualSourceRepository
  let projectId: string

  const fakeRenderer = vi.fn().mockResolvedValue({
    bytes: new Uint8Array([137, 80, 78, 71]).buffer,
    mimeType: 'image/png',
    width: 800,
    height: 600,
  })

  beforeEach(async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    projects = new ProjectService(db)
    documents = new DocumentRepository(db)
    chunks = new ChunkRepository(db)
    jobs = new ProcessingJobRepository(db)
    visuals = new VisualSourceRepository(db)
    fakeRenderer.mockClear()
    const project = await projects.create({ name: 'Sets', subject: 'calculus' })
    projectId = project.id
  })

  function service(renderer = fakeRenderer) {
    return new ProcessingService({
      documents,
      chunks,
      jobs,
      projects,
      visuals,
      renderPageImage: renderer,
    })
  }

  async function processPdf(): Promise<string> {
    const doc = await documents.create({
      projectId,
      type: 'pdf',
      name: 'venn.pdf',
      sizeBytes: 0,
      blob: PDF_BLOB(),
    })
    await service().process(doc.id)
    return doc.id
  }

  it('preserves a figure page as a visual source with provenance', async () => {
    pdfState.pages = [{ text: '', imageOps: [85] }]
    const documentId = await processPdf()

    const sources = await visuals.listByDocument(documentId)
    expect(sources).toHaveLength(1)
    expect(sources[0]).toMatchObject({
      projectId,
      documentId,
      pageNumber: 1,
      imageMimeType: 'image/png',
      width: 800,
      height: 600,
    })
    expect(await visuals.getImage(sources[0]!.id)).toBeTruthy()
    expect(fakeRenderer).toHaveBeenCalledTimes(1)
  })

  it('keeps the provenance even when no image can be rendered', async () => {
    pdfState.pages = [{ text: '', imageOps: [85] }]
    const doc = await documents.create({
      projectId,
      type: 'pdf',
      name: 'venn.pdf',
      sizeBytes: 0,
      blob: PDF_BLOB(),
    })
    await service(vi.fn().mockResolvedValue(null)).process(doc.id)

    const sources = await visuals.listByDocument(doc.id)
    expect(sources).toHaveLength(1)
    expect(sources[0]!.imageMimeType).toBe('')
  })

  it('preserves a page whose extracted text is garbled OCR', async () => {
    pdfState.pages = [{ text: PUA_VENN, imageOps: [85] }]
    const documentId = await processPdf()

    const sources = await visuals.listByDocument(documentId)
    expect(sources).toHaveLength(1)
    // The visual references the chunks it stands in for.
    expect(sources[0]!.sourceChunkIds.length).toBeGreaterThan(0)
  })

  it('does not turn a normal text page into a visual source', async () => {
    pdfState.pages = [
      { text: 'A set is a collection of distinct objects.', imageOps: [] },
    ]
    const documentId = await processPdf()

    expect(await visuals.listByDocument(documentId)).toEqual([])
    expect(fakeRenderer).not.toHaveBeenCalled()
  })

  it('does not screenshot a text-heavy page that merely has an image', async () => {
    pdfState.pages = [
      {
        text: 'The symmetric difference of two sets contains every element that belongs to exactly one of them, and nothing else.',
        imageOps: [85],
      },
    ]
    const documentId = await processPdf()
    expect(await visuals.listByDocument(documentId)).toEqual([])
  })

  it('replaces the previous figures when a document is re-processed', async () => {
    pdfState.pages = [{ text: '', imageOps: [85] }]
    const documentId = await processPdf()
    const first = await visuals.listByDocument(documentId)

    await service().process(documentId)

    const second = await visuals.listByDocument(documentId)
    expect(second).toHaveLength(1)
    expect(second[0]!.id).not.toBe(first[0]!.id)
    expect(await visuals.getImage(first[0]!.id)).toBeNull()
  })

  it('keeps the previous chunks and figure when re-processing cannot commit', async () => {
    pdfState.pages = [{ text: 'Original material', imageOps: [85] }]
    const documentId = await processPdf()
    const oldChunks = await chunks.listByDocument(documentId)
    const oldFigures = await visuals.listByDocument(documentId)
    expect(oldFigures).toHaveLength(1)

    vi.spyOn(chunks, 'addPrepared').mockRejectedValueOnce(new Error('storage failed'))
    await expect(service().process(documentId)).rejects.toThrow('storage failed')

    expect((await chunks.listByDocument(documentId)).map((chunk) => chunk.id)).toEqual(oldChunks.map((chunk) => chunk.id))
    expect((await visuals.listByDocument(documentId)).map((figure) => figure.id)).toEqual(oldFigures.map((figure) => figure.id))
    expect(await visuals.getImage(oldFigures[0]!.id)).toBeTruthy()
    expect((await documents.get(documentId)).status).toBe('ready')
  })
})

describe('TutorLessonService — visual sources', () => {
  let db: AppDatabase
  let analyses: CourseAnalysisRepository
  let chunks: ChunkRepository
  let visuals: VisualSourceRepository
  let projectId: string
  let documentId: string
  let topicId: string
  let visualId: string

  const LESSON = '## Definition\n\nThe symmetric difference is a set operation.'

  function stubAI() {
    const chat = vi.fn().mockResolvedValue({ content: LESSON, model: 'fake' })
    return { chat, ai: { chat, currentProvider: { id: 'fake' } } as unknown as AIService }
  }

  beforeEach(async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    const projects = new ProjectService(db)
    const project = await projects.create({ name: 'Set Theory', subject: 'calculus' })
    projectId = project.id

    const documents = new DocumentRepository(db)
    const doc = await documents.create({ projectId, type: 'text', name: 'sets.txt', sizeBytes: 0 })
    await documents.update(doc.id, { status: 'ready' })
    documentId = doc.id

    chunks = new ChunkRepository(db)
    const stored = await chunks.addMany([
      {
        documentId,
        projectId,
        pageNumber: 1,
        contentType: 'ocr',
        text: PUA_VENN,
        sourceReference: 'sets.txt · Page 1',
        order: 0,
      },
    ])

    visuals = new VisualSourceRepository(db)
    visualId = crypto.randomUUID()
    const visual = {
      id: visualId,
      projectId,
      documentId,
      pageNumber: 1,
      type: 'diagram' as const,
      caption: 'Figure from course material, page 1.',
      sourceChunkIds: [stored[0]!.id],
      imageMimeType: 'image/png',
      createdAt: Date.now(),
    }
    await visuals.upsert(visual)
    await visuals.putImage(visual, new Uint8Array([1, 2, 3]).buffer, 'image/png')

    analyses = new CourseAnalysisRepository(db)
    topicId = 'topic-symmetric'
    await analyses.reseedProject(
      projectId,
      {
        topics: [
          {
            name: 'Symmetric Difference',
            description: 'The symmetric difference of two sets.',
            sourceRefs: [{ documentId, documentName: 'sets.txt', page: 1, quote: PUA_VENN }],
          },
        ],
        concepts: [],
        formulas: [],
        symbols: [],
        examples: [],
        exercises: [],
        prerequisites: [],
        topicsByName: new Map([['Symmetric Difference', topicId]]),
        documentIds: [documentId],
      },
      'en',
    )
  })

  function service(ai: AIService) {
    return new TutorLessonService({ ai, db, analyses, chunks, visuals })
  }

  const input = () => ({
    projectId,
    topicId,
    topicName: 'Symmetric Difference',
    topicDescription: 'The symmetric difference of two sets.',
    language: 'en' as const,
  })

  it('attaches the preserved figure to the lesson', async () => {
    const { ai } = stubAI()
    const result = await service(ai).getOrGenerate(input())

    expect(result.lesson.visuals).toHaveLength(1)
    expect(result.lesson.visuals?.[0]).toMatchObject({
      id: visualId,
      documentId,
      pageNumber: 1,
      hasImage: true,
    })
  })

  it('does not feed the corrupted OCR text to the model', async () => {
    const { ai, chat } = stubAI()
    await service(ai).getOrGenerate(input())

    const messages = chat.mock.calls[0]![0] as Array<{ role: string; content: string }>
    const userPrompt = messages.find((m) => m.role === 'user')!.content

    expect(userPrompt).not.toContain('\uF0C5')
    expect(userPrompt).not.toContain('\uF0C8')
    expect(userPrompt).toContain('Figure preserved as a visual source')
  })
})
