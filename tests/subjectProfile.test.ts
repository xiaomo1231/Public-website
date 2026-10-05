import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { prompts } from '@/infrastructure/ai/prompts'
import { SUBJECT_LABEL_KEYS, type Subject } from '@/entities/project/types'
import { inferSubject } from '@/entities/project/subjectInference'
import { ProjectService } from '@/services/projectService'
import { ProjectRepository } from '@/entities/project/repository'
import { CourseAnalysisRepository } from '@/entities/courseAnalysis/repository'
import { CourseContentRepository } from '@/entities/courseContent/repository'
import { loadProjectSubject } from '@/services/projectSubject'

const { buildSubjectBlock, withSubject, subjectPromptVersion } = prompts.subjectProfile
const SUBJECTS = Object.keys(SUBJECT_LABEL_KEYS) as Subject[]

describe('subject profile prompt', () => {
  it('has a profile for every subject except "other"', () => {
    for (const subject of SUBJECTS) {
      const block = buildSubjectBlock(subject)
      if (subject === 'other') {
        expect(block).toBe('')
        continue
      }
      expect(block).toMatch(/^COURSE SUBJECT: /)
      for (const section of ['Notation:', 'Reasoning:', 'Answers:', 'Typical mistakes']) {
        expect(block, `${subject} lacks ${section}`).toContain(section)
      }
    }
  })

  it('never overrides output rules or the course material', () => {
    const block = buildSubjectBlock('physics')
    expect(block).toContain('never override explicit output rules')
    expect(block).toContain('follow the material')
    // Physics answers carry units, except where a field demands a bare number.
    expect(block).toContain('bare number')
  })

  it('keeps the non-judgemental mistake wording', () => {
    for (const subject of SUBJECTS.filter((s) => s !== 'other')) {
      expect(buildSubjectBlock(subject)).toContain('never as carelessness')
    }
  })

  it('appends to a system prompt and leaves "other" untouched', () => {
    expect(withSubject('BASE', 'other')).toBe('BASE')
    expect(withSubject('BASE', undefined)).toBe('BASE')
    const tuned = withSubject('BASE', 'linear_algebra')
    expect(tuned.startsWith('BASE\n\n')).toBe(true)
    expect(tuned).toContain('COURSE SUBJECT: Linear algebra')
  })

  it('folds the profile and subject into the stored prompt version', () => {
    expect(subjectPromptVersion('v4', 'stats')).toBe('v4+subject-profile/v1:stats')
    expect(subjectPromptVersion('v4', undefined)).toBe('v4+subject-profile/v1:other')
    expect(subjectPromptVersion('v4', 'stats')).not.toBe(subjectPromptVersion('v4', 'physics'))
  })
})

describe('inferSubject', () => {
  it.each([
    ['线性代数', 'linear_algebra'],
    ['Linear Algebra II', 'linear_algebra'],
    ['数学分析 II', 'calculus'],
    ['高等数学（上）', 'calculus'],
    ['概率论与数理统计', 'stats'],
    ['离散数学', 'discrete_math'],
    ['图论导引', 'discrete_math'],
    ['大学物理（力学）', 'physics'],
    ['分析化学', 'chemistry'],
    ['数据结构与算法', 'cs'],
    ['Intro to Python Programming', 'cs'],
  ] as const)('%s → %s', (name, expected) => {
    expect(inferSubject(name)).toBe(expected)
  })

  it('does not guess for unrecognised names', () => {
    expect(inferSubject('电路原理')).toBeNull()
    expect(inferSubject('  ')).toBeNull()
  })
})

describe('project subject drives analysis freshness', () => {
  let db: AppDatabase

  beforeEach(async () => {
    db = new AppDatabase()
    await db.delete()
    db = new AppDatabase()
    setDbForTesting(db)
  })

  it('reads the subject from the project, or nothing for a missing project', async () => {
    const project = await new ProjectService(db).create({ name: 'Sets', subject: 'discrete_math' })
    expect(await loadProjectSubject(project.id, db)).toBe('discrete_math')
    expect(await loadProjectSubject('missing', db)).toBeUndefined()
  })

  it('makes a stored analysis stale when the project subject changes', async () => {
    const project = await new ProjectService(db).create({ name: 'Algebra', subject: 'linear_algebra' })
    const content = new CourseContentRepository({ db })
    const sourceHash = await content.computeSourceHash(project.id)
    await new CourseAnalysisRepository(db).reseedProject(
      project.id,
      {
        topics: [{ name: 'Matrices', description: '', sourceRefs: [] }],
        concepts: [],
        formulas: [],
        symbols: [],
        examples: [],
        exercises: [],
        prerequisites: [],
        topicsByName: new Map(),
      },
      'en',
      { sourceHash },
    )
    expect((await content.isFresh(project.id)).fresh).toBe(true)

    await new ProjectRepository(db).update(project.id, { subject: 'calculus' })
    const freshness = await content.isFresh(project.id)
    expect(freshness.fresh).toBe(false)
    expect(freshness.reasons).toContain('prompt-changed')
  })
})
