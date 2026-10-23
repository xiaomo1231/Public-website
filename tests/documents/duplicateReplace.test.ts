import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// pdf.js cannot run under jsdom; the text of the "PDF" is its content.
vi.mock('@/infrastructure/files/pdfExtractor', () => ({
  extractPdf: async (blob: Blob) => {
    const text = await blob.text()
    return {
      textLength: text.length,
      metadata: { pageCount: 1 },
      warnings: [] as string[],
      pages: [{ pageNumber: 1, text, headings: [] as Array<{ text: string }> }],
    }
  },
  openPdfPageRenderer: async () => null,
}))

const { AppDatabase, setDbForTesting } = await import('@/infrastructure/db/database')
const { ProjectService } = await import('@/services/projectService')
const { DocumentRepository } = await import('@/entities/document/repository')
const { ChunkRepository } = await import('@/entities/chunk/repository')
const { HomeworkRepository } = await import('@/entities/homework/repository')
const { replaceDocumentFile, uploadDocument } = await import('@/features/documents/uploadPipeline')
const { mergePhotoDocuments, orderPhotoDocuments, defaultMergedName, canMergePhotos } =
  await import('@/features/documents/photoMerge')
const { runDocumentBatch } = await import('@/features/documents/documentBatch')

import type { AppDatabase as AppDatabaseType } from '@/infrastructure/db/database'
import type { Document } from '@/entities/document/types'
import type { PhotoMergeDeps } from '@/features/documents/photoMerge'

let db: AppDatabaseType

beforeEach(() => {
  db = new AppDatabase()
  setDbForTesting(db)
})

const pdf = (name: string, text: string) => new File([text], name, { type: 'application/pdf' })

async function project(): Promise<string> {
  return (await new ProjectService().create({ name: 'ECON 110', subject: 'economics' })).id
}

async function chunkText(documentId: string): Promise<string> {
  const chunks = await new ChunkRepository(db).listByDocument(documentId)
  return chunks.map((c) => c.text).join(' ')
}

async function addStudentWork(projectId: string, documentId: string): Promise<void> {
  const now = Date.now()
  const homework = new HomeworkRepository(db)
  const setId = crypto.randomUUID()
  await homework.upsertSet({
    id: setId,
    projectId,
    documentId,
    documentName: 'HW.pdf',
    title: 'HW',
    status: 'ready',
    language: 'en',
    questionCount: 1,
    promptVersion: 'v1',
    createdAt: now,
    updatedAt: now,
  })
  await homework.upsertQuestion({
    id: crypto.randomUUID(),
    projectId,
    setId,
    documentId,
    documentName: 'HW.pdf',
    order: 0,
    prompt: 'Solve it.',
    sourceRefs: [],
    hints: [],
    solution: '',
    generationStatus: 'ready',
    promptVersion: 'v1',
    draftText: 'my working',
    revealedHints: 0,
    solutionRevealed: false,
    messages: [],
    createdAt: now,
    updatedAt: now,
  })
}

describe('上传重复文件 → 覆盖 / 保留两份', () => {
  it('replaces the stored file in place: same id, name, folder and exam pick', async () => {
    const projectId = await project()
    const original = await uploadDocument({
      projectId,
      type: 'pdf',
      file: pdf('Lecture 01.pdf', 'old supply and demand'),
      name: 'Lecture 01.pdf',
      folderPath: 'Week 1',
    })
    await db.exams.put({
      id: 'exam-1',
      projectId,
      name: 'Midterm',
      at: Date.now() + 86_400_000,
      scope: { kind: 'course' },
      materials: {
        pastExamSetIds: [],
        reviewDocumentIds: [],
        practiceSetIds: [],
        homeworkSetIds: [],
        documentIds: [original.id],
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as never)

    const result = await replaceDocumentFile(original.id, {
      projectId,
      type: 'pdf',
      file: pdf('Lecture 01.pdf', 'new elasticity of demand'),
      name: 'Lecture 01.pdf',
    })

    expect(result.outcome).toBe('replaced')
    const docs = await new DocumentRepository(db).listByProject(projectId)
    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({
      id: original.id,
      name: 'Lecture 01.pdf',
      folderPath: 'Week 1',
      status: 'ready',
    })
    expect(await chunkText(original.id)).toContain('elasticity')
    expect(await chunkText(original.id)).not.toContain('supply')
    const blob = await new DocumentRepository(db).getBlob(original.id)
    expect(await blob!.text()).toBe('new elasticity of demand')
    const exam = await db.exams.get('exam-1')
    expect(exam!.materials.documentIds).toEqual([original.id])
  })

  it('re-recognises a homework file: its derived sets without student work are removed', async () => {
    const projectId = await project()
    const hw = await uploadDocument({
      projectId,
      type: 'pdf',
      materialType: 'homework',
      file: pdf('HW1.pdf', 'Question 1 old'),
      name: 'HW1.pdf',
    })
    await new HomeworkRepository(db).upsertSet({
      id: 'set-1',
      projectId,
      documentId: hw.id,
      documentName: 'HW1.pdf',
      title: 'HW1',
      status: 'ready',
      language: 'en',
      questionCount: 0,
      promptVersion: 'v1',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    const result = await replaceDocumentFile(hw.id, {
      projectId,
      type: 'pdf',
      materialType: 'homework',
      file: pdf('HW1.pdf', 'Question 1 new'),
      name: 'HW1.pdf',
    })
    expect(result.outcome).toBe('replaced')
    expect(await new HomeworkRepository(db).listSetsByDocument(hw.id)).toHaveLength(0)
  })

  it('keeps both instead when the stored file has student work', async () => {
    const projectId = await project()
    const hw = await uploadDocument({
      projectId,
      type: 'pdf',
      materialType: 'homework',
      file: pdf('HW.pdf', 'Question 1'),
      name: 'HW.pdf',
    })
    await addStudentWork(projectId, hw.id)

    const result = await replaceDocumentFile(hw.id, {
      projectId,
      type: 'pdf',
      materialType: 'homework',
      file: pdf('HW.pdf', 'Question 1 corrected'),
      name: 'HW.pdf',
    })

    expect(result.outcome).toBe('kept-both')
    expect(result.document.id).not.toBe(hw.id)
    expect(result.document.name).toBe('HW (2).pdf')
    expect(await chunkText(hw.id)).toBe('Question 1')
    expect(await new HomeworkRepository(db).listSetsByDocument(hw.id)).toHaveLength(1)
  })

  it('keep both uploads a second document under the chosen name', async () => {
    const projectId = await project()
    await uploadDocument({ projectId, type: 'pdf', file: pdf('A.pdf', 'one'), name: 'A.pdf' })
    await uploadDocument({ projectId, type: 'pdf', file: pdf('A.pdf', 'one'), name: 'A (2).pdf' })
    const names = (await new DocumentRepository(db).listByProject(projectId)).map((d) => d.name)
    expect(names.sort()).toEqual(['A (2).pdf', 'A.pdf'])
  })
})

describe('合并为一份试卷 (file batch action)', () => {
  const photo = (id: string, name: string, over: Partial<Document> = {}): Document => ({
    id,
    projectId: 'p1',
    type: 'image',
    name,
    sizeBytes: 1,
    mimeType: 'image/jpeg',
    hasBlob: true,
    status: 'ready',
    warnings: [],
    metadata: {},
    uploadedAt: 0,
    ...over,
  })

  function fakeDeps(blocked: Set<string> = new Set()) {
    const uploads: Array<Parameters<PhotoMergeDeps['upload']>[0]> = []
    const deleted: string[] = []
    const carried: Array<{ from: string[]; to: string }> = []
    const deps: PhotoMergeDeps = {
      listByProject: async () => [photo('x', '选择题.pdf')],
      getBlob: async (id) => new Blob([id], { type: 'image/jpeg' }),
      getDeleteImpact: async (id) => ({ blocked: blocked.has(id) }),
      delete: async (id) => {
        deleted.push(id)
      },
      upload: async (input) => {
        uploads.push(input)
        return photo('merged', input.name, { type: 'pdf' })
      },
      carryExamSelections: async (_p, from, to) => {
        carried.push({ from, to })
      },
      prepare: async () => ({
        bytes: Uint8Array.from(
          atob(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
          ),
          (c) => c.charCodeAt(0),
        ),
        mimeType: 'image/png',
        width: 1,
        height: 1,
      }),
    }
    return { deps, uploads, deleted, carried }
  }

  const selected = [
    photo('b', '选择题 02.jpg', { folderPath: 'Midterm' }),
    photo('a', '选择题 01.jpg', { folderPath: 'Midterm' }),
    photo('c', '选择题 10.jpg', { folderPath: 'Midterm' }),
  ]

  it('orders pages by number and names the paper after the shared stem', () => {
    expect(orderPhotoDocuments(selected).map((d) => d.id)).toEqual(['a', 'b', 'c'])
    expect(defaultMergedName(selected)).toBe('选择题.pdf')
    expect(canMergePhotos(selected)).toBe(true)
    expect(canMergePhotos([selected[0]!])).toBe(false)
    expect(canMergePhotos([selected[0]!, photo('d', 'x.pdf', { type: 'pdf' })])).toBe(false)
    expect(canMergePhotos([selected[0]!, photo('e', 'y.jpg', { projectId: 'p2' })])).toBe(false)
  })

  it('uploads one PDF (free name, first folder, past-paper role) and deletes originals without work', async () => {
    const { deps, uploads, deleted, carried } = fakeDeps(new Set(['b']))
    const result = await mergePhotoDocuments(selected, { deleteOriginals: true, deps })
    expect(uploads).toHaveLength(1)
    expect(uploads[0]).toMatchObject({
      name: '选择题 (2).pdf',
      folderPath: 'Midterm',
      materialType: 'past_exam',
      photoPages: 3,
    })
    expect(uploads[0]!.file.type).toBe('application/pdf')
    expect(carried).toEqual([{ from: ['a', 'b', 'c'], to: 'merged' }])
    expect(deleted).toEqual(['a', 'c'])
    expect(result.kept.map((k) => k.document.id)).toEqual(['b'])
  })

  it('runs as a batch action and reports kept originals as skipped', async () => {
    const { deps: merge, deleted } = fakeDeps(new Set(['c']))
    const result = await runDocumentBatch(
      selected,
      { kind: 'mergePhotos', deleteOriginals: true },
      {
        deps: {
          documents: {} as never,
          reprocess: async () => undefined,
          setEvalRole: async () => undefined,
          merge,
        },
      },
    )
    expect(result.merged?.name).toBe('选择题 (2).pdf')
    expect(result.done).toBe(2)
    expect(result.skipped).toBe(1)
    expect(deleted).toEqual(['a', 'b'])
  })

  it('keeps the originals when not asked to delete them', async () => {
    const { deps, deleted } = fakeDeps()
    const result = await mergePhotoDocuments(selected, { deps, name: '大题' })
    expect(result.document.name).toBe('大题.pdf')
    expect(deleted).toEqual([])
  })
})
