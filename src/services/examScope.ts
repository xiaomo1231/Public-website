import type { AppDatabase } from '@/infrastructure/db/database'
import { CourseStructureRepository } from '@/entities/courseStructure/repository'
import { DocumentRepository } from '@/entities/document/repository'
import type { Document } from '@/entities/document/types'
import type { Topic } from '@/entities/courseAnalysis/types'
import type { PlannedExam } from '@/entities/studyPlan/types'
import {
  normalizeMaterials,
  resolveExamDocuments,
  reviewMaterialMinutes,
} from '@/entities/studyPlan/materials'
import {
  chapterOptionsFrom,
  chaptersScopeFromKeys,
  chapterUnits,
  isChapterSourceDocument,
  topicsFromMaterials,
  topicsInChapters,
  type ChapterOption,
  type ScopeUnit,
} from '@/entities/studyPlan/scope'

/**
 * Reads what a 「按所选资料」 / 「按章节」 exam scope stands for (see
 * `entities/studyPlan/scope.ts`), shared by the planner, the 复习提纲 and the
 * AI 模拟卷. Local only.
 */

export interface ResolvedExamScope {
  /** Course topics in scope; null = the scope does not restrict them. */
  topics: Topic[] | null
  /** Chapters / files in scope (work per unit while there are no topics). */
  units: ScopeUnit[]
}

/** The chapter checklist of a course (structure from processing; works before analysis). */
export async function loadChapterOptions(
  db: AppDatabase,
  projectId: string,
  documents?: readonly Document[],
): Promise<ChapterOption[]> {
  const repo = new CourseStructureRepository(db)
  const [docs, structures] = await Promise.all([
    documents
      ? Promise.resolve([...documents])
      : new DocumentRepository(db).listByProject(projectId),
    repo.listByProject(projectId),
  ])
  const withNodes = await Promise.all(
    structures.map(async (structure) => ({ structure, nodes: await repo.listNodes(structure.id) })),
  )
  return chapterOptionsFrom(docs, withNodes)
}

/** Chunk → file for the topics' verified source chunks. */
async function chunkDocuments(
  db: AppDatabase,
  topics: readonly Topic[],
): Promise<Map<string, string>> {
  const ids = [...new Set(topics.flatMap((topic) => topic.sourceChunkIds ?? []))]
  if (ids.length === 0) return new Map()
  const rows = await db.chunks.bulkGet(ids)
  const out = new Map<string, string>()
  for (const row of rows) if (row) out.set(row.id, row.documentId)
  return out
}

export async function resolveExamScope(
  db: AppDatabase,
  exam: Pick<PlannedExam, 'projectId' | 'scope' | 'materials'>,
  courseTopics: readonly Topic[],
  documents?: readonly Document[],
): Promise<ResolvedExamScope> {
  const scope = exam.scope
  // Before course analysis there are no topics to work with: a scope that
  // does not name chapters or files (整门课, a syllabus scope, nothing picked)
  // falls back to every chapter / file of the course.
  const wholeCourse = async (): Promise<ResolvedExamScope> => {
    if (courseTopics.length > 0) return { topics: null, units: [] }
    const docs = documents ?? (await new DocumentRepository(db).listByProject(exam.projectId))
    const options = await loadChapterOptions(db, exam.projectId, docs)
    const top = options.filter((option) => option.kind !== 'section')
    return {
      topics: null,
      units: chapterUnits(chaptersScopeFromKeys(top.map((o) => o.key)), options, docs),
    }
  }
  if (scope.kind !== 'materials' && scope.kind !== 'chapters') return wholeCourse()
  const docs = documents ?? (await new DocumentRepository(db).listByProject(exam.projectId))
  const chunkDocument = await chunkDocuments(db, courseTopics)
  if (scope.kind === 'materials') {
    const picked = resolveExamDocuments(normalizeMaterials(exam.materials), docs)
    // Nothing picked yet: the whole course.
    if (picked.length === 0) return wholeCourse()
    const ids = new Set(picked.map((entry) => entry.document.id))
    return {
      topics: topicsFromMaterials(ids, courseTopics, chunkDocument),
      units: picked
        .filter((entry) => isChapterSourceDocument(entry.document))
        .map(({ document, viaFolder }) => ({
          id: document.id,
          title: viaFolder ? `${viaFolder} / ${document.name}` : document.name,
          documentId: document.id,
          minutes: reviewMaterialMinutes(document),
        })),
    }
  }
  const options = await loadChapterOptions(db, exam.projectId, docs)
  return {
    topics: topicsInChapters(scope, courseTopics, chunkDocument),
    units: chapterUnits(scope, options, docs),
  }
}
