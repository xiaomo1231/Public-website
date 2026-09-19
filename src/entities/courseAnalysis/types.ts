import type { DifficultyLevel } from '@/infrastructure/ai/prompts/types'

export interface SourceReference {
  documentId: string
  documentName: string
  page?: number
  slideNumber?: number
  section?: string
  quote?: string
  /**
   * Chunk this reference was resolved from. Always set from local data —
   * never taken from the model's output.
   */
  chunkId?: string
}

export interface Topic {
  id: string
  projectId: string
  name: string
  description: string
  order: number
  sourceRefs: SourceReference[]
  createdAt: number
}

export interface Concept {
  id: string
  projectId: string
  name: string
  definition: string
  explanation?: string
  topicIds: string[]
  sourceRefs: SourceReference[]
  createdAt: number
}

export interface Formula {
  id: string
  projectId: string
  name: string
  latex: string
  description: string
  variables: Array<{ symbol: string; meaning: string }>
  topicIds: string[]
  sourceRefs: SourceReference[]
  createdAt: number
}

export interface CourseSymbol {
  id: string
  projectId: string
  symbol: string
  meaning: string
  context: string
  unit?: string
  topicIds: string[]
  sourceRefs: SourceReference[]
  createdAt: number
}

export interface Example {
  id: string
  projectId: string
  title: string
  problem: string
  solution?: string
  topicIds: string[]
  sourceRefs: SourceReference[]
  createdAt: number
}

export interface CourseExercise {
  id: string
  projectId: string
  prompt: string
  difficulty: DifficultyLevel
  topicIds: string[]
  sourceRefs: SourceReference[]
  createdAt: number
}

export interface Prerequisite {
  id: string
  projectId: string
  name: string
  description: string
  topicIds: string[]
  createdAt: number
}

export type AnalysisStatus = 'pending' | 'analyzing' | 'ready' | 'failed'

export interface CourseAnalysis {
  id: string
  projectId: string
  status: AnalysisStatus
  language: 'zh' | 'en' | 'mixed'
  progress: number
  errorMessage?: string
  documentIds: string[]
  topicCount: number
  formulaCount: number
  symbolCount: number
  startedAt: number
  finishedAt?: number
  /** Prompt version that produced this analysis. */
  promptVersion: string
}