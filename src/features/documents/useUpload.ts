import { useCallback, useState } from 'react'
import { DocumentService } from '@/services/documentService'
import { ProcessingService } from '@/services/processingService'
import { DocumentRepository } from '@/entities/document/repository'
import { ChunkRepository } from '@/entities/chunk/repository'
import { ProcessingJobRepository } from '@/entities/processingJob/repository'
import { ProjectService } from '@/services/projectService'
import { getDb } from '@/infrastructure/db/database'
import { useDocumentsStore } from './documentsStore'
import { validateFile, validateTextInput } from '@/infrastructure/files/validation'
import { toast } from '@/features/toast/toastStore'
import { isAppError } from '@/infrastructure/errors/AppError'
import type { DocumentType } from '@/entities/document/types'

interface UploadInput {
  type: DocumentType
  file?: File
  text?: string
  name?: string
}

interface UploadState {
  uploading: boolean
  progress: number
  message?: string
}

export function useDocumentUpload(projectId: string) {
  const refresh = useDocumentsStore((s) => s.refresh)
  const [state, setState] = useState<UploadState>({ uploading: false, progress: 0 })

  const upload = useCallback(
    async (input: UploadInput) => {
      setState({ uploading: true, progress: 5, message: 'Validating…' })
      try {
        let blob: Blob | undefined
        let name: string
        let mimeType: string | undefined
        let sizeBytes: number
        let type: DocumentType

        if (input.type === 'text') {
          const text = input.text ?? ''
          validateTextInput(text)
          blob = new Blob([text], { type: 'text/plain' })
          name = input.name?.trim() || `Pasted note ${new Date().toISOString().slice(0, 10)}.txt`
          mimeType = 'text/plain'
          sizeBytes = blob.size
          type = 'text'
        } else {
          if (!input.file) throw new Error('No file provided')
          type = validateFile(input.file)
          blob = input.file
          name = input.file.name
          mimeType = input.file.type
          sizeBytes = input.file.size
        }

        setState({ uploading: true, progress: 15, message: 'Saving…' })
        const db = getDb()
        const documentsRepo = new DocumentRepository(db)
        const projectSvc = new ProjectService(db)
        const documentService = new DocumentService({ documents: documentsRepo, projects: projectSvc })
        const document = await documentService.create({
          projectId,
          type,
          name,
          sizeBytes,
          ...(mimeType !== undefined ? { mimeType } : {}),
          ...(blob ? { blob } : {}),
        })

        setState({ uploading: true, progress: 30, message: 'Processing…' })
        const processing = new ProcessingService({
          documents: documentsRepo,
          chunks: new ChunkRepository(db),
          jobs: new ProcessingJobRepository(db),
          projects: projectSvc,
        })
        try {
          await processing.process(document.id, {
            onProgress: (p) => setState({ uploading: true, progress: p.progress, message: p.stage }),
          })
        } catch (err) {
          const msg = isAppError(err) ? err.message : (err as Error).message
          toast({ variant: 'error', title: 'Processing failed', description: msg })
          await refresh(projectId)
          setState({ uploading: false, progress: 0 })
          throw err
        }

        await refresh(projectId)
        setState({ uploading: false, progress: 100 })
        toast({ variant: 'success', title: 'Document ready', description: name })
      } catch (err) {
        const msg = isAppError(err) ? err.message : (err as Error).message
        toast({ variant: 'error', title: 'Upload failed', description: msg })
        setState({ uploading: false, progress: 0 })
        throw err
      }
    },
    [projectId, refresh],
  )

  return { upload, ...state }
}