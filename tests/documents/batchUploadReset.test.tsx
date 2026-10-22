import 'fake-indexeddb/auto'
import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Closing the upload dialog mid-run resets the hook while a file is still
 * being processed. Reopening must give a clean, usable dialog: the detached
 * run may finish in the background, but it must not keep `running` on, write
 * into the new queue, or upload the files the student cancelled.
 */
const pipeline = vi.hoisted(() => ({
  uploads: [] as Array<{ name?: string; resolve: () => void }>,
}))

vi.mock('@/features/documents/uploadPipeline', () => ({
  uploadDocument: vi.fn(
    (input: { name?: string }) =>
      new Promise<void>((resolve) => {
        pipeline.uploads.push({ name: input.name, resolve })
      }),
  ),
  reprocessDocument: vi.fn(async () => undefined),
}))

vi.mock('@/services/courseContentService', () => ({
  CourseContentService: class {
    ensureAnalyzed() {
      return Promise.resolve()
    }
  },
  pausedCourseAnalysis: () => false,
}))

const { AppDatabase, setDbForTesting } = await import('@/infrastructure/db/database')
const { ProjectService } = await import('@/services/projectService')
const { useBatchUpload } = await import('@/features/documents/useBatchUpload')

function file(name: string): File {
  return new File(['Derivatives and integrals'], name, { type: 'text/plain' })
}

describe('useBatchUpload — reset while running', () => {
  let projectId: string

  beforeEach(async () => {
    pipeline.uploads = []
    const db = new AppDatabase()
    setDbForTesting(db)
    projectId = (await new ProjectService().create({ name: 'Calc', subject: 'calculus' })).id
  })

  it('detaches the old run so a reopened dialog is not stuck', async () => {
    const { result } = renderHook(() => useBatchUpload(projectId))

    await act(async () => {
      await result.current.addFiles([file('a.txt'), file('b.txt'), file('c.txt')])
    })
    let firstRun: Promise<void> = Promise.resolve()
    act(() => {
      firstRun = result.current.start()
    })
    await waitFor(() => expect(pipeline.uploads.length).toBeGreaterThan(0))
    expect(result.current.running).toBe(true)

    // Close the dialog mid-run.
    act(() => result.current.reset())
    expect(result.current.running).toBe(false)
    expect(result.current.items).toEqual([])
    const startedBeforeReset = pipeline.uploads.length

    // Reopen: queue and start a new file while the old upload is still busy.
    await act(async () => {
      await result.current.addFiles([file('new.txt')])
    })
    let secondRun: Promise<void> = Promise.resolve()
    act(() => {
      secondRun = result.current.start()
    })
    await waitFor(() => expect(pipeline.uploads.some((u) => u.name === 'new.txt')).toBe(true))
    expect(result.current.running).toBe(true)

    // The old upload finishes: it must not touch the new queue or `running`,
    // and its cancelled files are never started.
    await act(async () => {
      for (const upload of pipeline.uploads.slice(0, startedBeforeReset)) upload.resolve()
      await firstRun
    })
    expect(result.current.running).toBe(true)
    expect(result.current.items.map((item) => item.name)).toEqual(['new.txt'])
    expect(result.current.items[0]!.status).not.toBe('completed')
    expect(pipeline.uploads.map((u) => u.name).filter((n) => n !== 'new.txt')).toHaveLength(
      startedBeforeReset,
    )

    await act(async () => {
      pipeline.uploads.find((u) => u.name === 'new.txt')!.resolve()
      await secondRun
    })
    expect(result.current.running).toBe(false)
    expect(result.current.items[0]!.status).toBe('completed')
  })
})
