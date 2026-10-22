import type { CompareStatus } from '@/infrastructure/ai/prompts/walkthrough-compare/v1'
import type { EvalRole } from './evalRole'
import { PARSE_ERROR_KINDS, type ParseErrorKind } from '@/entities/homework/proofread'

/**
 * 检验网站: one evaluation run on one assignment, stored on the set
 * (`HomeworkSet.evaluations`, newest first — no new table, no Dexie bump;
 * the record holds counts and short conclusions only).
 *
 * Three abilities are measured separately, plus parsing accuracy:
 * - `solve`   独立解题: written WITHOUT the professor answer, then compared with it.
 * - `aligned` 依据教授答案讲解: written WITH the answer, checked to follow it.
 * - `grading` 批改学生作答: the student's answer graded against the confirmed
 *   reference, compared with the teacher's mark where one was entered.
 * - parsing   from 导入校对 edits: how many questions needed corrections, by kind.
 *
 * Comparing with the professor answer is an aid: final correctness needs a
 * person who knows the course, and a small sample says nothing course-wide.
 */
export type EvaluationAbility = 'solve' | 'aligned' | 'grading'

export const EVALUATION_ABILITIES: readonly EvaluationAbility[] = ['solve', 'aligned', 'grading']

export const MAX_EVALUATION_RECORDS = 10
/** Conclusions kept per item (for a person to read), in characters. */
export const EVALUATION_TEXT_LIMIT = 600

/** One question's result for `solve` / `aligned`. */
export interface EvaluationWalkthroughResult {
  /** Worst sub-part status (`result_differs` > missing > `method_differs` > `same`). */
  status: CompareStatus | 'insufficient' | 'failed'
  conclusion?: string
  notes?: string[]
  error?: string
}

export type EvaluationVerdict = 'correct' | 'partial' | 'incorrect' | 'uncertain'

export interface EvaluationGradingResult {
  verdict?: EvaluationVerdict
  method?: 'local' | 'ai'
  /** The teacher's mark, when one was entered. */
  teacher?: 'correct' | 'partial' | 'incorrect'
  error?: string
}

export interface EvaluationItem {
  questionId: string
  label: string
  role: EvalRole | 'none'
  solve?: EvaluationWalkthroughResult
  aligned?: EvaluationWalkthroughResult
  grading?: EvaluationGradingResult
}

export interface ParsingSummary {
  questions: number
  edited: number
  byKind: Record<ParseErrorKind, number>
  verified: number
}

export interface EvaluationRecord {
  id: string
  projectId: string
  setId: string
  startedAt: number
  finishedAt?: number
  status: 'running' | 'paused' | 'done'
  model: string
  promptVersions: Record<string, string>
  abilities: EvaluationAbility[]
  /** Roles of the questions included. */
  roles: Array<EvalRole | 'none'>
  items: EvaluationItem[]
  parsing: ParsingSummary
}

const SEVERITY: Record<EvaluationWalkthroughResult['status'], number> = {
  same: 0,
  not_in_professor: 1,
  method_differs: 2,
  missing_in_walkthrough: 3,
  result_differs: 4,
  insufficient: 5,
  failed: 6,
}

/** The worst status across a question's sub-parts. */
export function worstStatus(
  statuses: ReadonlyArray<EvaluationWalkthroughResult['status']>,
): EvaluationWalkthroughResult['status'] {
  return statuses.reduce<EvaluationWalkthroughResult['status']>(
    (worst, status) => (SEVERITY[status] > SEVERITY[worst] ? status : worst),
    'same',
  )
}

export interface WalkthroughAbilitySummary {
  /** Questions with a result (failed runs excluded). */
  n: number
  same: number
  methodDiffers: number
  resultDiffers: number
  other: number
  failed: number
}

export interface GradingSummary {
  graded: number
  withTeacher: number
  agree: number
  uncertain: number
  failed: number
}

export interface RoleSummary {
  role: EvalRole | 'none'
  solve: WalkthroughAbilitySummary
  aligned: WalkthroughAbilitySummary
  grading: GradingSummary
}

function walkthroughSummary(
  results: ReadonlyArray<EvaluationWalkthroughResult | undefined>,
): WalkthroughAbilitySummary {
  const summary: WalkthroughAbilitySummary = {
    n: 0,
    same: 0,
    methodDiffers: 0,
    resultDiffers: 0,
    other: 0,
    failed: 0,
  }
  for (const result of results) {
    if (!result) continue
    if (result.status === 'failed') {
      summary.failed += 1
      continue
    }
    summary.n += 1
    if (result.status === 'same') summary.same += 1
    else if (result.status === 'method_differs') summary.methodDiffers += 1
    else if (result.status === 'result_differs') summary.resultDiffers += 1
    else summary.other += 1
  }
  return summary
}

/** Whether a grader verdict agrees with the teacher's mark. */
export function gradingAgrees(
  verdict: EvaluationVerdict | undefined,
  teacher: EvaluationGradingResult['teacher'],
): boolean | undefined {
  if (!verdict || !teacher || verdict === 'uncertain') return undefined
  return verdict === teacher
}

function gradingSummary(
  results: ReadonlyArray<EvaluationGradingResult | undefined>,
): GradingSummary {
  const summary: GradingSummary = { graded: 0, withTeacher: 0, agree: 0, uncertain: 0, failed: 0 }
  for (const result of results) {
    if (!result) continue
    if (result.error) {
      summary.failed += 1
      continue
    }
    summary.graded += 1
    if (result.verdict === 'uncertain') summary.uncertain += 1
    const agree = gradingAgrees(result.verdict, result.teacher)
    if (agree !== undefined) {
      summary.withTeacher += 1
      if (agree) summary.agree += 1
    }
  }
  return summary
}

/** Counts per role (development and independent results are never pooled). */
export function summarizeEvaluation(record: Pick<EvaluationRecord, 'items'>): RoleSummary[] {
  const roles: Array<EvalRole | 'none'> = ['development', 'independent', 'regression', 'none']
  return roles
    .map((role) => {
      const items = record.items.filter((item) => item.role === role)
      return {
        role,
        solve: walkthroughSummary(items.map((item) => item.solve)),
        aligned: walkthroughSummary(items.map((item) => item.aligned)),
        grading: gradingSummary(items.map((item) => item.grading)),
        size: items.length,
      }
    })
    .filter((entry) => entry.size > 0)
    .map(({ size: _size, ...entry }) => entry)
}

/** Parsing accuracy from the questions' proofreading edits. */
export function parsingSummary(
  questions: ReadonlyArray<{
    edits?: ReadonlyArray<{ kinds: ParseErrorKind[] }>
    verifiedAt?: number
  }>,
): ParsingSummary {
  const byKind = Object.fromEntries(PARSE_ERROR_KINDS.map((kind) => [kind, 0])) as Record<
    ParseErrorKind,
    number
  >
  let edited = 0
  let verified = 0
  for (const question of questions) {
    if (question.verifiedAt) verified += 1
    const kinds = new Set((question.edits ?? []).flatMap((edit) => edit.kinds))
    if (kinds.size === 0) continue
    edited += 1
    for (const kind of kinds) byKind[kind] += 1
  }
  return { questions: questions.length, edited, byKind, verified }
}

const pct = (part: number, whole: number): string =>
  whole > 0 ? `${Math.round((100 * part) / whole)}%` : '—'

/** A readable export of one record (the JSON export is the record itself). */
export function evaluationMarkdown(record: EvaluationRecord, title: string): string {
  const out: string[] = []
  out.push(`# 检验网站 · ${title}`)
  out.push('')
  out.push(`- 时间：${new Date(record.startedAt).toISOString()}`)
  out.push(`- 模型：${record.model || '—'}`)
  out.push(
    `- 提示词版本：${Object.entries(record.promptVersions)
      .map(([key, value]) => `${key} ${value}`)
      .join('，')}`,
  )
  out.push(`- 状态：${record.status}`)
  out.push('')
  out.push(
    '> 「与教授答案对照」只是辅助；最终正误需要懂这门课的人判断。样本很小时不能代表整门课的准确率（见各项 n）。',
  )
  out.push('')
  const p = record.parsing
  out.push('## 识别准确性（来自导入校对）')
  out.push('')
  out.push(
    `- 题目 n = ${p.questions}，已核对 ${p.verified}，需要修改 ${p.edited}（${pct(p.edited, p.questions)}）`,
  )
  for (const kind of PARSE_ERROR_KINDS)
    if (p.byKind[kind]) out.push(`  - ${kind}: ${p.byKind[kind]}`)
  out.push('')
  for (const summary of summarizeEvaluation(record)) {
    out.push(`## 题目角色：${summary.role}`)
    out.push('')
    for (const [name, value] of [
      ['独立解题（不看教授答案）', summary.solve],
      ['依据教授答案讲解', summary.aligned],
    ] as const) {
      if (value.n === 0 && value.failed === 0) continue
      out.push(
        `- ${name}：n = ${value.n}；一致 ${value.same}（${pct(value.same, value.n)}），方法不同 ${value.methodDiffers}，结果不同 ${value.resultDiffers}，其它 ${value.other}；失败 ${value.failed}`,
      )
    }
    const g = summary.grading
    if (g.graded > 0 || g.failed > 0)
      out.push(
        `- 批改学生作答：已批改 n = ${g.graded}，有教师评分 ${g.withTeacher}，一致 ${g.agree}（${pct(g.agree, g.withTeacher)}），无法判定 ${g.uncertain}；失败 ${g.failed}`,
      )
    out.push('')
  }
  out.push('## 逐题')
  out.push('')
  out.push('| 题 | 角色 | 独立解题 | 依据教授答案 | 批改 / 教师 |')
  out.push('| --- | --- | --- | --- | --- |')
  for (const item of record.items) {
    const grading = item.grading
      ? `${item.grading.error ? 'failed' : (item.grading.verdict ?? '—')} / ${item.grading.teacher ?? '—'}`
      : '—'
    out.push(
      `| ${item.label} | ${item.role} | ${item.solve?.status ?? '—'} | ${item.aligned?.status ?? '—'} | ${grading} |`,
    )
  }
  out.push('')
  return out.join('\n')
}
