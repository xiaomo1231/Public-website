import type { AppDatabase } from '@/infrastructure/db/database'
import { ProjectRepository } from '@/entities/project/repository'
import { CourseContextRepository } from '@/entities/courseContext/repository'
import {
  professorConventions,
  sigFigHabitItems,
  type ProfessorConventions,
} from '@/entities/questionHabits/types'
import {
  DEFAULT_SIG_FIG_POLICY,
  isSigFigOnlyError,
  normalizeSigFigPolicy,
  type AnswerDimensions,
  type SigFigPolicy,
} from '@/entities/question/answerDimensions'
import { dimensionsNote, sigFigRuleText } from './answerDimensionsFeedback'

/**
 * The course's significant-figure rule (「有效数字评分规则」). Unset, unknown
 * or unreadable ⇒ the platform default: hint only, no deduction.
 */
export async function projectSigFigPolicy(
  projectId: string,
  db?: AppDatabase,
): Promise<SigFigPolicy> {
  try {
    const project = await new ProjectRepository(db).get(projectId)
    return normalizeSigFigPolicy(project.sigFigPolicy)
  } catch {
    return DEFAULT_SIG_FIG_POLICY
  }
}

/**
 * What the professor's habits profile says about significant figures (items
 * of the `sig_figs` category), shown next to the course rule so the student
 * can copy the professor's rule into it.
 */
export async function loadSigFigHabitStatements(
  projectId: string,
  db?: AppDatabase,
): Promise<string[]> {
  const context = await new CourseContextRepository(db).get(projectId).catch(() => undefined)
  return sigFigHabitItems(context?.questionHabits).map((item) => item.statement)
}

/**
 * Practice-set answers checked locally: the per-part value / unit / sig-fig
 * notes, and whether the course rule deducts for a significant-figure slip
 * (a fully correct answer then becomes `partial`).
 */
export function practiceSigFigFeedback(
  dimensions: ReadonlyArray<AnswerDimensions | undefined>,
  policy: SigFigPolicy,
  labels: ReadonlyArray<string | undefined> = [],
): { notes: string[]; deducted: boolean } {
  const notes: string[] = []
  let slipped = false
  let any = false
  dimensions.forEach((each, index) => {
    if (!each) return
    any = true
    const note = dimensionsNote(each, { given: '' })
    if (note) notes.push(labels[index] ? `(${labels[index]}) ${note}` : note)
    if (isSigFigOnlyError({ dimensions: each })) slipped = true
  })
  if (any) notes.push(sigFigRuleText(policy))
  return { notes, deducted: slipped && policy.mode === 'deduct' }
}

/** Conventions question generators follow (from the habits profile; none when off or empty). */
export async function loadProfessorConventions(
  projectId: string,
  db?: AppDatabase,
): Promise<ProfessorConventions> {
  const context = await new CourseContextRepository(db).get(projectId).catch(() => undefined)
  return professorConventions(context?.questionHabits)
}
