import type { DifficultyLevel } from '@/infrastructure/ai/prompts/types'

export interface MasteryObservation {
  at: number
  isCorrect: boolean | null
  difficulty: DifficultyLevel
  questionType: string
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