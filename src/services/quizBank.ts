import type { DifficultyLevel } from '@/infrastructure/ai/prompts/types'
import type { QuestionType } from '@/entities/question/types'
import type { QuizBankSlot, QuizConfig } from '@/entities/quiz/types'
import { DIFFICULTY_ORDER, stepDifficulty } from './adaptiveDifficulty'

/**
 * 题库式自适应测验: an adaptive quiz is generated as a bank of questions at
 * several levels per slot, and after each answer the adaptive model picks the
 * next one from it. Pure helpers; `QuizService` stores and serves.
 */

/** The bank holds at most this many times the quiz length… */
export const BANK_MAX_FACTOR = 2.5
/** …and never more than this many questions (token cost). */
export const BANK_MAX_QUESTIONS = 60
/**
 * The model adjusts only after this many graded answers, so the first slots
 * are only needed at the starting level.
 */
const FIXED_LEADING_SLOTS = 2

/**
 * Adaptive topic / mixed / weakness quizzes use a bank. Review sessions and
 * practice-this-mistake quizzes keep their one-shot plan.
 */
export function usesQuestionBank(config: QuizConfig): boolean {
  return (
    config.difficulty === 'adaptive' &&
    (config.mode === 'topic' || config.mode === 'mixed' || config.mode === 'weakness') &&
    !config.sourceMistakeId
  )
}

/**
 * The bank for a quiz of `count` questions starting at `start`: the leading
 * slots at `start` only, every later slot one level easier, the same and one
 * harder. Over the cap (2.5 × count, at most 60), off-level entries are
 * dropped from the last slots first — alternating sides, so both directions
 * stay available — but every slot keeps its `start` question. Slot-major order.
 */
export function planBank(count: number, start: DifficultyLevel): QuizBankSlot[] {
  const easier = stepDifficulty(start, -1)
  const harder = stepDifficulty(start, +1)
  const levels = (slot: number): DifficultyLevel[] =>
    slot < FIXED_LEADING_SLOTS ? [start] : [...new Set([easier, start, harder])]
  const perSlot = Array.from({ length: Math.max(0, count) }, (_, slot) => levels(slot))
  const cap = Math.min(BANK_MAX_QUESTIONS, Math.max(count, Math.floor(count * BANK_MAX_FACTOR)))
  let total = perSlot.reduce((sum, list) => sum + list.length, 0)
  // First pass drops one off-level per slot (harder on odd slots, easier on
  // even ones), the second pass the other one.
  for (let pass = 0; pass < 2 && total > cap; pass++) {
    for (let slot = perSlot.length - 1; slot >= 0 && total > cap; slot--) {
      const list = perSlot[slot]!
      const offLevels = list.filter((level) => level !== start)
      if (offLevels.length === 0) continue
      const preferred = slot % 2 === 1 ? harder : easier
      const drop = offLevels.includes(preferred) && pass === 0 ? preferred : offLevels[0]!
      perSlot[slot] = list.filter((level) => level !== drop)
      total -= 1
    }
  }
  return perSlot.flatMap((list, slot) => list.map((difficulty) => ({ slot, difficulty })))
}

export interface BankCandidate {
  questionId: string
  /** The quiz slot the question was generated for. */
  slot: number
  difficulty: DifficultyLevel
  knowledgePoint: string
  type: QuestionType
}

function distance(a: DifficultyLevel, b: DifficultyLevel): number {
  return Math.abs(DIFFICULTY_ORDER.indexOf(a) - DIFFICULTY_ORDER.indexOf(b))
}

/**
 * The next question to serve: from the next planned slot, the unused
 * question nearest the target level (exact first). The previous question's
 * knowledge point is avoided when possible — among equally near questions of
 * the slot, or by swapping in a later slot's question of the same type and
 * level distance. A slot with nothing left falls back to the nearest level of
 * any slot (the nearest slot first). `null` when the bank is used up.
 */
export function selectNextBankQuestion(input: {
  candidates: BankCandidate[]
  served: ReadonlySet<string>
  slot: number
  target: DifficultyLevel
  previousKnowledgePoint?: string
}): BankCandidate | null {
  const unused = input.candidates
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => !input.served.has(candidate.questionId))
  if (unused.length === 0) return null
  const repeats = (candidate: BankCandidate) =>
    input.previousKnowledgePoint !== undefined &&
    candidate.knowledgePoint === input.previousKnowledgePoint
      ? 1
      : 0
  const rank = (
    list: typeof unused,
    slotDistance: (candidate: BankCandidate) => number,
  ): BankCandidate | null => {
    const sorted = [...list].sort(
      (a, b) =>
        distance(a.candidate.difficulty, input.target) -
          distance(b.candidate.difficulty, input.target) ||
        repeats(a.candidate) - repeats(b.candidate) ||
        slotDistance(a.candidate) - slotDistance(b.candidate) ||
        a.index - b.index,
    )
    return sorted[0]?.candidate ?? null
  }

  const inSlot = unused.filter(({ candidate }) => candidate.slot === input.slot)
  if (inSlot.length === 0) {
    return rank(unused, (candidate) => {
      const gap = candidate.slot - input.slot
      // Later slots before earlier ones at the same distance.
      return gap >= 0 ? gap * 2 : -gap * 2 + 1
    })
  }
  const best = rank(inSlot, () => 0)!
  if (!repeats(best)) return best
  // Swap in a later slot's question of the same type and level distance
  // whose knowledge point differs.
  const wanted = distance(best.difficulty, input.target)
  const swap = unused
    .filter(
      ({ candidate }) =>
        candidate.slot > input.slot &&
        candidate.type === best.type &&
        !repeats(candidate) &&
        distance(candidate.difficulty, input.target) === wanted,
    )
    .sort((a, b) => a.candidate.slot - b.candidate.slot || a.index - b.index)[0]
  return swap?.candidate ?? best
}
