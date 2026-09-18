import { logger } from '../logger/logger'

/**
 * OPFS (Origin Private File System) wrapper.
 *
 * In Phase 2 the primary blob store is IndexedDB (via Dexie's documentBlobs
 * table). OPFS is plumbed here as an optional fast-path for browsers that
 * support it; if it's unavailable, callers should fall back to the IndexedDB
 * blob. The path scheme is intentional so future migration is mechanical:
 *
 *   projects/{projectId}/{documentId}/{filename}
 */

export interface OpfsEntry {
  path: string
  size: number
}

export function isOpfsAvailable(): boolean {
  if (typeof navigator === 'undefined') return false
  return Boolean(navigator.storage?.getDirectory)
}

export function buildOpfsPath(projectId: string, documentId: string, filename: string): string {
  return `projects/${projectId}/${documentId}/${filename}`
}

/**
 * Best-effort write. Returns the path on success, or null if OPFS is not
 * available / the write failed. Callers MUST treat null as "fall back to
 * IndexedDB" — never as an error.
 */
export async function writeOpfs(
  projectId: string,
  documentId: string,
  filename: string,
  data: Blob | ArrayBuffer,
): Promise<string | null> {
  if (!isOpfsAvailable()) return null
  try {
    const root = await navigator.storage.getDirectory()
    const projects = await root.getDirectoryHandle('projects', { create: true })
    const projectDir = await projects.getDirectoryHandle(projectId, { create: true })
    const docDir = await projectDir.getDirectoryHandle(documentId, { create: true })
    const safeName = filename.replace(/[\\/]/g, '_')
    const file = await docDir.getFileHandle(safeName, { create: true })
    const writable = await file.createWritable()
    await writable.write(data)
    await writable.close()
    return buildOpfsPath(projectId, documentId, safeName)
  } catch {
    logger.warn('OPFS write failed', { projectId, documentId })
    return null
  }
}

export async function readOpfs(path: string): Promise<Blob | null> {
  if (!isOpfsAvailable()) return null
  const segments = path.split('/').filter(Boolean)
  if (segments.length < 4 || segments[0] !== 'projects') return null
  try {
    const root = await navigator.storage.getDirectory()
    let dir: FileSystemDirectoryHandle = root
    for (let i = 1; i < segments.length - 1; i++) {
      dir = await dir.getDirectoryHandle(segments[i]!, { create: false })
    }
    const filename = segments[segments.length - 1]!
    const file = await dir.getFileHandle(filename, { create: false })
    return await file.getFile()
  } catch {
    logger.warn('OPFS read failed', { path })
    return null
  }
}

export async function deleteOpfs(path: string): Promise<void> {
  if (!isOpfsAvailable()) return
  const segments = path.split('/').filter(Boolean)
  if (segments.length < 4) return
  try {
    const root = await navigator.storage.getDirectory()
    let dir: FileSystemDirectoryHandle = root
    for (let i = 1; i < segments.length - 1; i++) {
      dir = await dir.getDirectoryHandle(segments[i]!, { create: false })
    }
    const filename = segments[segments.length - 1]!
    await dir.removeEntry(filename)
  } catch {
    logger.warn('OPFS delete failed', { path })
  }
}