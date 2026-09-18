export type Subject =
  | 'calculus'
  | 'linear_algebra'
  | 'physics'
  | 'chemistry'
  | 'cs'
  | 'stats'
  | 'other'

export const SUBJECT_LABELS: Record<Subject, string> = {
  calculus: 'Calculus',
  linear_algebra: 'Linear Algebra',
  physics: 'Physics',
  chemistry: 'Chemistry',
  cs: 'Computer Science',
  stats: 'Statistics',
  other: 'Other',
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