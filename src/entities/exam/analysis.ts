import { matchExamTopic, matchScore, type MatchableTopic } from '@/entities/syllabus/match'
import type { ExamScope } from '@/entities/syllabus/types'
import { parseQuestionMarks } from './marks'

/**
 * 题型与覆盖分析: local statistics over past papers — what kinds of questions
 * they ask, how many marks fall on each course topic, and which exam-scope
 * topics they touched. It describes past papers only; it never predicts the
 * next exam.
 */

export type ExamQuestionKind =
  'multiple_choice' | 'true_false' | 'fill_blank' | 'calculation' | 'proof' | 'explain' | 'other'

export const EXAM_QUESTION_KINDS: readonly ExamQuestionKind[] = [
  'multiple_choice',
  'true_false',
  'fill_blank',
  'calculation',
  'proof',
  'explain',
  'other',
]

/** One question's kind from its wording (first rule that applies). */
export function classifyExamQuestion(prompt: string): ExamQuestionKind {
  const text = prompt.toLowerCase()
  const options = (prompt.match(/(?:^|\n|\s)[(（]?[A-E][.)）]\s+\S/g) ?? []).length
  if (options >= 3) return 'multiple_choice'
  if (/true\s+or\s+false|true\/false|\bt\/f\b|判断|对错|正误/.test(text)) return 'true_false'
  if (/_{3,}|＿{2,}|\(\s*\)\s*$|（\s*）|fill\s+in|填空/.test(text)) return 'fill_blank'
  if (/\bprove\b|\bshow\s+that\b|\bderive\b|证明|推导/.test(text)) return 'proof'
  if (
    /\b(?:calculate|compute|evaluate|find|determine|solve|how\s+(?:many|much|long|far))\b|计算|求|解方程|多少/.test(
      text,
    )
  )
    return 'calculation'
  if (
    /\b(?:explain|describe|discuss|why|compare|define|justify|outline)\b|解释|说明|描述|论述|简述|为什么|名词解释|比较/.test(
      text,
    )
  )
    return 'explain'
  return 'other'
}

export interface ExamQuestionInput {
  id: string
  setId: string
  prompt: string
}

export interface ExamPaperInput {
  setId: string
  title: string
  questions: ExamQuestionInput[]
}

export interface KindStat {
  kind: ExamQuestionKind
  questions: number
  /** Marks printed for these questions (questions without printed marks add 0). */
  marks: number
}

export interface TopicStat {
  topicId: string
  name: string
  questions: number
  marks: number
}

export interface ScopeCoverage {
  scopeId: string
  label: string
  /** Exam-scope topics touched by at least one past-paper question. */
  covered: Array<{ id: string; text: string; questions: number }>
  /** Exam-scope topics no past-paper question touched. */
  notSeen: Array<{ id: string; text: string }>
}

export interface PastExamAnalysis {
  papers: number
  questions: number
  /** Questions with printed marks / total printed marks. */
  questionsWithMarks: number
  totalMarks: number
  byKind: KindStat[]
  byTopic: TopicStat[]
  /** Questions matching no course topic. */
  unmatched: { questions: number; marks: number }
  scopes: ScopeCoverage[]
}

/** The course topics a question is about (local token matching, best first). */
export function matchQuestionTopics(prompt: string, topics: MatchableTopic[]): string[] {
  return matchExamTopic(prompt, topics)
}

/** A score ≥ this between a question and an exam-scope topic counts as touching it. */
const SCOPE_TEXT_THRESHOLD = 0.45

export function analyzePastExams(input: {
  papers: ExamPaperInput[]
  topics: MatchableTopic[]
  scopes?: ExamScope[]
}): PastExamAnalysis {
  const kinds = new Map<ExamQuestionKind, KindStat>()
  const byTopic = new Map<string, TopicStat>()
  const topicName = new Map(input.topics.map((topic) => [topic.id, topic.name]))
  const unmatched = { questions: 0, marks: 0 }
  const questionTopics: Array<{ prompt: string; topicIds: string[] }> = []
  let questions = 0
  let questionsWithMarks = 0
  let totalMarks = 0

  for (const paper of input.papers) {
    for (const question of paper.questions) {
      questions += 1
      const marks = parseQuestionMarks(question.prompt).total ?? 0
      if (marks > 0) {
        questionsWithMarks += 1
        totalMarks += marks
      }
      const kind = classifyExamQuestion(question.prompt)
      const stat = kinds.get(kind) ?? { kind, questions: 0, marks: 0 }
      stat.questions += 1
      stat.marks += marks
      kinds.set(kind, stat)

      const topicIds = matchQuestionTopics(question.prompt, input.topics)
      questionTopics.push({ prompt: question.prompt, topicIds })
      if (topicIds.length === 0) {
        unmatched.questions += 1
        unmatched.marks += marks
        continue
      }
      // A question's marks are split evenly over the topics it matches.
      const share = marks / topicIds.length
      for (const id of topicIds) {
        const row = byTopic.get(id) ?? {
          topicId: id,
          name: topicName.get(id) ?? id,
          questions: 0,
          marks: 0,
        }
        row.questions += 1
        row.marks += share
        byTopic.set(id, row)
      }
    }
  }

  const scopes: ScopeCoverage[] = (input.scopes ?? []).map((scope) => {
    const covered: ScopeCoverage['covered'] = []
    const notSeen: ScopeCoverage['notSeen'] = []
    for (const item of scope.topics) {
      const ids = new Set(item.topicIds ?? [])
      const hits = questionTopics.filter(
        (question) =>
          question.topicIds.some((id) => ids.has(id)) ||
          matchScore(question.prompt, { id: item.id, name: item.text }) >= SCOPE_TEXT_THRESHOLD,
      ).length
      if (hits > 0) covered.push({ id: item.id, text: item.text, questions: hits })
      else notSeen.push({ id: item.id, text: item.text })
    }
    return { scopeId: scope.id, label: scope.label, covered, notSeen }
  })

  return {
    papers: input.papers.length,
    questions,
    questionsWithMarks,
    totalMarks,
    byKind: EXAM_QUESTION_KINDS.flatMap((kind) => {
      const stat = kinds.get(kind)
      return stat ? [stat] : []
    }),
    byTopic: [...byTopic.values()]
      .map((row) => ({ ...row, marks: Math.round(row.marks * 10) / 10 }))
      .sort((a, b) => b.marks - a.marks || b.questions - a.questions),
    unmatched,
    scopes,
  }
}
