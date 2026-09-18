import { describe, expect, it, vi } from 'vitest'
import {
  createFileQueueItems,
  isSameFile,
  MAX_CONCURRENT_UPLOADS,
  retryableItems,
  runBatchQueue,
  summarizeBatch,
  type UploadQueueItem,
  type WorkerContext,
} from '@/features/documents/batchUpload'
import { UploadCancelledError } from '@/features/documents/uploadPipeline'
import { MAX_FILE_BYTES } from '@/infrastructure/files/validation'

/**
 * No explicit MIME type, so detection is driven by the extension exactly as it
 * is for files picked from disk with an unknown type.
 */
function makeFile(name: string, size = 32, lastModified = 1_700_000_000_000): File {
  return new File([new Uint8Array(size)], name, { lastModified })
}

/** `File.size` is a prototype getter — shadow it for the oversized case. */
function withSize(file: File, size: number): File {
  Object.defineProperty(file, 'size', { value: size, configurable: true })
  return file
}

function queued(count: number): UploadQueueItem[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `item-${i}`,
    kind: 'file' as const,
    file: makeFile(`f${i}.pdf`),
    name: `f${i}.pdf`,
    sizeBytes: 32,
    type: 'pdf' as const,
    status: 'queued' as const,
  }))
}

describe('createFileQueueItems', () => {
  it('returns nothing for an empty selection', () => {
    expect(createFileQueueItems([])).toEqual([])
  })

  it('accepts a single supported file', () => {
    const items = createFileQueueItems([makeFile('Lecture 01.pdf')])
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ status: 'queued', type: 'pdf' })
    expect(items[0]?.issue).toBeUndefined()
  })

  it('accepts multiple supported files and keeps them in selection order', () => {
    const items = createFileQueueItems([
      makeFile('Lecture 01.pdf'),
      makeFile('Lecture 02.pdf'),
      makeFile('Lecture 03.pdf'),
    ])
    expect(items.map((i) => i.name)).toEqual([
      'Lecture 01.pdf',
      'Lecture 02.pdf',
      'Lecture 03.pdf',
    ])
    expect(items.every((i) => i.status === 'queued')).toBe(true)
  })

  it('keeps every file independent — no combined document', () => {
    const items = createFileQueueItems([makeFile('a.pdf'), makeFile('b.pdf')])
    expect(new Set(items.map((i) => i.id)).size).toBe(2)
  })

  it('flags unsupported types without failing the valid ones', () => {
    const items = createFileQueueItems([
      makeFile('Lecture 01.pdf'),
      makeFile('virus.exe', 32),
      makeFile('Lecture 02.pdf'),
    ])
    expect(items.map((i) => i.status)).toEqual(['queued', 'skipped', 'queued'])
    expect(items[1]?.issue).toBe('unsupported')
  })

  it('flags oversized files independently', () => {
    const items = createFileQueueItems([
      withSize(makeFile('big.pdf'), MAX_FILE_BYTES + 1),
      makeFile('small.pdf'),
    ])
    expect(items[0]?.status).toBe('skipped')
    expect(items[0]?.issue).toBe('too-large')
    expect(items[1]?.status).toBe('queued')
  })

  it('detects duplicates already in the project', () => {
    const existing = [{ name: 'Lecture 01.pdf', size: 32, modified: 1_700_000_000_000 }]
    const items = createFileQueueItems([makeFile('Lecture 01.pdf')], existing)
    expect(items[0]?.status).toBe('skipped')
    expect(items[0]?.issue).toBe('duplicate')
  })

  it('detects duplicates inside the same selection', () => {
    const items = createFileQueueItems([makeFile('same.pdf'), makeFile('same.pdf')])
    expect(items[0]?.status).toBe('queued')
    expect(items[1]?.status).toBe('skipped')
    expect(items[1]?.issue).toBe('duplicate')
  })

  it('does not treat a different size as a duplicate', () => {
    const existing = [{ name: 'Lecture 01.pdf', size: 32, modified: 1_700_000_000_000 }]
    const items = createFileQueueItems([makeFile('Lecture 01.pdf', 64)], existing)
    expect(items[0]?.status).toBe('queued')
  })

  it('does not treat a different lastModified as a duplicate when both are known', () => {
    const existing = [{ name: 'a.pdf', size: 32, modified: 111 }]
    const items = createFileQueueItems([makeFile('a.pdf', 32, 222)], existing)
    expect(items[0]?.status).toBe('queued')
  })

  it('treats a legacy document without lastModified as a duplicate on name + size', () => {
    const existing = [{ name: 'a.pdf', size: 32 }]
    const items = createFileQueueItems([makeFile('a.pdf', 32, 222)], existing)
    expect(items[0]?.issue).toBe('duplicate')
  })

  it('matches names case-insensitively', () => {
    const existing = [{ name: 'lecture.PDF', size: 32, modified: 1_700_000_000_000 }]
    const items = createFileQueueItems([makeFile('Lecture.pdf')], existing)
    expect(items[0]?.issue).toBe('duplicate')
  })
})

describe('isSameFile', () => {
  it('requires matching name and size', () => {
    expect(isSameFile({ name: 'a.pdf', size: 1 }, { name: 'a.pdf', size: 2 })).toBe(false)
    expect(isSameFile({ name: 'a.pdf', size: 1 }, { name: 'b.pdf', size: 1 })).toBe(false)
    expect(isSameFile({ name: 'a.pdf', size: 1 }, { name: 'a.pdf', size: 1 })).toBe(true)
  })

  it('uses lastModified only when both sides know it', () => {
    expect(
      isSameFile({ name: 'a.pdf', size: 1, modified: 1 }, { name: 'a.pdf', size: 1, modified: 2 }),
    ).toBe(false)
    expect(isSameFile({ name: 'a.pdf', size: 1 }, { name: 'a.pdf', size: 1, modified: 2 })).toBe(true)
  })
})

describe('summarizeBatch', () => {
  it('counts each outcome', () => {
    const items = createFileQueueItems([
      makeFile('ok1.pdf'),
      makeFile('ok2.pdf'),
      makeFile('bad.exe'),
      withSize(makeFile('huge.pdf'), MAX_FILE_BYTES + 1),
    ])
    const summary = summarizeBatch(items)
    expect(summary.total).toBe(4)
    expect(summary.uploadable).toBe(2)
    expect(summary.queued).toBe(2)
    expect(summary.unsupported).toBe(1)
    expect(summary.tooLarge).toBe(1)
    expect(summary.finished).toBe(false)
    expect(summary.running).toBe(false)
  })

  it('reports finished once nothing is queued or running', () => {
    const items: UploadQueueItem[] = [
      { ...queued(1)[0]!, status: 'completed' },
      { ...queued(1)[0]!, id: 'b', status: 'failed' },
    ]
    const summary = summarizeBatch(items)
    expect(summary.completed).toBe(1)
    expect(summary.failed).toBe(1)
    expect(summary.finished).toBe(true)
  })

  it('treats an empty queue as not finished', () => {
    expect(summarizeBatch([]).finished).toBe(false)
  })
})

describe('runBatchQueue', () => {
  it('runs every queued item and records completion', async () => {
    const items = queued(3)
    const updates = new Map<string, Partial<UploadQueueItem>>()
    await runBatchQueue(items, {
      onUpdate: (id, patch) => updates.set(id, { ...updates.get(id), ...patch }),
      isCancelled: () => false,
      worker: async (item, { setDocumentId }) => {
        setDocumentId(`doc-${item.id}`)
      },
    })
    expect(updates.size).toBe(3)
    for (const patch of updates.values()) {
      expect(patch.status).toBe('completed')
    }
  })

  it('never exceeds the concurrency limit', async () => {
    const items = queued(20)
    let inFlight = 0
    let peak = 0

    await runBatchQueue(items, {
      onUpdate: () => undefined,
      isCancelled: () => false,
      worker: async (item, { setDocumentId }) => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 2))
        inFlight -= 1
        setDocumentId(`doc-${item.id}`)
      },
    })

    expect(peak).toBe(MAX_CONCURRENT_UPLOADS)
    expect(inFlight).toBe(0)
  })

  it('honours an explicit concurrency override', async () => {
    const items = queued(10)
    let inFlight = 0
    let peak = 0

    await runBatchQueue(items, {
      concurrency: 3,
      onUpdate: () => undefined,
      isCancelled: () => false,
      worker: async (item, { setDocumentId }) => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 2))
        inFlight -= 1
        setDocumentId(item.id)
      },
    })

    expect(peak).toBe(3)
  })

  it('isolates failures — A succeeds, B fails, C succeeds', async () => {
    const items = queued(3)
    const statuses: Record<string, string> = {}

    await runBatchQueue(items, {
      concurrency: 1,
      onUpdate: (id, patch) => {
        if (patch.status) statuses[id] = patch.status
      },
      isCancelled: () => false,
      worker: async (item, { setDocumentId }) => {
        if (item.id === 'item-1') throw new Error('PDF extraction failed')
        setDocumentId(`doc-${item.id}`)
      },
    })

    expect(statuses['item-0']).toBe('completed')
    expect(statuses['item-1']).toBe('failed')
    expect(statuses['item-2']).toBe('completed')
  })

  it('records the per-file error message', async () => {
    const items = queued(1)
    let error: string | undefined

    await runBatchQueue(items, {
      onUpdate: (_id, patch) => {
        if (patch.error !== undefined) error = patch.error
      },
      isCancelled: () => false,
      worker: async () => {
        throw new Error('PDF extraction failed')
      },
    })

    expect(error).toBe('PDF extraction failed')
  })

  it('does not reject when items fail', async () => {
    const items = queued(2)
    await expect(
      runBatchQueue(items, {
        onUpdate: () => undefined,
        isCancelled: () => false,
        worker: async () => {
          throw new Error('boom')
        },
      }),
    ).resolves.toBeUndefined()
  })

  it('starts items in queue order', async () => {
    const items = queued(4)
    const started: string[] = []

    await runBatchQueue(items, {
      concurrency: 1,
      onUpdate: () => undefined,
      isCancelled: () => false,
      worker: async (item, { setDocumentId }) => {
        started.push(item.id)
        setDocumentId(item.id)
      },
    })

    expect(started).toEqual(['item-0', 'item-1', 'item-2', 'item-3'])
  })

  it('cancels queued items without running them', async () => {
    const items = queued(4)
    const worker = vi.fn(async (item: UploadQueueItem, ctx: WorkerContext) => {
      ctx.setDocumentId(item.id)
    })
    const statuses: Record<string, string> = {}

    await runBatchQueue(items, {
      concurrency: 1,
      onUpdate: (id, patch) => {
        if (patch.status) statuses[id] = patch.status
      },
      isCancelled: () => true,
      worker,
    })

    expect(worker).not.toHaveBeenCalled()
    expect(Object.values(statuses).every((s) => s === 'cancelled')).toBe(true)
  })

  it('keeps completed items when a later cancel arrives', async () => {
    const items = queued(3)
    let cancel = false
    const statuses: Record<string, string> = {}

    await runBatchQueue(items, {
      concurrency: 1,
      onUpdate: (id, patch) => {
        if (patch.status) statuses[id] = patch.status
      },
      isCancelled: () => cancel,
      worker: async (item, { setDocumentId }) => {
        if (item.id === 'item-0') cancel = true
        setDocumentId(item.id)
      },
    })

    expect(statuses['item-0']).toBe('completed')
    expect(statuses['item-1']).toBe('cancelled')
    expect(statuses['item-2']).toBe('cancelled')
  })

  it('maps a cancelled in-flight upload to the cancelled state', async () => {
    const items = queued(1)
    let status: string | undefined

    await runBatchQueue(items, {
      onUpdate: (_id, patch) => {
        if (patch.status) status = patch.status
      },
      isCancelled: () => false,
      worker: async () => {
        throw new UploadCancelledError()
      },
    })

    expect(status).toBe('cancelled')
  })

  it('skips items that are not queued', async () => {
    const items: UploadQueueItem[] = [
      { ...queued(1)[0]!, status: 'skipped', issue: 'duplicate' },
      { ...queued(1)[0]!, id: 'q', status: 'queued' },
    ]
    const worker = vi.fn(async (item: UploadQueueItem, ctx: WorkerContext) => {
      ctx.setDocumentId(item.id)
    })

    await runBatchQueue(items, {
      onUpdate: () => undefined,
      isCancelled: () => false,
      worker,
    })

    expect(worker).toHaveBeenCalledTimes(1)
  })

  it('spawns no more lanes than there is work', async () => {
    const items = queued(1)
    let peak = 0
    let inFlight = 0

    await runBatchQueue(items, {
      onUpdate: () => undefined,
      isCancelled: () => false,
      worker: async (item, { setDocumentId }) => {
        inFlight += 1
        peak = Math.max(peak, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 2))
        inFlight -= 1
        setDocumentId(item.id)
      },
    })

    expect(peak).toBe(1)
  })
})

describe('retryableItems', () => {
  it('resets only failed items', () => {
    const items: UploadQueueItem[] = [
      { ...queued(1)[0]!, status: 'completed', documentId: 'd0' },
      { ...queued(1)[0]!, id: 'f1', status: 'failed', error: 'boom' },
      { ...queued(1)[0]!, id: 'f2', status: 'cancelled' },
      { ...queued(1)[0]!, id: 'f3', status: 'skipped', issue: 'duplicate' },
    ]
    const next = retryableItems(items)
    expect(next[0]?.status).toBe('completed')
    expect(next[1]?.status).toBe('queued')
    expect(next[1]?.error).toBeUndefined()
    expect(next[2]?.status).toBe('cancelled')
    expect(next[3]?.status).toBe('skipped')
  })

  it('leaves successful documents untouched so they are not re-uploaded', () => {
    const items: UploadQueueItem[] = [
      { ...queued(1)[0]!, status: 'completed', documentId: 'keep-me' },
    ]
    const next = retryableItems(items)
    expect(next[0]?.status).toBe('completed')
    expect(next[0]?.documentId).toBe('keep-me')
  })
})
