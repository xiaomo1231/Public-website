/**
 * Simulated patient interview (language courses: medical Hungarian / German).
 *
 * The oral exam is a role-play: the teacher plays a patient from a scenario
 * card, the student asks a set of required questions in the target language,
 * understands the answers and then summarises the case in English. A session
 * keeps the scenario, the whole conversation, the summary and the result.
 */

/** One thing the patient can say (a fact on the scenario card). */
export interface InterviewFact {
  id: string
  /** As on the card (target language or English), verbatim for textbook scenarios. */
  fact: string
  /** What it means in English (AI-provided help, used for the summary check). */
  englishGloss?: string
  /** The required question this fact answers, when known. */
  questionId?: string
  /** The processed chunk the fact was found in (textbook scenarios only). */
  sourceChunkId?: string
}

/** One question the student must ask. */
export interface InterviewQuestion {
  id: string
  /** The question in the target language ("Hol fáj pontosan?"). */
  label: string
  /** Its English gloss ("Pain – where exactly"). */
  englishGloss: string
  sourceChunkId?: string
}

export type InterviewScenarioSource = 'textbook' | 'generated'

export interface InterviewScenario {
  title: string
  facts: InterviewFact[]
  questions: InterviewQuestion[]
  /** `textbook`: every fact and question was found in the course material. */
  source: InterviewScenarioSource
  /** Chunks the scenario came from (empty for generated scenarios). */
  sourceChunkIds: string[]
  page?: number
}

export interface InterviewTurn {
  role: 'student' | 'patient'
  text: string
  at: number
  /** Student turns: the required questions this turn asked (closed set, validated). */
  coveredQuestionIds?: string[]
  /** Student turns: a short language correction in the explanation language. */
  correction?: string
}

export interface InterviewFactEvidence {
  factId: string
  /** Words from the student's summary, verified to occur in it. */
  quote: string
}

export interface InterviewResults {
  questions: { asked: number; total: number; askedIds: string[] }
  facts: { understood: number; total: number; evidence: InterviewFactEvidence[] }
  /** An AI estimate (0–3), never a measurement. */
  communication: { score: number; note: string; estimate: true } | null
  feedback?: string
  gradedAt: number
}

export type InterviewStatus = 'interviewing' | 'summarizing' | 'graded'

export interface InterviewSession {
  id: string
  projectId: string
  /** BCP-47 primary tag of the language spoken ('hu', 'de'). */
  targetLanguage: string
  scenario: InterviewScenario
  /** Exam simulation: checklist and corrections stay hidden until the end. */
  examMode: boolean
  turns: InterviewTurn[]
  summary: string
  results?: InterviewResults
  status: InterviewStatus
  createdAt: number
  updatedAt: number
}

/** The course's oral exam scale: 7 questions + 10 facts + 3 communication. */
export const COURSE_SCALE = { questions: 7, facts: 10, communication: 3 } as const
export const COMMUNICATION_MAX = 3

/** Required questions asked so far (union over the student's turns, checklist order). */
export function askedQuestionIds(session: Pick<InterviewSession, 'scenario' | 'turns'>): string[] {
  const asked = new Set<string>()
  for (const turn of session.turns) {
    if (turn.role === 'student') for (const id of turn.coveredQuestionIds ?? []) asked.add(id)
  }
  return session.scenario.questions.map((q) => q.id).filter((id) => asked.has(id))
}

/**
 * The result on the course's 20-point scale, only when the checklist has the
 * exam's 7 questions. Facts are scaled to 10 (one decimal).
 */
export function courseScaleScore(
  results: InterviewResults,
): { questions: number; facts: number; communication: number; total: number } | null {
  if (results.questions.total !== COURSE_SCALE.questions || results.facts.total === 0) return null
  const facts =
    Math.round((results.facts.understood / results.facts.total) * COURSE_SCALE.facts * 10) / 10
  const communication = results.communication?.score ?? 0
  return {
    questions: results.questions.asked,
    facts,
    communication,
    total: Math.round((results.questions.asked + facts + communication) * 10) / 10,
  }
}

/** Speech-recognition locale for a language tag ('hu' → 'hu-HU'). */
export function speechLocaleFor(language: string): string {
  const regions: Record<string, string> = {
    de: 'de-DE',
    hu: 'hu-HU',
    fr: 'fr-FR',
    es: 'es-ES',
    it: 'it-IT',
    en: 'en-US',
  }
  return regions[language] ?? language
}
