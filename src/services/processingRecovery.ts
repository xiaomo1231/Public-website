import { getDb, type AppDatabase } from '@/infrastructure/db/database'
import { t } from '@/i18n'

/** A document whose last processing step is older than this, with no live run here, was cut off. */
const PROCESSING_INTERRUPTED_AFTER_MS = 30 * 60_000

/**
 * Documents left `uploading` / `processing` by a tab that was closed mid-run
 * would read "processing" forever (and keep the course page polling). Called
 * once at start-up: a document whose latest job has not moved for a while is
 * marked as interrupted. One that had been processed before keeps its chunks
 * and goes back to `ready`; one that never finished becomes `failed`. Either
 * way the student can choose 「重新处理」.
 */
export async function recoverInterruptedProcessing(
  db: AppDatabase = getDb(),
  now = Date.now(),
): Promise<number> {
  const stuck = await db.documents.where('status').anyOf(['uploading', 'processing']).toArray()
  let recovered = 0
  for (const document of stuck) {
    const jobs = await db.processingJobs.where('documentId').equals(document.id).toArray()
    const lastActivity = Math.max(
      document.uploadedAt,
      ...jobs.map((job) => job.updatedAt ?? job.startedAt ?? 0),
    )
    if (now - lastActivity <= PROCESSING_INTERRUPTED_AFTER_MS) continue
    const message = t('documents.processingInterrupted')
    await db.transaction('rw', db.documents, db.processingJobs, async () => {
      const current = await db.documents.get(document.id)
      if (!current || (current.status !== 'uploading' && current.status !== 'processing')) return
      await db.documents.update(document.id, {
        status: current.processedAt ? 'ready' : 'failed',
        errorMessage: message,
      })
      for (const job of jobs) {
        if (job.stage === 'done' || job.stage === 'failed') continue
        await db.processingJobs.update(job.id, {
          stage: 'failed',
          errorMessage: message,
          finishedAt: now,
        })
      }
    })
    recovered += 1
  }
  return recovered
}
