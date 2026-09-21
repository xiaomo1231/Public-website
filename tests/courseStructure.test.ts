import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { ProcessingJobRepository } from '@/entities/processingJob/repository'
import { ProcessingService } from '@/services/processingService'
import { CourseStructureService } from '@/services/courseStructureService'
import { CourseStructureRepository } from '@/entities/courseStructure/repository'
import { detectStructure, reconcileNodes } from '@/infrastructure/files/structureDetection'
import { chunksFromPdf } from '@/infrastructure/files/chunking'
import { UNSTRUCTURED_TITLE } from '@/entities/courseStructure/types'

/** pdf.js cannot run under jsdom; the extractor is stubbed with pages. */
const pdfState = vi.hoisted(() => ({
  pages: [] as Array<{
    pageNumber: number
    text: string
    headings: Array<{ text: string }>
  }>,
}))

vi.mock('@/infrastructure/files/pdfExtractor', () => ({
  extractPdf: async () => ({
    pageCount: pdfState.pages.length,
    pages: pdfState.pages,
    metadata: {},
    textLength: 0,
    warnings: [],
  }),
  renderPdfPageImage: async () => null,
}))

const CHAPTERS_1_2 = [
  {
    pageNumber: 1,
    text: 'Chapter 1 Introduction\n1.1 Sets\nSets are collections of objects.',
    headings: [{ text: 'Chapter 1 Introduction' }, { text: '1.1 Sets' }],
  },
  {
    pageNumber: 2,
    text: 'Chapter 2 Functions\n2.1 Definition\nFunctions map inputs to outputs.',
    headings: [{ text: 'Chapter 2 Functions' }, { text: '2.1 Definition' }],
  },
]

const CHAPTERS_1_2_3 = [
  ...CHAPTERS_1_2,
  {
    pageNumber: 3,
    text: 'Chapter 3 Derivatives\n3.1 Definition\nDerivatives measure change.',
    headings: [{ text: 'Chapter 3 Derivatives' }, { text: '3.1 Definition' }],
  },
]

function chunk(text: string, contentType = 'paragraph', pageNumber?: number) {
  return { text, contentType, ...(pageNumber !== undefined ? { pageNumber } : {}) }
}

describe('detectStructure', () => {
  it('Test 1 — keeps Chapter 1 / 2 / 3 as chapters', () => {
    const { nodes, confidence } = detectStructure([
      chunk('Chapter 1 Introduction', 'heading', 1),
      chunk('Chapter 2 Functions', 'heading', 2),
      chunk('Chapter 3 Derivatives', 'heading', 3),
    ])
    expect(nodes.map((n) => n.type)).toEqual(['chapter', 'chapter', 'chapter'])
    expect(nodes.map((n) => n.number)).toEqual(['1', '2', '3'])
    expect(confidence).toBe('high')
  })

  it('Test 2 — keeps 2.1 / 2.2 / 2.3 as separate sections', () => {
    const { nodes } = detectStructure([
      chunk('Chapter 2 Functions', 'heading', 2),
      chunk('2.1 Definition', 'heading', 2),
      chunk('2.2 Properties', 'heading', 2),
      chunk('2.3 Composite Functions', 'heading', 2),
    ])
    const sections = nodes.filter((n) => n.type === 'section')
    expect(sections.map((n) => n.number)).toEqual(['2.1', '2.2', '2.3'])
    expect(sections.map((n) => n.title)).toEqual(['Definition', 'Properties', 'Composite Functions'])
  })

  it('supports unit / part wording without renaming it to Chapter', () => {
    const { nodes } = detectStructure([
      chunk('Unit I Foundations', 'heading', 1),
      chunk('Part II Functions', 'heading', 2),
    ])
    expect(nodes.map((n) => n.type)).toEqual(['unit', 'part'])
  })

  it('Test 9 — never invents chapters when there are no headings', () => {
    const { nodes, confidence } = detectStructure([
      chunk('A set is a collection of distinct objects.'),
      chunk('Elements are unordered and unique.'),
    ])
    expect(nodes).toHaveLength(1)
    expect(nodes[0]!.title).toBe(UNSTRUCTURED_TITLE)
    expect(confidence).toBe('low')
  })

  it('Test 10 — recovers a section from numbering even when its title is damaged', () => {
    const { nodes } = detectStructure([chunk('2.1 \uF0C5ets and operations', 'heading', 2)])
    const section = nodes.find((n) => n.type === 'section')
    expect(section?.number).toBe('2.1')
  })
})

describe('reconcileNodes', () => {
  const ids = { structureId: 's1', projectId: 'p1' }

  it('Test 8 — reuses ids when nothing structural changed', () => {
    const detected = detectStructure([
      chunk('Chapter 1 Introduction', 'heading', 1),
      chunk('Chapter 2 Functions', 'heading', 2),
    ])
    const first = reconcileNodes([], detected.nodes, ids)
    const second = reconcileNodes(first, detected.nodes, ids)
    expect(second.map((n) => n.id)).toEqual(first.map((n) => n.id))
  })

  it('keeps existing ids when a chapter is appended', () => {
    const base = detectStructure([
      chunk('Chapter 1 Introduction', 'heading', 1),
      chunk('Chapter 2 Functions', 'heading', 2),
    ])
    const first = reconcileNodes([], base.nodes, ids)

    const extended = detectStructure([
      chunk('Chapter 1 Introduction', 'heading', 1),
      chunk('Chapter 2 Functions', 'heading', 2),
      chunk('Chapter 3 Derivatives', 'heading', 3),
    ])
    const second = reconcileNodes(first, extended.nodes, ids)

    expect(second[0]!.id).toBe(first[0]!.id)
    expect(second[1]!.id).toBe(first[1]!.id)
    expect(second[2]!.number).toBe('3')
    expect(second[2]!.id).not.toBe(first[0]!.id)
  })
})

describe('Test 3 — chunking respects chapter boundaries', () => {
  it('does not merge the end of one chapter with the start of the next', () => {
    const chunks = chunksFromPdf(
      { documentId: 'd', projectId: 'p', documentName: 'book.pdf', type: 'pdf', materialType: 'textbook' },
      [
        {
          pageNumber: 1,
          text: 'Chapter 1 Introduction\nBody of chapter one.',
          headings: [{ text: 'Chapter 1 Introduction' }],
        },
        {
          pageNumber: 2,
          text: 'Chapter 2 Functions\nBody of chapter two.',
          headings: [{ text: 'Chapter 2 Functions' }],
        },
      ],
    )

    const bodyOfOne = chunks.find((c) => c.text.includes('Body of chapter one'))
    expect(bodyOfOne?.text).not.toContain('Chapter 2')
    expect(bodyOfOne?.text).not.toContain('Body of chapter two')
  })
})

describe('CourseStructureService + processing pipeline', () => {
  let db: AppDatabase
  let projectId: string
  let documents: DocumentRepository
  let chunks: ChunkRepository
  let structure: CourseStructureService

  beforeEach(async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    const project = await new ProjectService(db).create({ name: 'Calculus', subject: 'calculus' })
    projectId = project.id
    documents = new DocumentRepository(db)
    chunks = new ChunkRepository(db)
    structure = new CourseStructureService({ db })
    pdfState.pages = CHAPTERS_1_2.map((page) => ({ ...page }))
  })

  function processingService(): ProcessingService {
    return new ProcessingService({
      documents,
      chunks,
      jobs: new ProcessingJobRepository(db),
      projects: new ProjectService(db),
      structure,
      renderPageImage: async () => null,
    })
  }

  async function createTextbook(): Promise<string> {
    const doc = await documents.create({
      projectId,
      type: 'pdf',
      materialType: 'textbook',
      name: 'book.pdf',
      sizeBytes: 0,
      blob: new Blob([new Uint8Array([1, 2, 3])], { type: 'application/pdf' }),
    })
    await processingService().process(doc.id)
    return doc.id
  }

  /** Re-run the pipeline for the same document (re-analysis). */
  async function reprocess(documentId: string): Promise<void> {
    await processingService().process(documentId)
  }

  it('binds every chunk to its chapter and section', async () => {
    const documentId = await createTextbook()

    const stored = await chunks.listByDocument(documentId)
    const setsChunk = stored.find((c) => c.text.includes('Sets are collections'))
    expect(setsChunk?.chapterNumber).toBe('1')
    expect(setsChunk?.sectionNumber).toBe('1.1')
    expect(setsChunk?.chapterTitle).toBe('Introduction')
    expect(setsChunk?.chapterId).toBeTruthy()
    expect(setsChunk?.sectionId).toBeTruthy()

    const structureRow = await structure.getByDocument(documentId)
    expect(structureRow?.confidence).toBe('high')
    const nodes = await structure.listNodes(structureRow!.id)
    expect(nodes.filter((n) => n.type === 'chapter')).toHaveLength(2)
    // Chapter nodes own their chunks.
    expect(nodes[0]!.sourceChunkIds.length).toBeGreaterThan(0)
  })

  it('keeps chapter ids stable when the textbook is re-analysed', async () => {
    const documentId = await createTextbook()
    const first = await structure.listNodes((await structure.getByDocument(documentId))!.id)
    const firstChapterIds = first.filter((n) => n.type === 'chapter').map((n) => n.id)

    await reprocess(documentId)

    const second = await structure.listNodes((await structure.getByDocument(documentId))!.id)
    const secondChapterIds = second.filter((n) => n.type === 'chapter').map((n) => n.id)
    expect(secondChapterIds).toEqual(firstChapterIds)
  })

  it('adds a new chapter without renumbering the existing ones', async () => {
    const documentId = await createTextbook()
    const first = await structure.listNodes((await structure.getByDocument(documentId))!.id)

    pdfState.pages = CHAPTERS_1_2_3.map((page) => ({ ...page }))
    await reprocess(documentId)

    const second = await structure.listNodes((await structure.getByDocument(documentId))!.id)
    expect(second.filter((n) => n.type === 'chapter')).toHaveLength(3)
    expect(second[0]!.id).toBe(first[0]!.id)
    expect(second[1]!.id).toBe(first[1]!.id)
  })

  it('does not build a structure for non-textbook material', async () => {
    const notes = await documents.create({
      projectId,
      type: 'text',
      materialType: 'user_notes',
      name: 'notes.txt',
      sizeBytes: 0,
      blob: new Blob(['Chapter 1 my own note'], { type: 'text/plain' }),
    })
    const service = new ProcessingService({
      documents,
      chunks,
      jobs: new ProcessingJobRepository(db),
      projects: new ProjectService(db),
      structure,
      renderPageImage: async () => null,
    })
    await service.process(notes.id)

    expect(await new CourseStructureRepository(db).getByDocument(notes.id)).toBeUndefined()
  })
})
