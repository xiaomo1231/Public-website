import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import {
  DataManagementService,
  EXPORTED_TABLES,
  NOT_EXPORTED_TABLES,
  type RestoreProgress,
} from '@/services/dataManagementService'
import { ProjectService } from '@/services/projectService'
import { DocumentRepository } from '@/entities/document/repository'
import { MistakeService } from '@/services/mistakeService'
import { BackupError } from '@/infrastructure/errors/AppError'
import { scanBackup } from '@/infrastructure/backup/backupReader'

const RESTORED_TABLES = [
  ...EXPORTED_TABLES,
  'documentBlobs',
  'visualSourceImages',
  'homeworkAnswerImages',
]

/** Every restored table as plain data; ArrayBuffers become byte arrays. */
async function snapshot(db: AppDatabase): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {}
  for (const name of RESTORED_TABLES) {
    const rows = await db.table(name).toArray()
    out[name] = rows
      .map((row: Record<string, unknown>) => {
        const copy: Record<string, unknown> = { ...row }
        if (copy.bytes instanceof ArrayBuffer) copy.bytes = Array.from(new Uint8Array(copy.bytes))
        if (name === 'settings') {
          delete copy.apiKey
          delete copy.apiKeyEncrypted
        }
        return copy
      })
      .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  }
  return out
}

async function seed(db: AppDatabase) {
  const project = await new ProjectService(db).create({
    name: '线性代数',
    subject: 'linear_algebra',
  })
  const doc = await new DocumentRepository(db).create({
    projectId: project.id,
    type: 'text',
    name: '讲义.txt',
    sizeBytes: 9,
    blob: new Blob(['矩阵 rref'], { type: 'text/plain' }),
  })
  await db.visualSources.put({
    id: 'vs1',
    projectId: project.id,
    documentId: doc.id,
    pageNumber: 1,
    type: 'diagram',
    caption: '图 1',
    sourceChunkIds: [],
    imageMimeType: 'image/png',
    createdAt: 1,
  })
  const image = Uint8Array.from({ length: 300 }, (_, i) => (i * 7) % 256)
  await db.visualSourceImages.put({
    id: 'vs1',
    projectId: project.id,
    mimeType: 'image/png',
    bytes: image.buffer,
  })
  await new MistakeService(db).addManual({
    projectId: project.id,
    question: '求 $A^{-1}$',
    studentAnswer: 'a',
    correctAnswer: 'b',
    knowledgePoint: '逆矩阵',
  })
  await db.table('vocabCards').put({ word: 'matrix', due: 1, state: 0, bookId: 'exam:cet4' })
  await db.table('reviewCards').put({ id: 'card', projectId: project.id, due: 1 })
  await db.table('quizzes').put({ id: 'quiz', projectId: project.id, status: 'completed' })
  await db.table('user').put({ id: 'singleton', uiStyle: 'lab', theme: 'dark' })
  await db.settings.put({
    id: 'singleton',
    provider: 'openai',
    baseURL: 'https://api.example.com/v1',
    model: 'm',
    temperature: 0.7,
    maxTokens: 100,
    updatedAt: 1,
    apiKeyEncrypted: 'encrypted-secret',
  })
  await db.table('cryptoKeys').put({ id: 'device', key: 'kept' })
  return { project, doc }
}

function backupFile(json: Record<string, unknown>, blobs: unknown[] = []): Blob {
  return new Blob([JSON.stringify({ json, blobs })], { type: 'application/json' })
}

async function expectBackupError(promise: Promise<unknown>, code: string) {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  )
  expect(err).toBeInstanceOf(BackupError)
  expect((err as BackupError).code).toBe(code)
}

describe('restore from backup', () => {
  let db: AppDatabase

  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
  })

  afterEach(() => {
    Reflect.deleteProperty(globalThis.navigator, 'storage')
    vi.restoreAllMocks()
    db.close()
  })

  it('exports or deliberately excludes every table in the database', () => {
    const covered = new Set<string>([...RESTORED_TABLES, ...NOT_EXPORTED_TABLES])
    expect(db.tables.map((table) => table.name).filter((name) => !covered.has(name))).toEqual([])
  })

  it('round-trips every table and file byte, except the API key', async () => {
    const { project } = await seed(db)
    const service = new DataManagementService(db)
    const before = await snapshot(db)
    const file = await service.exportFile()

    // Change everything: delete the course, add new data, cache a reference image.
    await service.deleteProject(project.id)
    await new ProjectService(db).create({ name: 'Other', subject: 'cs' })
    await db.table('vocabCards').clear()
    await db.referenceImages.put({ id: 'ref', projectId: 'x', topicId: 't' } as never)
    await db.referenceImageBlobs.put({ id: 'ref', projectId: 'x' } as never)

    const progress: RestoreProgress[] = []
    const summary = await service.restoreFromFile(file, {
      onProgress: (p) => progress.push(p),
      chunkSize: 97,
    })

    expect(await snapshot(db)).toEqual(before)
    const settings = await db.settings.get('singleton')
    expect(settings?.apiKeyEncrypted).toBeUndefined()
    expect(settings?.baseURL).toBe('https://api.example.com/v1')
    expect(await db.table('cryptoKeys').get('device')).toEqual({ id: 'device', key: 'kept' })
    expect(await db.referenceImages.count()).toBe(0)
    expect(await db.referenceImageBlobs.count()).toBe(0)
    expect(summary.counts).toMatchObject({
      projects: 1,
      documents: 1,
      files: 2,
      fileBytes: new TextEncoder().encode('矩阵 rref').length + 300,
      quizzes: 1,
      mistakes: 1,
      vocabWords: 1,
      reviewCards: 1,
    })
    expect(progress.map((p) => p.stage)).toEqual(expect.arrayContaining(['checking', 'files']))
    expect(progress.at(-1)).toEqual({ stage: 'files', done: 2, total: 2 })
  })

  it('exports each file entry with its owning project', async () => {
    const { project } = await seed(db)
    const { blobs } = await new DataManagementService(db).exportAll()
    expect(blobs.map((b) => b.projectId)).toEqual([project.id, project.id])
  })

  it('restores an old backup whose file entries carry only id, kind, mime type and bytes', async () => {
    const file = backupFile(
      {
        exportedAt: '2026-01-01T00:00:00.000Z',
        schemaVersion: 12,
        blobEncoding: 'base64',
        projects: [{ id: 'p1', name: 'P', subject: 'cs' }],
        documents: [{ id: 'd1', projectId: 'p1', name: 'a.pdf', hasBlob: true }],
        visualSources: [{ id: 'v1', projectId: 'p1', documentId: 'd1' }],
      },
      [
        { id: 'd1', kind: 'document', mimeType: 'application/pdf', bytesBase64: 'AAF//w==' },
        { id: 'v1', kind: 'visualSource', mimeType: 'image/png', bytesBase64: 'AQID' },
        { id: 'orphan', kind: 'document', mimeType: 'application/pdf', bytesBase64: 'AQID' },
      ],
    )
    const service = new DataManagementService(db)
    const summary = await service.inspectBackup(file)
    expect(summary.skippedFiles).toBe(1)
    expect(summary.counts.files).toBe(2)

    await service.restoreFromFile(file)
    const docBlob = await db.documentBlobs.get('d1')
    expect(docBlob?.projectId).toBe('p1')
    expect(Array.from(new Uint8Array(docBlob!.bytes))).toEqual([0, 1, 127, 255])
    expect((await db.visualSourceImages.get('v1'))?.projectId).toBe('p1')
    expect(await db.documentBlobs.get('orphan')).toBeUndefined()
    // Tables the old version did not have are simply empty.
    expect(await db.table('vocabCards').count()).toBe(0)
  })

  it('rejects a backup from a newer app version and keeps the data', async () => {
    await seed(db)
    const before = await snapshot(db)
    const file = backupFile({ schemaVersion: db.verno + 1, projects: [] })
    await expectBackupError(
      new DataManagementService(db).restoreFromFile(file),
      'BACKUP_NEWER_VERSION',
    )
    expect(await snapshot(db)).toEqual(before)
  })

  it('rejects truncated and corrupted files and keeps the data', async () => {
    await seed(db)
    const service = new DataManagementService(db)
    const text = await (await service.exportFile()).text()
    const before = await snapshot(db)

    const truncated = new Blob([text.slice(0, Math.floor(text.length * 0.6))])
    await expectBackupError(service.restoreFromFile(truncated), 'BACKUP_INVALID')

    const badBase64 = new Blob([text.replace('"bytesBase64":"', '"bytesBase64":"!!')])
    await expectBackupError(service.restoreFromFile(badBase64), 'BACKUP_INVALID')

    const badJson = new Blob([text.replace('"projects":[', '"projects":[{,')])
    await expectBackupError(service.restoreFromFile(badJson), 'BACKUP_INVALID')

    await expectBackupError(service.inspectBackup(new Blob(['not json'])), 'BACKUP_INVALID')
    expect(await snapshot(db)).toEqual(before)
  })

  it('rolls everything back when a write fails mid-restore', async () => {
    await seed(db)
    const service = new DataManagementService(db)
    const file = await service.exportFile()
    await new ProjectService(db).create({ name: 'Newer', subject: 'cs' })
    const before = await snapshot(db)
    // The failure is logged on purpose; keep the test output quiet.
    vi.spyOn(console, 'error').mockImplementation(() => undefined)

    // Fails after all rows were written, on the first stored file.
    const unsubscribe = () => db.documentBlobs.hook('creating').unsubscribe(fail)
    function fail(): void {
      throw new Error('disk error')
    }
    db.documentBlobs.hook('creating', fail)
    await expect(service.restoreFromFile(file)).rejects.toThrow('disk error')
    unsubscribe()
    expect(await snapshot(db)).toEqual(before)

    // Fails while writing table rows.
    db.mistakes.hook('creating', () => {
      throw new Error('row error')
    })
    await expect(service.restoreFromFile(file)).rejects.toThrow('row error')
    expect(await snapshot(db)).toEqual(before)
  })

  it('refuses before writing when browser storage cannot hold the backup', async () => {
    await seed(db)
    const service = new DataManagementService(db)
    const file = await service.exportFile()
    const before = await snapshot(db)
    Object.defineProperty(globalThis.navigator, 'storage', {
      configurable: true,
      value: { estimate: async () => ({ quota: 100, usage: 90 }) },
    })
    await expect(service.restoreFromFile(file)).rejects.toThrow()
    expect(await snapshot(db)).toEqual(before)
  })

  it('ignores and reports unknown or excluded tables, and drops rows without a key', async () => {
    const file = backupFile({
      schemaVersion: 17,
      projects: [{ id: 'p1', name: 'P' }, { name: 'no id' }, 'not a row'],
      user: [{ id: 'someone-else' }],
      futureTable: [{ id: 'x' }],
      cryptoKeys: [{ id: 'device', key: 'foreign' }],
    })
    const service = new DataManagementService(db)
    const summary = await service.inspectBackup(file)
    expect(summary.ignoredTables).toEqual(['futureTable', 'cryptoKeys'])
    expect(summary.droppedRows).toEqual({ projects: 2, user: 1 })
    expect(summary.counts.projects).toBe(1)

    await db.table('cryptoKeys').put({ id: 'device', key: 'mine' })
    await service.restoreFromFile(file)
    expect(await db.projects.count()).toBe(1)
    expect(await db.table('user').count()).toBe(0)
    expect(await db.table('cryptoKeys').get('device')).toEqual({ id: 'device', key: 'mine' })
  })

  it('reads files written by JSON.stringify(exportAll()), pretty-printed, in tiny chunks', async () => {
    await seed(db)
    const service = new DataManagementService(db)
    const before = await snapshot(db)
    const pretty = new Blob([JSON.stringify(await service.exportAll(), null, 2)])
    await db.delete()
    db = new AppDatabase()
    setDbForTesting(db)
    const fresh = new DataManagementService(db)
    await fresh.restoreFromFile(pretty, { chunkSize: 1 })
    expect(await snapshot(db)).toEqual(before)
  })

  it('decodes a blob split across read chunks at every offset', async () => {
    const bytes = Uint8Array.from({ length: 50 }, (_, i) => (i * 37) % 256)
    const base64 = btoa(String.fromCharCode(...bytes))
    const text = JSON.stringify({
      json: { schemaVersion: 17, note: '中文 “引号” \\" }]' },
      blobs: [{ id: 'b', kind: 'document', projectId: 'p', mimeType: 'x', bytesBase64: base64 }],
    })
    for (const chunkSize of [1, 2, 3, 5, 7, 64]) {
      let seen: Uint8Array | null = null
      await scanBackup(
        new Blob([text]),
        {
          tableStart: () => false,
          blob: (entry) => {
            seen = new Uint8Array(entry.bytes!)
          },
        },
        { chunkSize, decodeBlobs: true },
      )
      expect(Array.from(seen!)).toEqual(Array.from(bytes))
    }
  })
})
