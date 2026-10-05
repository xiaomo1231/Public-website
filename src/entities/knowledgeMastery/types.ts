import type { DifficultyLevel } from '@/infrastructure/ai/prompts/types'

export interface MasteryObservation {
  at: number
  isCorrect: boolean | null
  difficulty: DifficultyLevel
  questionType: string
  /** Partial credit 0–1 (short answer); absent ⇒ 1 when correct, 0 when not. */
  credit?: number
  /** Evidence weight; AI-judged short answers count half. Absent ⇒ 1. */
  weight?: number
}

/**
 * A system *estimate* of how well the student knows a knowledge point.
 * This is derived from practice history — not a claim about true ability.
 */
export interface KnowledgeMastery {
  id: string
  projectId: string
  knowledgePoint: string
  topicId?: string
  /** 0–1 estimate. */
  mastery: number
  attempts: number
  correct: number
  /** Rolling window of recent observations (newest last, capped). */
  observations: MasteryObservation[]
  lastUpdated: number
}

export function masteryId(projectId: string, knowledgePoint: string): string {
  return `${projectId}::${knowledgePoint.toLowerCase()}`
}