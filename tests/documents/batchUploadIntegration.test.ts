import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * pdfjs cannot spawn its worker under jsdom (the existing PDF test mocks it for
 * the same reason). Everything else in this suite — document persistence,
 * chunking, concurrency, project isolation — runs against the real pipeline.
 */
vi.mock('@/infrastructure/files/pdfExtractor', () => ({
  extractPdf: async (blob: Blob) => {
    const text = await blob.text()
    if (text.startsWith('BROKEN')) throw new Error('PDF extraction failed')
    const pages = [{ pageNumber: 1, text, headings: [] as Array<{ text: string }> }]
    return {
      textLength: text.length,
      metadata: { pageCount: 1 },
      warnings: [] as string[],
      pages,
    }
  },
}))

const { AppDatabase, setDbForTesting } = await import('@/infrastructure/db/database')
const { ProjectService } = await import('@/services/projectService')
const { DocumentRepository } = await import('@/entities/document/repository')
const {
  createFileQueueItems,
  identityOfDocument,
  MAX_CONCURRENT_UPLOADS,
  retryableItems,
  runBatchQueue,
  summarizeBatch,
} = await import('@/features/documents/batchUpload')
const { reprocessDocument, uploadDocument } = await import('@/features/documents/uploadPipeline')

import type { AppDatabase as AppDatabaseType } from '@/infrastructure/db/database'
import type { UploadQueueItem, WorkerContext } from '@/features/documents/batchUpload'

/**
 * Mirrors the worker inside `useBatchUpload`: a retry of a file whose document
 * row already exists re-processes it instead of creating a second document.
 */
async function runItem(
  projectId: string,
  item: UploadQueueItem,
  context: WorkerContext,
): Promise<void> {
  if (item.kind === 'file' && item.documentId) {
    await reprocessDocument(item.documentId, {})
    return
  }
  await uploadDocument(
    {
      projectId,
      type: item.type ?? 'text',
      file: item.file,
      name: item.name,
    },
    { onDocumentCreated: context.setDocumentId },
  )
}

let db: AppDatabaseType

beforeEach(() => {
  db = new AppDatabase()
  setDbForTesting(db)
})

function pdfFile(name: string, text = 'Derivatives and integrals are related'): File {
  return new File([text], name, { type: 'application/pdf' })
}

function brokenPdfFile(name: string): File {
  return new File(['BROKEN PDF'], name, { type: 'application/pdf' })
}

async function makeProject(name: string): Promise<string> {
  const project = await new ProjectService().create({ name, subject: 'physics' })
  return project.id
}

/** Mirror of what `useBatchUpload` does, without React. */
async function runUploads(
  projectId: string,
  files: File[],
  options: { concurrency?: number } = {},
): Promise<UploadQueueItem[]> {
  const items = createFileQueueItems(files)
  const state = new Map(items.map((item) => [item.id, item]))
  const onUpdate = (id: string, patch: Partial<UploadQueueItem>) => {
    state.set(id, { ...state.get(id)!, ...patch })
  }

  await runBatchQueue(items, {
    ...(options.concurrency !== undefined ? { concurrency: options.concurrency } : {}),
    onUpdate,
    isCancelled: () => false,
    worker: (item, context) => runItem(projectId, item, context),
  })

  return [...state.values()]
}

describe('batch upload against the real pipeline', () => {
  it('uploads a single file as a batch of one', async () => {
    const projectId = await makeProject('Physics 101')
    const items = await runUploads(projectId, [pdfFile('Lecture 01.pdf')])

    expect(items).toHaveLength(1)
    expect(items[0]?.status).toBe('completed')

    const docs = await new DocumentRepository(db).listByProject(projectId)
    expect(docs).toHaveLength(1)
    expect(docs[0]?.name).toBe('Lecture 01.pdf')
    expect(docs[0]?.status).toBe('ready')
  })

  it('creates one independent document per file', async () => {
    const projectId = await makeProject('Physics 101')
    const files = [
      pdfFile('Lecture 01.pdf', 'First lecture content about derivatives'),
      pdfFile('Lecture 02.pdf', 'Second lecture content about integrals'),
      pdfFile('Lecture 03.pdf', 'Third lecture content about series'),
    ]

    const items = await runUploads(projectId, files)
    expect(items.every((i) => i.status === 'completed')).toBe(true)

    const docs = await new DocumentRepository(db).listByProject(projectId)
    expect(docs).toHaveLength(3)
    expect(new Set(docs.map((d) => d.id)).size).toBe(3)
    expect(docs.map((d) => d.name).sort()).toEqual([
      'Lecture 01.pdf',
      'Lecture 02.pdf',
      'Lecture 03.pdf',
    ])

    // Each document owns its own chunks, scoped to the same project.
    for (const doc of docs) {
      const chunks = await db.chunks.where('documentId').equals(doc.id).toArray()
      expect(chunks.length).toBeGreaterThan(0)
      expect(chunks.every((c) => c.projectId === projectId)).toBe(true)
    }
  })

  it('keeps every document inside the target project', async () => {
    const projectA = await makeProject('Project A')
    const projectB = await makeProject('Project B')

    await runUploads(projectA, [pdfFile('A1.pdf'), pdfFile('A2.pdf')])
    await runUploads(projectB, [pdfFile('B1.pdf')])

    const repo = new DocumentRepository(db)
    const a = await repo.listByProject(projectA)
    const b = await repo.listByProject(projectB)

    expect(a.map((d) => d.name).sort()).toEqual(['A1.pdf', 'A2.pdf'])
    expect(b.map((d) => d.name)).toEqual(['B1.pdf'])
    expect(a.every((d) => d.projectId === projectA)).toBe(true)
    expect(b.every((d) => d.projectId === projectB)).toBe(true)

    const chunksInB = await db.chunks.where('projectId').equals(projectB).toArray()
    expect(chunksInB.every((c) => c.projectId === projectB)).toBe(true)
  })

  it('never creates duplicate documents for one batch', async () => {
    const projectId = await makeProject('Physics 101')
    const files = Array.from({ length: 6 }, (_, i) =>
      pdfFile(`Lecture 0${i + 1}.pdf`, `Content for lecture ${i + 1}`),
    )

    await runUploads(projectId, files)

    const docs = await new DocumentRepository(db).listByProject(projectId)
    expect(docs).toHaveLength(6)
    expect(new Set(docs.map((d) => d.name)).size).toBe(6)
  })

  it('handles a 20-file batch with bounded concurrency', async () => {
    const projectId = await makeProject('Physics 101')
    const files = Array.from({ length: 20 }, (_, i) =>
      pdfFile(`Lecture ${i + 1}.pdf`, `Content for lecture number ${i + 1}`),
    )

    const items = createFileQueueItems(files)
    const state = new Map(items.map((item) => [item.id, item]))
    let inFlight = 0
    let peak = 0

    await runBatchQueue(items, {
      onUpdate: (id, patch) => {
        state.set(id, { ...state.get(id)!, ...patch })
      },
      isCancelled: () => false,
      worker: async (item, context) => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        try {
          await runItem(projectId, item, context)
        } finally {
          inFlight -= 1
        }
      },
    })

    expect(peak).toBeLessThanOrEqual(MAX_CONCURRENT_UPLOADS)
    expect(peak).toBe(MAX_CONCURRENT_UPLOADS)
    expect(inFlight).toBe(0)

    const final = [...state.values()]
    expect(final.every((i) => i.status === 'completed')).toBe(true)
    expect(summarizeBatch(final).completed).toBe(20)

    const docs = await new DocumentRepository(db).listByProject(projectId)
    expect(docs).toHaveLength(20)
    expect(new Set(docs.map((d) => d.id)).size).toBe(20)
  })

  it('does not abort the batch when one file fails', async () => {
    const projectId = await makeProject('Physics 101')
    const files = [
      pdfFile('Lecture 01.pdf'),
      brokenPdfFile('Lecture 02.pdf'),
      pdfFile('Lecture 03.pdf'),
    ]

    const items = await runUploads(projectId, files, { concurrency: 1 })
    const byName = Object.fromEntries(items.map((i) => [i.name, i]))

    expect(byName['Lecture 01.pdf']?.status).toBe('completed')
    expect(byName['Lecture 02.pdf']?.status).toBe('failed')
    expect(byName['Lecture 02.pdf']?.error).toContain('PDF extraction failed')
    expect(byName['Lecture 03.pdf']?.status).toBe('completed')
  })

  it('retries only the failed file', async () => {
    const projectId = await makeProject('Physics 101')
    const files = [pdfFile('Lecture 01.pdf'), brokenPdfFile('Lecture 02.pdf')]

    const first = await runUploads(projectId, files, { concurrency: 1 })
    expect(first.filter((i) => i.status === 'completed')).toHaveLength(1)
    expect(first.filter((i) => i.status === 'failed')).toHaveLength(1)

    const retried = retryableItems(first)
    expect(retried.find((i) => i.name === 'Lecture 01.pdf')?.status).toBe('completed')
    expect(retried.find((i) => i.name === 'Lecture 02.pdf')?.status).toBe('queued')

    const state = new Map(retried.map((item) => [item.id, item]))
    await runBatchQueue(retried, {
      concurrency: 1,
      onUpdate: (id, patch) => {
        state.set(id, { ...state.get(id)!, ...patch })
      },
      isCancelled: () => false,
      worker: (item, context) => runItem(projectId, item, context),
    })

    // The failed file re-processed its existing row (no third document), and
    // the successful file was never re-uploaded.
    const docs = await new DocumentRepository(db).listByProject(projectId)
    expect(docs).toHaveLength(2)
    expect(new Set(docs.map((d) => d.name)).size).toBe(2)
  })

  it('cancels queued items without removing completed documents', async () => {
    const projectId = await makeProject('Physics 101')
    const files = Array.from({ length: 4 }, (_, i) => pdfFile(`Lecture 0${i + 1}.pdf`))

    const items = createFileQueueItems(files)
    const state = new Map(items.map((item) => [item.id, item]))
    let cancel = false

    await runBatchQueue(items, {
      concurrency: 1,
      onUpdate: (id, patch) => {
        state.set(id, { ...state.get(id)!, ...patch })
      },
      isCancelled: () => cancel,
      worker: async (item, context) => {
        await runItem(projectId, item, context)
        cancel = true // cancel as soon as the first one lands
      },
    })

    const final = [...state.values()]
    expect(final[0]?.status).toBe('completed')
    expect(final.slice(1).every((i) => i.status === 'cancelled')).toBe(true)

    const docs = await new DocumentRepository(db).listByProject(projectId)
    expect(docs).toHaveLength(1)
  })

  it('detects a re-selection of already uploaded files as duplicates', async () => {
    const projectId = await makeProject('Physics 101')
    const files = [pdfFile('Lecture 01.pdf'), pdfFile('Lecture 02.pdf')]
    await runUploads(projectId, files)

    const documents = await new DocumentRepository(db).listByProject(projectId)
    const again = createFileQueueItems(files, documents.map(identityOfDocument))

    expect(again.every((i) => i.status === 'skipped')).toBe(true)
    expect(again.every((i) => i.issue === 'duplicate')).toBe(true)

    const after = await new DocumentRepository(db).listByProject(projectId)
    expect(after).toHaveLength(2)
  })

  it('stores the source lastModified so duplicates stay precise', async () => {
    const projectId = await makeProject('Physics 101')
    const file = pdfFile('Lecture 01.pdf')
    await runUploads(projectId, [file])

    const [doc] = await new DocumentRepository(db).listByProject(projectId)
    expect(doc?.sourceModifiedAt).toBe(file.lastModified)
  })

  it('rejects an oversized file without uploading it', async () => {
    const projectId = await makeProject('Physics 101')
    const huge = pdfFile('Huge.pdf')
    Object.defineProperty(huge, 'size', { value: 100 * 1024 * 1024 + 1, configurable: true })

    const items = createFileQueueItems([huge, pdfFile('Fine.pdf')])
    expect(items[0]?.issue).toBe('too-large')

    const queuedOnly = await runUploads(projectId, [huge, pdfFile('Fine.pdf')])
    expect(queuedOnly.find((i) => i.name === 'Huge.pdf')?.status).toBe('skipped')
    expect(queuedOnly.find((i) => i.name === 'Fine.pdf')?.status).toBe('completed')

    const docs = await new DocumentRepository(db).listByProject(projectId)
    expect(docs.map((d) => d.name)).toEqual(['Fine.pdf'])
  })
})
