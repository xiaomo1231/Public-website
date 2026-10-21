import type {
  RawScenario,
  RawScenarioFact,
  RawScenarioQuestion,
} from '@/infrastructure/ai/prompts/interview-scenario/v1'
import type { InterviewPatientOutput } from '@/infrastructure/ai/prompts/interview-patient/v1'
import type { InterviewSummaryCheckOutput } from '@/infrastructure/ai/prompts/interview-summary-check/v1'
import { evidenceKey, isMeaningfulEvidence, isVerbatimEvidence } from './shortAnswerGrader'
import {
  COMMUNICATION_MAX,
  askedQuestionIds,
  type InterviewFact,
  type InterviewQuestion,
  type InterviewResults,
  type InterviewScenario,
  type InterviewSession,
} from '@/entities/interview/types'

/**
 * Local checks for everything the AI produces in a patient interview. Pure
 * functions: scenario cards must come from the course text, a patient turn
 * may only name required questions from the closed list, and the summary
 * score is computed here from verified quotes.
 */

const MAX_TITLE = 120
const MAX_TEXT = 300
const MAX_FACTS = 20
const MAX_QUESTIONS = 12
const MAX_REPLY = 600
const MAX_CORRECTION = 300
const MAX_NOTE = 200
const MAX_FEEDBACK = 600
const MAX_EVIDENCE = 200

function text(value: unknown, max = MAX_TEXT): string {
  return typeof value === 'string'
    ? value.normalize('NFC').replace(/­/g, '').replace(/\s+/g, ' ').trim().slice(0, max)
    : ''
}

/** True when `needle` occurs in `haystack`, ignoring case, spacing and punctuation. */
export function occursIn(needle: string, haystack: string): boolean {
  const key = evidenceKey(needle)
  return key.length >= 2 && evidenceKey(haystack).includes(key)
}

/**
 * Keep the questions and facts of one raw scenario. For a textbook scenario
 * (`chunks` given) every fact must occur in the chunk it names, and every
 * question must have its label or its English gloss there; the rest is
 * dropped. Ids are renumbered locally (q1…, f1…); a fact's `questionId` is
 * kept only when it names a kept question.
 */
function validateOne(
  raw: RawScenario,
  chunks: Map<string, { id: string; text: string; pageNumber?: number }> | null,
): InterviewScenario | null {
  const questionIds = new Map<string, string>()
  const questions: InterviewQuestion[] = []
  const seenQuestions = new Set<string>()
  for (const item of (Array.isArray(raw.questions) ? raw.questions : []) as RawScenarioQuestion[]) {
    if (!item || typeof item !== 'object') continue
    const label = text(item.label)
    const englishGloss = text(item.englishGloss)
    if (!label && !englishGloss) continue
    let sourceChunkId: string | undefined
    if (chunks) {
      const chunk = chunks.get(text(item.sourceChunkId))
      if (!chunk) continue
      if (
        !(label && occursIn(label, chunk.text)) &&
        !(englishGloss && occursIn(englishGloss, chunk.text))
      )
        continue
      sourceChunkId = chunk.id
    }
    const key = evidenceKey(englishGloss || label)
    if (seenQuestions.has(key)) continue
    seenQuestions.add(key)
    const id = `q${questions.length + 1}`
    if (typeof item.id === 'string') questionIds.set(item.id, id)
    questions.push({
      id,
      label: label || englishGloss,
      englishGloss: englishGloss || label,
      ...(sourceChunkId ? { sourceChunkId } : {}),
    })
    if (questions.length >= MAX_QUESTIONS) break
  }

  const facts: InterviewFact[] = []
  const seenFacts = new Set<string>()
  for (const item of (Array.isArray(raw.facts) ? raw.facts : []) as RawScenarioFact[]) {
    if (!item || typeof item !== 'object') continue
    const fact = text(item.fact)
    if (!fact || /[…_]{2,}|\.{3,}/.test(fact)) continue
    let sourceChunkId: string | undefined
    if (chunks) {
      const chunk = chunks.get(text(item.sourceChunkId))
      if (!chunk || !occursIn(fact, chunk.text)) continue
      sourceChunkId = chunk.id
    }
    const key = evidenceKey(fact)
    if (!key || seenFacts.has(key)) continue
    seenFacts.add(key)
    const englishGloss = text(item.englishGloss)
    const questionId =
      typeof item.questionId === 'string' ? questionIds.get(item.questionId) : undefined
    facts.push({
      id: `f${facts.length + 1}`,
      fact,
      ...(englishGloss ? { englishGloss } : {}),
      ...(questionId ? { questionId } : {}),
      ...(sourceChunkId ? { sourceChunkId } : {}),
    })
    if (facts.length >= MAX_FACTS) break
  }

  // A scenario worth practising: a patient with a few facts and questions.
  if (facts.length < 3 || questions.length < 2) return null
  const sourceChunkIds = [
    ...new Set(
      [...questions, ...facts].flatMap((item) => (item.sourceChunkId ? [item.sourceChunkId] : [])),
    ),
  ]
  const firstChunk = sourceChunkIds.length ? chunks?.get(sourceChunkIds[0]!) : undefined
  return {
    title: text(raw.title, MAX_TITLE) || facts[0]!.fact.slice(0, MAX_TITLE),
    facts,
    questions,
    source: chunks ? 'textbook' : 'generated',
    sourceChunkIds,
    ...(firstChunk?.pageNumber !== undefined ? { page: firstChunk.pageNumber } : {}),
  }
}

/** Textbook scenarios: only what is found in the named chunks survives. */
export function validateTextbookScenarios(
  raw: RawScenario[],
  chunks: Map<string, { id: string; text: string; pageNumber?: number }>,
): InterviewScenario[] {
  const kept: InterviewScenario[] = []
  const seen = new Set<string>()
  for (const item of raw) {
    const scenario = validateOne(item, chunks)
    if (!scenario) continue
    const key = scenario.facts.map((f) => evidenceKey(f.fact)).join('|')
    if (seen.has(key)) continue
    seen.add(key)
    kept.push(scenario)
  }
  return kept
}

/**
 * A generated scenario (no textbook source). With `required` questions, the
 * scenario's checklist is that list (the course's own), whatever the model
 * returned for it.
 */
export function validateGeneratedScenario(
  raw: RawScenario | undefined,
  required?: Array<Pick<InterviewQuestion, 'label' | 'englishGloss'>>,
): InterviewScenario | null {
  if (!raw) return null
  const scenario = validateOne(raw, null)
  if (!scenario) return null
  if (required?.length) {
    const questions = required.slice(0, MAX_QUESTIONS).map((q, i) => ({
      id: `q${i + 1}`,
      label: q.label,
      englishGloss: q.englishGloss,
    }))
    // Fact → question links by the English gloss when the model echoed it.
    const byGloss = new Map(scenario.questions.map((q) => [q.id, evidenceKey(q.englishGloss)]))
    const facts = scenario.facts.map((fact) => {
      const gloss = fact.questionId ? byGloss.get(fact.questionId) : undefined
      const match = gloss ? questions.find((q) => evidenceKey(q.englishGloss) === gloss) : undefined
      const { questionId: _drop, ...rest } = fact
      void _drop
      return match ? { ...rest, questionId: match.id } : rest
    })
    return { ...scenario, questions, facts }
  }
  return scenario
}

/** A patient turn as returned by the model, checked; null when there is no usable reply. */
export function readPatientTurn(
  output: unknown,
  questionIds: readonly string[],
): { reply: string; coveredQuestionIds: string[]; correction?: string } | null {
  if (!output || typeof output !== 'object') return null
  const data = output as InterviewPatientOutput
  const reply = typeof data.reply === 'string' ? data.reply.trim().slice(0, MAX_REPLY) : ''
  if (!reply) return null
  const allowed = new Set(questionIds)
  const covered = [
    ...new Set(
      (Array.isArray(data.coveredQuestionIds) ? data.coveredQuestionIds : []).filter(
        (id): id is string => typeof id === 'string' && allowed.has(id),
      ),
    ),
  ]
  const correction =
    typeof data.correction === 'string' ? data.correction.trim().slice(0, MAX_CORRECTION) : ''
  return {
    reply,
    coveredQuestionIds: questionIds.filter((id) => covered.includes(id)),
    ...(correction && !/^(null|none|无|没有)$/i.test(correction) ? { correction } : {}),
  }
}

/**
 * The result of an interview: questions asked from the turns, facts
 * understood from verified quotes of the summary (one quote earns one fact),
 * and the communication estimate clamped to 0–3.
 */
export function buildInterviewResults(
  session: Pick<InterviewSession, 'scenario' | 'turns' | 'summary'>,
  output: InterviewSummaryCheckOutput | null,
  now = Date.now(),
): InterviewResults {
  const askedIds = askedQuestionIds(session)
  const decisions = new Map<string, { understood: boolean; evidence: string }>()
  for (const raw of Array.isArray(output?.facts) ? output!.facts : []) {
    if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') continue
    decisions.set(raw.id, {
      understood: raw.understood === true,
      evidence: typeof raw.evidence === 'string' ? raw.evidence.trim().slice(0, MAX_EVIDENCE) : '',
    })
  }
  const used = new Set<string>()
  const evidence: InterviewResults['facts']['evidence'] = []
  for (const fact of session.scenario.facts) {
    const decision = decisions.get(fact.id)
    if (!decision?.understood || !decision.evidence) continue
    const key = evidenceKey(decision.evidence)
    if (
      used.has(key) ||
      !isVerbatimEvidence(decision.evidence, session.summary) ||
      !isMeaningfulEvidence(decision.evidence, fact.englishGloss ?? fact.fact)
    )
      continue
    used.add(key)
    evidence.push({ factId: fact.id, quote: decision.evidence })
  }

  const rawScore = output?.communication?.score
  const score =
    typeof rawScore === 'number' && Number.isFinite(rawScore)
      ? Math.max(0, Math.min(COMMUNICATION_MAX, Math.round(rawScore)))
      : null
  const note = text(output?.communication?.note, MAX_NOTE)
  const feedback = text(output?.feedback, MAX_FEEDBACK)

  return {
    questions: { asked: askedIds.length, total: session.scenario.questions.length, askedIds },
    facts: { understood: evidence.length, total: session.scenario.facts.length, evidence },
    communication: score === null ? null : { score, note, estimate: true },
    ...(feedback ? { feedback } : {}),
    gradedAt: now,
  }
}
