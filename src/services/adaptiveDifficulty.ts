import type { DifficultyLevel } from '@/infrastructure/ai/prompts/types'
import type { MasteryObservation } from '@/entities/knowledgeMastery/types'
import { t } from '@/i18n'

export const DIFFICULTY_ORDER: DifficultyLevel[] = [
  'beginner',
  'basic',
  'intermediate',
  'advanced',
  'challenge',
]

export const DEFAULT_DIFFICULTY: DifficultyLevel = 'basic'

const MIN_SAMPLES = 2
const WINDOW = 5

export function difficultyWeight(difficulty: DifficultyLevel): number {
  switch (difficulty) {
    case 'beginner':
      return 0.6
    case 'basic':
      return 0.8
    case 'intermediate':
      return 1
    case 'advanced':
      return 1.2
    case 'challenge':
      return 1.4
    default:
      return 1
  }
}

export function clampDifficulty(index: number): DifficultyLevel {
  const clamped = Math.max(0, Math.min(DIFFICULTY_ORDER.length - 1, index))
  return DIFFICULTY_ORDER[clamped]!
}

export function stepDifficulty(current: DifficultyLevel, delta: number): DifficultyLevel {
  return clampDifficulty(DIFFICULTY_ORDER.indexOf(current) + delta)
}

export interface AdaptiveInput {
  currentDifficulty: DifficultyLevel
  /** Recent attempts, oldest first. `isCorrect: null` means unverified. */
  recentResults: Array<{ isCorrect: boolean | null; difficulty: DifficultyLevel }>
  consecutiveCorrect: number
  consecutiveWrong: number
  /** 0–1 estimate from the knowledge-point history. */
  knowledgePointMastery: number
}

export interface AdaptiveDecision {
  difficulty: DifficultyLevel
  changed: boolean
  reason: string
  metrics: {
    recentAccuracy: number | null
    weightedAccuracy: number | null
    composite: number | null
    sampleSize: number
  }
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}

/**
 * Decide the next difficulty from practice history.
 *
 * The decision combines several signals so a single lucky/unlucky answer
 * cannot move the level:
 *   - recent accuracy over the last 5 graded answers
 *   - difficulty-weighted accuracy (harder questions count more)
 *   - knowledge-point mastery estimate
 *   - consecutive correct / wrong streaks
 *
 * At least two graded answers are required before any adjustment.
 */
export function decideNextDifficulty(input: AdaptiveInput): AdaptiveDecision {
  const graded = input.recentResults.filter((r) => r.isCorrect !== null)
  const metricsBase = {
    recentAccuracy: null as number | null,
    weightedAccuracy: null as number | null,
    composite: null as number | null,
    sampleSize: graded.length,
  }

  if (graded.length < MIN_SAMPLES) {
    return {
      difficulty: input.currentDifficulty,
      changed: false,
      reason: t('difficultyReason.needMore', { count: MIN_SAMPLES }),
      metrics: metricsBase,
    }
  }

  const recent = graded.slice(-WINDOW)
  const recentAccuracy = recent.filter((r) => r.isCorrect).length / recent.length

  let weightedSum = 0
  let weightedTotal = 0
  for (const r of recent) {
    const w = difficultyWeight(r.difficulty)
    weightedTotal += w
    if (r.isCorrect) weightedSum += w
  }
  const weightedAccuracy = weightedTotal > 0 ? weightedSum / weightedTotal : recentAccuracy

  const streakSignal = clamp01((input.consecutiveCorrect - input.consecutiveWrong) / 3 / 2 + 0.5)

  const composite =
    0.45 * recentAccuracy +
    0.25 * weightedAccuracy +
    0.2 * clamp01(input.knowledgePointMastery) +
    0.1 * streakSignal

  const metrics = {
    recentAccuracy,
    weightedAccuracy,
    composite,
    sampleSize: graded.length,
  }

  // Strong streak signals take precedence, but must not contradict accuracy.
  if (input.consecutiveWrong >= 2 && recentAccuracy < 0.5) {
    const difficulty = stepDifficulty(input.currentDifficulty, -1)
    return {
      difficulty,
      changed: difficulty !== input.currentDifficulty,
      reason: t('difficultyReason.streakWrong', { streak: input.consecutiveWrong, accuracy: Math.round(recentAccuracy * 100) }),
      metrics,
    }
  }
  if (input.consecutiveCorrect >= 2 && recentAccuracy >= 0.6) {
    const difficulty = stepDifficulty(input.currentDifficulty, +1)
    return {
      difficulty,
      changed: difficulty !== input.currentDifficulty,
      reason: t('difficultyReason.streakCorrect', { streak: input.consecutiveCorrect, accuracy: Math.round(recentAccuracy * 100) }),
      metrics,
    }
  }

  if (composite >= 0.68) {
    const difficulty = stepDifficulty(input.currentDifficulty, +1)
    return {
      difficulty,
      changed: difficulty !== input.currentDifficulty,
      reason: t('difficultyReason.aboveThreshold', { score: composite.toFixed(2) }),
      metrics,
    }
  }
  if (composite <= 0.38) {
    const difficulty = stepDifficulty(input.currentDifficulty, -1)
    return {
      difficulty,
      changed: difficulty !== input.currentDifficulty,
      reason: t('difficultyReason.belowThreshold', { score: composite.toFixed(2) }),
      metrics,
    }
  }
  return {
    difficulty: input.currentDifficulty,
    changed: false,
    reason: t('difficultyReason.stable', { score: composite.toFixed(2) }),
    metrics,
  }
}

/**
 * Estimate mastery from observations. Newer observations and harder
 * questions contribute more. This is a system estimate, not ground truth.
 */
export function computeMastery(observations: MasteryObservation[]): number {
  const graded = observations.filter((o) => o.isCorrect !== null)
  if (graded.length === 0) return 0
  let numerator = 0
  let denominator = 0
  graded.forEach((obs, index) => {
    const recency = Math.pow(0.9, graded.length - 1 - index)
    const weight = recency * difficultyWeight(obs.difficulty)
    denominator += weight
    if (obs.isCorrect) numerator += weight
  })
  if (denominator === 0) return 0
  return clamp01(numerator / denominator)
}

export function nextStreaks(
  isCorrect: boolean | null,
  consecutiveCorrect: number,
  consecutiveWrong: number,
): { consecutiveCorrect: number; consecutiveWrong: number } {
  if (isCorrect === null) return { consecutiveCorrect, consecutiveWrong }
  if (isCorrect) return { consecutiveCorrect: consecutiveCorrect + 1, consecutiveWrong: 0 }
  return { consecutiveCorrect: 0, consecutiveWrong: consecutiveWrong + 1 }
}

/** Suggested difficulty for the next question in an adaptive sequence. */
export function suggestNextDifficulty(
  currentDifficulty: DifficultyLevel,
  results: Array<{ isCorrect: boolean | null; difficulty: DifficultyLevel }>,
  consecutiveCorrect: number,
  consecutiveWrong: number,
  mastery: number,
): AdaptiveDecision {
  return decideNextDifficulty({
    currentDifficulty,
    recentResults: results,
    consecutiveCorrect,
    consecutiveWrong,
    knowledgePointMastery: mastery,
  })
}