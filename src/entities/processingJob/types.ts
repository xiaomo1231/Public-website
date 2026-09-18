export type ProcessingStage =
  | 'queued'
  | 'extracting'
  | 'chunking'
  | 'indexing'
  | 'done'
  | 'failed'

export interface ProcessingJob {
  id: string
  documentId: string
  projectId: string
  stage: ProcessingStage
  progress: number
  message?: string
  startedAt: number
  updatedAt: number
  finishedAt?: number
  errorMessage?: string
}