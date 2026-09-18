import 'fake-indexeddb/auto'
import { beforeEach, describe, expect, it } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import { DocumentRepository } from '@/entities/document/repository'
import { ProjectService } from '@/services/projectService'
import { DocumentService } from '@/services/documentService'
import {
  setDocumentsServiceForTesting,
  useDocumentsStore,
} from '@/features/documents/documentsStore'
import { useDocument } from '@/features/documents/useDocuments'
import type { Document } from '@/entities/document/types'
import type { Project } from '@/entities/project/types'

describe('Document deep-link / refresh loading', () => {
  let db: AppDatabase
  let service: DocumentService
  let projectA: Project
  let projectB: Project
  let docA: Document

  beforeEach(async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    service = new DocumentService({
      documents: new DocumentRepository(db),
      projects: new ProjectService(db),
    })
    setDocumentsServiceForTesting(service)
    useDocumentsStore.getState().reset()

    const projects = new ProjectService(db)
    projectA = await projects.create({ name: 'Calculus', subject: 'calculus' })
    projectB = await projects.create({ name: 'Physics', subject: 'physics' })
    docA = await new DocumentRepository(db).create({
      projectId: projectA.id,
      type: 'text',
      name: 'notes.txt',
      sizeBytes: 5,
      blob: new Blob(['hello'], { type: 'text/plain' }),
    })
  })

  it('Test 1 — loads a document directly even when the store starts empty', async () => {
    // Simulate a cold start: nothing has been loaded into memory.
    expect(Object.keys(useDocumentsStore.getState().byProject)).toHaveLength(0)
    expect(Object.keys(useDocumentsStore.getState().byId)).toHaveLength(0)

    const { result } = renderHook(() => useDocument(projectA.id, docA.id))

    await waitFor(() => expect(result.current.status).toBe('found'))
    expect(result.current.document?.id).toBe(docA.id)
    expect(result.current.document?.projectId).toBe(projectA.id)
    expect(result.current.error).toBeNull()
  })

  it('Test 2 — reports not-found for a document that does not exist', async () => {
    const { result } = renderHook(() => useDocument(projectA.id, 'missing-document-id'))

    await waitFor(() => expect(result.current.status).toBe('not-found'))
    expect(result.current.document).toBeNull()
  })

  it('Test 3 — refuses a document that belongs to another project', async () => {
    const { result } = renderHook(() => useDocument(projectB.id, docA.id))

    await waitFor(() => expect(result.current.status).toBe('not-found'))
    expect(result.current.document).toBeNull()
  })

  it('Test 4 — refresh reloads the document after it changes on disk', async () => {
    const { result } = renderHook(() => useDocument(projectA.id, docA.id))
    await waitFor(() => expect(result.current.status).toBe('found'))
    expect(result.current.document?.name).toBe('notes.txt')

    await service.rename(docA.id, 'renamed-notes.txt')

    await act(async () => {
      await result.current.refresh()
    })

    expect(result.current.status).toBe('found')
    expect(result.current.document?.name).toBe('renamed-notes.txt')
  })

  it('reports not-found after the document is deleted, then refresh finds nothing', async () => {
    const { result } = renderHook(() => useDocument(projectA.id, docA.id))
    await waitFor(() => expect(result.current.status).toBe('found'))

    await service.delete(docA.id)
    await act(async () => {
      await result.current.refresh()
    })

    expect(result.current.status).toBe('not-found')
    expect(result.current.document).toBeNull()
  })

  it('does not loop when the document is missing', async () => {
    const { result } = renderHook(() => useDocument(projectA.id, 'never-exists'))
    await waitFor(() => expect(result.current.status).toBe('not-found'))

    // Let any stray effects settle, then confirm the state is stable.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20))
    })
    expect(result.current.status).toBe('not-found')
  })
})

describe('documentsStore.loadOne', () => {
  let db: AppDatabase
  let service: DocumentService
  let projectA: Project
  let projectB: Project
  let docA: Document

  beforeEach(async () => {
    db = new AppDatabase()
    setDbForTesting(db)
    service = new DocumentService({
      documents: new DocumentRepository(db),
      projects: new ProjectService(db),
    })
    setDocumentsServiceForTesting(service)
    useDocumentsStore.getState().reset()

    const projects = new ProjectService(db)
    projectA = await projects.create({ name: 'A', subject: 'cs' })
    projectB = await projects.create({ name: 'B', subject: 'physics' })
    docA = await new DocumentRepository(db).create({
      projectId: projectA.id,
      type: 'text',
      name: 'a.txt',
      sizeBytes: 1,
      blob: new Blob(['x'], { type: 'text/plain' }),
    })
  })

  it('caches the loaded document for later reads', async () => {
    await useDocumentsStore.getState().loadOne(projectA.id, docA.id)
    expect(useDocumentsStore.getState().singleStatus[docA.id]).toBe('found')
    expect(useDocumentsStore.getState().byId[docA.id]?.id).toBe(docA.id)
  })

  it('merges the loaded document into an already-loaded project list', async () => {
    await useDocumentsStore.getState().load(projectA.id)
    expect(useDocumentsStore.getState().byProject[projectA.id]).toHaveLength(1)

    // Simulate the list cache being stale (document not present).
    useDocumentsStore.setState({ byProject: { [projectA.id]: [] } })
    await useDocumentsStore.getState().loadOne(projectA.id, docA.id)

    expect(useDocumentsStore.getState().byProject[projectA.id]).toHaveLength(1)
    expect(useDocumentsStore.getState().byProject[projectA.id]![0]!.id).toBe(docA.id)
  })

  it('marks a cross-project document as not-found without caching it', async () => {
    await useDocumentsStore.getState().loadOne(projectB.id, docA.id)
    expect(useDocumentsStore.getState().singleStatus[docA.id]).toBe('not-found')
    expect(useDocumentsStore.getState().byId[docA.id]).toBeUndefined()
  })

  it('force refresh replaces the cached copy', async () => {
    await useDocumentsStore.getState().loadOne(projectA.id, docA.id)
    expect(useDocumentsStore.getState().byId[docA.id]?.name).toBe('a.txt')

    await service.rename(docA.id, 'b.txt')
    await useDocumentsStore.getState().loadOne(projectA.id, docA.id, { force: true })

    expect(useDocumentsStore.getState().byId[docA.id]?.name).toBe('b.txt')
  })

  it('ignores empty ids', async () => {
    await useDocumentsStore.getState().loadOne('', '')
    expect(Object.keys(useDocumentsStore.getState().singleStatus)).toHaveLength(0)
  })

  it('removes the cached copy when a document is deleted', async () => {
    await useDocumentsStore.getState().loadOne(projectA.id, docA.id)
    await useDocumentsStore.getState().remove(docA.id, projectA.id)
    expect(useDocumentsStore.getState().byId[docA.id]).toBeUndefined()
    expect(useDocumentsStore.getState().singleStatus[docA.id]).toBeUndefined()
  })
})
