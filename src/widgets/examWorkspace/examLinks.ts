import type { ExamLinkContext } from '@/services/studyPlanService'
import type { PlannedExam } from '@/entities/studyPlan/types'
import { withExamReturn, withParams } from '@/features/studyPlan/examReturn'

/**
 * Links from a 考试工作台 to the other features, pre-filled with the exam:
 * its course, its scope (syllabus scope through the exam-scope picker,
 * otherwise `examId` and the page reads the exam's topics), the files picked
 * for it, and `fromExam` so the page leads back to the workspace.
 */

type ExamRef = Pick<PlannedExam, 'id' | 'projectId'>

/** A course page opened from the workspace. */
export function fromWorkspace(exam: ExamRef, path: string): string {
  return withExamReturn(path, exam.id)
}

/** 测验 over the exam's scope. */
export function examQuizLink(exam: ExamRef, link: Pick<ExamLinkContext, 'syllabus'>): string {
  return withParams(fromWorkspace(exam, `/projects/${exam.projectId}/quiz`), {
    examId: exam.id,
    ...(link.syllabus
      ? { examDoc: link.syllabus.documentId, examScope: link.syllabus.scopeId }
      : {}),
  })
}

/** 口试练习 drawn from the exam's scope. */
export function examOralLink(exam: ExamRef, link: Pick<ExamLinkContext, 'syllabus'>): string {
  return withParams(examQuizLink(exam, link), { oral: '1' })
}

/** 背单词: the course book, 考卷术语 from the exam's files. */
export function examVocabLink(exam: ExamRef): string {
  return withExamReturn(withParams('/vocab', { examId: exam.id }), exam.id)
}

/** 模拟问诊 in exam mode (language courses). */
export function examInterviewLink(exam: ExamRef): string {
  return withParams(fromWorkspace(exam, `/projects/${exam.projectId}/interview`), {
    examMode: '1',
  })
}

/** 摸底卷 with only this exam's course ticked. */
export function examDiagnosticLink(exam: ExamRef): string {
  return withParams('/plan?tab=diagnostic', { examId: exam.id })
}
