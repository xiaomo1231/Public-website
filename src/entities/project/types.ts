export type Subject =
  | 'calculus'
  | 'linear_algebra'
  | 'discrete_math'
  | 'physics'
  | 'chemistry'
  | 'biology'
  | 'cs'
  | 'stats'
  | 'other'

import type { TranslationKey } from '@/i18n/types'

export const SUBJECT_LABEL_KEYS: Record<Subject, TranslationKey> = {
  calculus: 'subject.calculus',
  linear_algebra: 'subject.linearAlgebra',
  discrete_math: 'subject.discreteMath',
  physics: 'subject.physics',
  chemistry: 'subject.chemistry',
  biology: 'subject.biology',
  cs: 'subject.computerScience',
  stats: 'subject.statistics',
  other: 'subject.other',
}

export interface Project {
  id: string
  name: string
  subject: Subject
  description?: string
  createdAt: number
  updatedAt: number
}

export interface CreateProjectInput {
  name: string
  subject: Subject
  description?: string
}

export interface UpdateProjectInput {
  name?: string
  subject?: Subject
  description?: string
}