import type { AppDatabase } from '@/infrastructure/db/database'
import { getDb } from '@/infrastructure/db/database'
import type {
  Concept,
  CourseAnalysis,
  CourseExercise,
  CourseSymbol,
  Example,
  Formula,
  Prerequisite,
  SourceReference,
  Topic,
} from './types'
import { COURSE_ANALYSIS_SCHEMA_VERSION } from './types'
import type { DifficultyLevel } from '@/infrastructure/ai/prompts/types'
import { prompts } from '@/infrastructure/ai/prompts'
import { logger } from '@/infrastructure/logger/logger'
import { StorageError } from '@/infrastructure/errors/AppError'
import { t } from '@/i18n'

/** Provenance recorded alongside a freshly written analysis. */
export interface ReseedMeta {
  /** Reuse the in-progress analysis row so we don't leave a stale one behind. */
  analysisId?: string
  /** Prompt version that produced this result. Defaults to the registered analyzer. */
  promptVersion?: string
  /** Fingerprint of the sources this result was derived from. */
  sourceHash?: string
  /** Data-shape version; defaults to the current `COURSE_ANALYSIS_SCHEMA_VERSION`. */
  schemaVersion?: string
  /** `CourseStructure.version` this result was derived from. */
  derivedFromStructureVersion?: number
  /** Content fingerprint of the structure this result was derived from. */
  derivedFromStructureHash?: string
}

export class CourseAnalysisRepository {
  private db: AppDatabase

  constructor(db?: AppDatabase) {
    this.db = db ?? getDb()
  }

  async getByProject(projectId: string): Promise<CourseAnalysis | undefined> {
    return this.db.table<CourseAnalysis, string>('courseAnalyses').where('projectId').equals(projectId).first()
  }

  async upsert(analysis: CourseAnalysis): Promise<CourseAnalysis> {
    await this.db.table<CourseAnalysis, string>('courseAnalyses').put(analysis)
    return analysis
  }

  // Topics
  async addTopics(items: Topic[]): Promise<Topic[]> {
    if (items.length === 0) return []
    await this.db.table<Topic, string>('topics').bulkPut(items)
    return items
  }
  async listTopics(projectId: string): Promise<Topic[]> {
    return this.db.table<Topic, string>('topics').where('projectId').equals(projectId).sortBy('order')
  }
  async getTopic(id: string): Promise<Topic | undefined> {
    return this.db.table<Topic, string>('topics').get(id)
  }

  // Concepts
  async addConcepts(items: Concept[]): Promise<Concept[]> {
    if (items.length === 0) return []
    await this.db.table<Concept, string>('concepts').bulkPut(items)
    return items
  }
  async listConcepts(projectId: string): Promise<Concept[]> {
    return this.db.table<Concept, string>('concepts').where('projectId').equals(projectId).toArray()
  }

  // Formulas
  async addFormulas(items: Formula[]): Promise<Formula[]> {
    if (items.length === 0) return []
    await this.db.table<Formula, string>('formulas').bulkPut(items)
    return items
  }
  async listFormulas(projectId: string): Promise<Formula[]> {
    return this.db.table<Formula, string>('formulas').where('projectId').equals(projectId).toArray()
  }
  async listFormulasByTopic(topicId: string): Promise<Formula[]> {
    const all = await this.db.table<Formula, string>('formulas').toArray()
    return all.filter((f) => f.topicIds.includes(topicId))
  }

  // Symbols
  async addSymbols(items: CourseSymbol[]): Promise<CourseSymbol[]> {
    if (items.length === 0) return []
    await this.db.table<CourseSymbol, string>('symbols').bulkPut(items)
    return items
  }
  async listSymbols(projectId: string): Promise<CourseSymbol[]> {
    return this.db.table<CourseSymbol, string>('symbols').where('projectId').equals(projectId).toArray()
  }
  async listSymbolsByTopic(topicId: string): Promise<CourseSymbol[]> {
    const all = await this.db.table<CourseSymbol, string>('symbols').toArray()
    return all.filter((s) => s.topicIds.includes(topicId))
  }

  // Examples
  async addExamples(items: Example[]): Promise<Example[]> {
    if (items.length === 0) return []
    await this.db.table<Example, string>('examples').bulkPut(items)
    return items
  }
  async listExamples(projectId: string): Promise<Example[]> {
    return this.db.table<Example, string>('examples').where('projectId').equals(projectId).toArray()
  }

  // Exercises
  async addExercises(items: CourseExercise[]): Promise<CourseExercise[]> {
    if (items.length === 0) return []
    await this.db.table<CourseExercise, string>('courseExercises').bulkPut(items)
    return items
  }
  async listExercises(projectId: string): Promise<CourseExercise[]> {
    return this.db.table<CourseExercise, string>('courseExercises').where('projectId').equals(projectId).toArray()
  }

  // Prerequisites
  async addPrerequisites(items: Prerequisite[]): Promise<Prerequisite[]> {
    if (items.length === 0) return []
    await this.db.table<Prerequisite, string>('prerequisites').bulkPut(items)
    return items
  }
  async listPrerequisites(projectId: string): Promise<Prerequisite[]> {
    return this.db.table<Prerequisite, string>('prerequisites').where('projectId').equals(projectId).toArray()
  }

  /** Remove the analysis row and all of its derived entities for a project. */
  async deleteByProject(projectId: string): Promise<void> {
    try {
      await this.db.transaction(
        'rw',
        [
          this.db.table('courseAnalyses'),
          this.db.table('topics'),
          this.db.table('concepts'),
          this.db.table('formulas'),
          this.db.table('symbols'),
          this.db.table('examples'),
          this.db.table('courseExercises'),
          this.db.table('prerequisites'),
        ],
        async () => {
          await Promise.all([
            this.db.table('courseAnalyses').where('projectId').equals(projectId).delete(),
            this.db.table('topics').where('projectId').equals(projectId).delete(),
            this.db.table('concepts').where('projectId').equals(projectId).delete(),
            this.db.table('formulas').where('projectId').equals(projectId).delete(),
            this.db.table('symbols').where('projectId').equals(projectId).delete(),
            this.db.table('examples').where('projectId').equals(projectId).delete(),
            this.db.table('courseExercises').where('projectId').equals(projectId).delete(),
            this.db.table('prerequisites').where('projectId').equals(projectId).delete(),
          ])
        },
      )
    } catch (err) {
      logger.error('deleteByProject failed', { projectId }, err)
      throw new StorageError(t('storage.failedToClearAnalysis'), err)
    }
  }

  async reseedProject(
    projectId: string,
    seed: {
      topics: Array<{
        name: string
        description: string
        sourceRefs: SourceReference[]
        chapterId?: string
        sectionId?: string
        chapterNumber?: string
        sectionNumber?: string
        chapterTitle?: string
        sectionTitle?: string
      }>
      concepts: Array<{ name: string; definition: string; explanation?: string; topicNames: string[]; sourceRefs: SourceReference[] }>
      formulas: Array<{ name: string; latex: string; description: string; variables: Array<{ symbol: string; meaning: string }>; topicNames: string[]; sourceRefs: SourceReference[] }>
      symbols: Array<{ symbol: string; meaning: string; context: string; unit?: string; topicNames: string[]; sourceRefs: SourceReference[] }>
      examples: Array<{ title: string; problem: string; solution?: string; topicNames: string[]; sourceRefs: SourceReference[] }>
      exercises: Array<{ prompt: string; difficulty: DifficultyLevel; topicNames: string[]; sourceRefs: SourceReference[] }>
      prerequisites: Array<{ name: string; description: string; topicNames: string[] }>
      topicsByName: Map<string, string>
      /** Documents that contributed to this analysis (used for source grounding). */
      documentIds?: string[]
    },
    language: CourseAnalysis['language'],
    meta: ReseedMeta = {},
  ): Promise<void> {
    const now = Date.now()
    const lookup = (names: string[]): string[] =>
      names.map((n) => seed.topicsByName.get(n) ?? '').filter(Boolean)

    const topics: Topic[] = seed.topics.map((t, idx) => ({
      // Respect the caller-provided id map so downstream references stay valid.
      id: seed.topicsByName.get(t.name) ?? crypto.randomUUID(),
      projectId,
      name: t.name,
      description: t.description,
      order: idx,
      topicIds: [],
      sourceRefs: t.sourceRefs,
      ...(t.chapterId ? { chapterId: t.chapterId } : {}),
      ...(t.sectionId ? { sectionId: t.sectionId } : {}),
      ...(t.chapterNumber ? { chapterNumber: t.chapterNumber } : {}),
      ...(t.sectionNumber ? { sectionNumber: t.sectionNumber } : {}),
      ...(t.chapterTitle ? { chapterTitle: t.chapterTitle } : {}),
      ...(t.sectionTitle ? { sectionTitle: t.sectionTitle } : {}),
      createdAt: now,
    }))

    const concepts: Concept[] = seed.concepts.map((c) => ({
      id: crypto.randomUUID(),
      projectId,
      name: c.name,
      definition: c.definition,
      ...(c.explanation ? { explanation: c.explanation } : {}),
      topicIds: lookup(c.topicNames),
      sourceRefs: c.sourceRefs,
      createdAt: now,
    }))
    const formulas: Formula[] = seed.formulas.map((f) => ({
      id: crypto.randomUUID(),
      projectId,
      name: f.name,
      latex: f.latex,
      description: f.description,
      variables: f.variables,
      topicIds: lookup(f.topicNames),
      sourceRefs: f.sourceRefs,
      createdAt: now,
    }))
    const symbols: CourseSymbol[] = seed.symbols.map((s) => ({
      id: crypto.randomUUID(),
      projectId,
      symbol: s.symbol,
      meaning: s.meaning,
      context: s.context,
      ...(s.unit ? { unit: s.unit } : {}),
      topicIds: lookup(s.topicNames),
      sourceRefs: s.sourceRefs,
      createdAt: now,
    }))
    const examples: Example[] = seed.examples.map((e) => ({
      id: crypto.randomUUID(),
      projectId,
      title: e.title,
      problem: e.problem,
      ...(e.solution ? { solution: e.solution } : {}),
      topicIds: lookup(e.topicNames),
      sourceRefs: e.sourceRefs,
      createdAt: now,
    }))
    const exercises: CourseExercise[] = seed.exercises.map((e) => ({
      id: crypto.randomUUID(),
      projectId,
      prompt: e.prompt,
      difficulty: e.difficulty,
      topicIds: lookup(e.topicNames),
      sourceRefs: e.sourceRefs,
      createdAt: now,
    }))
    const prerequisites: Prerequisite[] = seed.prerequisites.map((p) => ({
      id: crypto.randomUUID(),
      projectId,
      name: p.name,
      description: p.description,
      topicIds: lookup(p.topicNames),
      createdAt: now,
    }))

    await this.replaceProjectData(projectId, {
      topics,
      concepts,
      formulas,
      symbols,
      examples,
      exercises,
      prerequisites,
      analysis: {
        id: meta.analysisId ?? crypto.randomUUID(),
        projectId,
        status: 'ready',
        language,
        progress: 100,
        documentIds: seed.documentIds ?? [],
        topicCount: topics.length,
        formulaCount: formulas.length,
        symbolCount: symbols.length,
        startedAt: now,
        finishedAt: now,
        // Never hardcode this: the caller knows which prompt actually ran.
        promptVersion: meta.promptVersion ?? prompts.documentAnalyzer.VERSION,
        sourceHash: meta.sourceHash ?? '',
        schemaVersion: meta.schemaVersion ?? COURSE_ANALYSIS_SCHEMA_VERSION,
        ...(meta.derivedFromStructureVersion !== undefined
          ? { derivedFromStructureVersion: meta.derivedFromStructureVersion }
          : {}),
        ...(meta.derivedFromStructureHash !== undefined
          ? { derivedFromStructureHash: meta.derivedFromStructureHash }
          : {}),
      },
    })
  }

  /**
   * Replace every derived record for a project in a single transaction.
   *
   * The previous implementation deleted and then re-wrote table by table, so a
   * failure half way through could leave the project with only part of an
   * analysis. One Dexie transaction means either the whole new result lands or
   * the old one is left untouched.
   */
  private async replaceProjectData(
    projectId: string,
    next: {
      topics: Topic[]
      concepts: Concept[]
      formulas: Formula[]
      symbols: CourseSymbol[]
      examples: Example[]
      exercises: CourseExercise[]
      prerequisites: Prerequisite[]
      analysis: CourseAnalysis
    },
  ): Promise<void> {
    const table = (name: string) => this.db.table(name)
    try {
      await this.db.transaction(
        'rw',
        [
          table('courseAnalyses'),
          table('topics'),
          table('concepts'),
          table('formulas'),
          table('symbols'),
          table('examples'),
          table('courseExercises'),
          table('prerequisites'),
        ],
        async () => {
          await Promise.all([
            table('topics').where('projectId').equals(projectId).delete(),
            table('concepts').where('projectId').equals(projectId).delete(),
            table('formulas').where('projectId').equals(projectId).delete(),
            table('symbols').where('projectId').equals(projectId).delete(),
            table('examples').where('projectId').equals(projectId).delete(),
            table('courseExercises').where('projectId').equals(projectId).delete(),
            table('prerequisites').where('projectId').equals(projectId).delete(),
          ])
          await Promise.all([
            next.topics.length > 0 ? table('topics').bulkPut(next.topics) : Promise.resolve(),
            next.concepts.length > 0 ? table('concepts').bulkPut(next.concepts) : Promise.resolve(),
            next.formulas.length > 0 ? table('formulas').bulkPut(next.formulas) : Promise.resolve(),
            next.symbols.length > 0 ? table('symbols').bulkPut(next.symbols) : Promise.resolve(),
            next.examples.length > 0 ? table('examples').bulkPut(next.examples) : Promise.resolve(),
            next.exercises.length > 0
              ? table('courseExercises').bulkPut(next.exercises)
              : Promise.resolve(),
            next.prerequisites.length > 0
              ? table('prerequisites').bulkPut(next.prerequisites)
              : Promise.resolve(),
          ])
          await table('courseAnalyses').put(next.analysis)
        },
      )
    } catch (err) {
      logger.error('reseedProject failed; the previous analysis was kept', { projectId }, err)
      throw new StorageError(t('storage.failedToClearAnalysis'), err)
    }
  }
}