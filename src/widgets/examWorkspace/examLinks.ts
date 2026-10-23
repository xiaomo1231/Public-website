import type { ExamLinkContext } from '@/services/studyPlanService'
import type { PlannedExam } from '@/entities/studyPlan/types'
import type { HomeworkSet } from '@/entities/homework/types'
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

/** The homework-page views a paper / assignment opens in, from this exam. */
export function paperEntryLinks(
  exam: ExamRef,
  row: { set: Pick<HomeworkSet, 'id' | 'status'>; kind: 'exam' | 'homework' },
): Array<{ key: 'walkthrough' | 'practice' | 'guided' | 'proofread' | 'mock'; to: string }> {
  const base = `/projects/${exam.projectId}/homework/${row.set.id}`
  const links: Array<{
    key: 'walkthrough' | 'practice' | 'guided' | 'proofread' | 'mock'
    to: string
  }> = []
  if (row.kind === 'exam' && row.set.status === 'ready')
    links.push({ key: 'mock', to: fromWorkspace(exam, `${base}/exam`) })
  links.push(
    { key: 'walkthrough', to: fromWorkspace(exam, `${base}?view=walkthrough`) },
    { key: 'practice', to: fromWorkspace(exam, base) },
    { key: 'guided', to: fromWorkspace(exam, `${base}?view=guided`) },
    { key: 'proofread', to: fromWorkspace(exam, `${base}?view=proofread`) },
  )
  return links
}
