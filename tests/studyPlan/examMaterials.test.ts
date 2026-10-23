import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { ProjectService } from '@/services/projectService'
import { StudyPlanService } from '@/services/studyPlanService'
import { DocumentRepository } from '@/entities/document/repository'
import { uploadDocument } from '@/features/documents/uploadPipeline'
import { createFileQueueItems } from '@/features/documents/batchUpload'
import {
  folderOfRelativePath,
  groupByFolder,
  isInFolder,
  listFolders,
  normalizeFolderPath,
  suggestMaterialType,
} from '@/entities/document/folders'
import {
  normalizeMaterials,
  resolveExamDocuments,
  reviewMaterialMinutes,
} from '@/entities/studyPlan/materials'
import { filesFromDataTransfer, filesFromInput } from '@/infrastructure/files/folderEntries'
import { buildSchedule, type SchedulerExam } from '@/entities/studyPlan/scheduler'
import { addDays } from '@/entities/studyPlan/calendar'
import { DEFAULT_CALENDAR } from '@/entities/studyPlan/types'
import type { Document } from '@/entities/document/types'

function doc(id: string, folderPath?: string, extra: Partial<Document> = {}): Document {
  return {
    id,
    projectId: 'p',
    type: 'pdf',
    name: `${id}.pdf`,
    sizeBytes: 1,
    hasBlob: false,
    status: 'ready',
    warnings: [],
    metadata: {},
    uploadedAt: 1,
    ...(folderPath ? { folderPath } : {}),
    ...extra,
  }
}

describe('folders', () => {
  it('normalizes paths and reads the folder of a relative path', () => {
    expect(normalizeFolderPath(' \\Week 3\\ /Slides/ ')).toBe('Week 3/Slides')
    expect(normalizeFolderPath('../a/./b')).toBe('a/b')
    expect(folderOfRelativePath('Course/Week 3/L1.pdf')).toBe('Course/Week 3')
    expect(folderOfRelativePath('L1.pdf')).toBe('')
    expect(isInFolder('Course/Week 3', 'Course')).toBe(true)
    expect(isInFolder('Course 2', 'Course')).toBe(false)
  })

  it('lists folders with their parents and groups files by folder', () => {
    const docs = [doc('a', 'C/W1'), doc('b', 'C/W2'), doc('c')]
    expect(listFolders(docs)).toEqual(['C', 'C/W1', 'C/W2'])
    expect(groupByFolder(docs).map((g) => [g.folder, g.documents.length])).toEqual([
      ['C/W1', 1],
      ['C/W2', 1],
      ['', 1],
    ])
  })

  it('suggests roles from file and folder names', () => {
    expect(suggestMaterialType('Midterm 2024.pdf')).toBe('past_exam')
    expect(suggestMaterialType('2024.pdf', 'Past exams')).toBe('past_exam')
    expect(suggestMaterialType('HW3 solutions.pdf')).toBe('homework_answer')
    expect(suggestMaterialType('hw3.pdf')).toBe('homework')
    expect(suggestMaterialType('Course syllabus.docx')).toBe('syllabus')
    expect(suggestMaterialType('Lecture 4.pptx', 'Week 2/Slides')).toBe('textbook')
    expect(suggestMaterialType('my notes.md')).toBe('user_notes')
    expect(suggestMaterialType('sheet1.pdf', 'Homework')).toBe('homework')
  })

  it('reads relative paths from an input and walks a dropped folder', async () => {
    const file = new File(['x'], 'L1.pdf')
    Object.defineProperty(file, 'webkitRelativePath', { value: 'Course/Week 1/L1.pdf' })
    expect(filesFromInput([file]).map((f) => f.path)).toEqual(['Course/Week 1/L1.pdf'])

    const leaf = (name: string) => ({
      isFile: true,
      isDirectory: false,
      name,
      file: (ok: (f: File) => void) => ok(new File(['x'], name)),
    })
    const dir = (name: string, children: unknown[]) => {
      let read = false
      return {
        isFile: false,
        isDirectory: true,
        name,
        createReader: () => ({
          readEntries: (ok: (entries: unknown[]) => void) => {
            ok(read ? [] : children)
            read = true
          },
        }),
      }
    }
    const root = dir('Course', [leaf('a.pdf'), leaf('.DS_Store'), dir('Week 2', [leaf('b.pdf')])])
    const transfer = {
      items: [{ webkitGetAsEntry: () => root }],
      files: [],
    } as unknown as DataTransfer
    const found = await filesFromDataTransfer(transfer)
    expect(found.map((f) => f.path)).toEqual(['Course/a.pdf', 'Course/Week 2/b.pdf'])
  })

  it('carries folder and suggested role into the upload queue', () => {
    const file = new File(['x'], 'Final 2023.pdf', { type: 'application/pdf' })
    const [item] = createFileQueueItems([file], [], 'textbook', {
      folderOf: () => 'Past papers',
      roleOf: (f) => suggestMaterialType(f.name, 'Past papers'),
    })
    expect(item).toMatchObject({ folderPath: 'Past papers', materialType: 'past_exam' })
  })
})

describe('exam materials', () => {
  it('resolves picked files and folders (a folder includes files added later)', () => {
    const docs = [doc('a', 'W1'), doc('b', 'W1/Extra'), doc('c', 'W2'), doc('d')]
    const materials = normalizeMaterials({ documentIds: ['d'], folderPaths: ['W1'] })
    expect(resolveExamDocuments(materials, docs).map((e) => [e.document.id, e.viaFolder])).toEqual([
      ['d', undefined],
      ['a', 'W1'],
      ['b', 'W1'],
    ])
    const later = [...docs, doc('e', 'W1')]
    expect(resolveExamDocuments(materials, later).some((e) => e.document.id === 'e')).toBe(true)
    // Old rows without the new fields still resolve their review documents.
    expect(
      resolveExamDocuments(
        { pastExamSetIds: [], reviewDocumentIds: ['c'], practiceSetIds: [], homeworkSetIds: [] },
        docs,
      ).map((e) => e.document.id),
    ).toEqual(['c'])
  })

  it('estimates reading minutes from pages / slides', () => {
    expect(reviewMaterialMinutes({ metadata: { pageCount: 6 } })).toBe(20)
    expect(reviewMaterialMinutes({ metadata: { slideCount: 30 } })).toBe(45)
    expect(reviewMaterialMinutes({ metadata: { pageCount: 400 } })).toBe(60)
    expect(reviewMaterialMinutes({ metadata: {} })).toBe(20)
  })

  it('schedules review files and review-sheet topics as tasks before the exam', () => {
    const today = '2026-11-02'
    const exam: SchedulerExam = {
      id: 'e1',
      projectId: 'p1',
      name: 'Midterm',
      date: addDays(today, 10),
      weight: 100,
      topics: [],
      mocks: [],
      sets: [],
      reviewDocs: [
        { id: 'doc1', title: 'W1 / Lecture 1.pdf', minutes: 30 },
        { id: 'doc2', title: 'Notes.pdf', minutes: 20, done: true },
      ],
      reviewSheets: [{ id: 'review:e1:s1', title: 'Matrices', minutes: 10 }],
      mistakesDue: 0,
      openMistakes: 0,
      cardsDue: 0,
    }
    const result = buildSchedule({ today, calendar: DEFAULT_CALENDAR, exams: [exam] })
    const tasks = result.days.flatMap((d) => d.tasks)
    const material = tasks.filter((t) => t.kind === 'review_material')
    expect(material.map((t) => [t.refId, t.title, t.minutes])).toEqual([
      ['doc1', 'W1 / Lecture 1.pdf', 30],
    ])
    const sheet = tasks.filter((t) => t.kind === 'review_sheet')
    expect(sheet.map((t) => t.refId)).toEqual(['review:e1:s1'])
    // The sheet comes first (higher priority than a file).
    expect(tasks.indexOf(sheet[0]!)).toBeLessThan(tasks.indexOf(material[0]!))
    for (const task of tasks) expect(task.date < exam.date).toBe(true)
  })
})

describe('folder uploads and the plan', () => {
  let db: AppDatabase
  beforeEach(() => {
    db = new AppDatabase()
    setDbForTesting(db)
  })
  afterEach(() => db.close())

  it('keeps the relative folder path on upload, and moving only edits it', async () => {
    const project = await new ProjectService(db).create({ name: 'C', subject: 'other' })
    const uploaded = await uploadDocument({
      projectId: project.id,
      type: 'text',
      text: 'Eigenvalues and eigenvectors of a matrix.',
      name: 'notes.txt',
      folderPath: 'Week 3/Notes',
    })
    const repo = new DocumentRepository(db)
    const stored = await repo.get(uploaded.id)
    expect(stored.folderPath).toBe('Week 3/Notes')
    expect(stored.status).toBe('ready')
    const moved = await repo.update(uploaded.id, { folderPath: 'Week 4' })
    expect(moved.folderPath).toBe('Week 4')
    expect(moved.name).toBe(stored.name)
    expect(moved.chunkCount).toBe(stored.chunkCount)
    const out = await repo.update(uploaded.id, { folderPath: null })
    expect(out.folderPath).toBeUndefined()
  })

  it('turns picked files and folders into plan materials', async () => {
    const project = await new ProjectService(db).create({ name: 'LA', subject: 'linear_algebra' })
    const repo = new DocumentRepository(db)
    const make = async (
      name: string,
      folderPath: string,
      materialType: Document['materialType'],
    ) => {
      const created = await repo.create({
        projectId: project.id,
        type: 'pdf',
        name,
        sizeBytes: 1,
        materialType: materialType!,
        folderPath,
      })
      return repo.update(created.id, { status: 'ready', metadata: { pageCount: 10 } })
    }
    const slides = await make('L1.pdf', 'Week 1', 'textbook')
    const paper = await make('Midterm 2024.pdf', 'Past', 'past_exam')
    await db.table('homeworkSets').put({
      id: 'set-paper',
      projectId: project.id,
      documentId: paper.id,
      title: 'Midterm 2024',
      kind: 'exam',
      status: 'ready',
      createdAt: 1,
      updatedAt: 1,
    })
    const service = new StudyPlanService({ db })
    const now = new Date(2026, 10, 2, 8).getTime()
    const [exam] = await service.addExams(
      [
        {
          projectId: project.id,
          name: 'Midterm',
          at: now + 12 * 86_400_000,
          materials: { folderPaths: ['Week 1'], documentIds: [paper.id] },
        },
      ],
      now,
    )
    const later = await make('L2.pdf', 'Week 1', 'textbook')
    const context = await service.examContext(exam!.id, now)
    expect(context.reviewDocs.map((d) => d.id).sort()).toEqual([slides.id, later.id].sort())
    expect(context.reviewDocs[0]!.title).toMatch(/^Week 1 \/ /)
    expect(context.reviewDocs[0]!.minutes).toBe(30)
    expect(context.mocks.map((m) => m.id)).toEqual(['set-paper'])
    await service.replan(now)
    const tasks = await db.table('studyTasks').toArray()
    expect(tasks.filter((t) => t.kind === 'review_material')).toHaveLength(2)
  })
})
