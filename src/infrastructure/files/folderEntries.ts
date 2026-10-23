/**
 * Files picked or dropped together with their folder: `<input webkitdirectory>`
 * gives `File.webkitRelativePath`; a dropped folder is walked through
 * `DataTransferItem.webkitGetAsEntry()`. Only the relative path is kept (no
 * absolute path ever exists in a browser).
 */

export interface FileWithPath {
  file: File
  /** Relative path including the file name ("Week 3/Slides/L1.pdf"), or just the name. */
  path: string
}

/** Most files read from one dropped folder (a whole drive is not a course folder). */
export const MAX_FOLDER_FILES = 500

/** Files of an `<input type="file" webkitdirectory>` (or a plain multi-select). */
export function filesFromInput(
  list: FileList | readonly File[] | null | undefined,
): FileWithPath[] {
  if (!list) return []
  return Array.from(list).map((file) => {
    const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath
    return { file, path: relative && relative.length > 0 ? relative : file.name }
  })
}

interface EntryLike {
  isFile: boolean
  isDirectory: boolean
  name: string
  fullPath?: string
  file?: (ok: (file: File) => void, fail?: (err: unknown) => void) => void
  createReader?: () => {
    readEntries: (ok: (entries: EntryLike[]) => void, fail?: (err: unknown) => void) => void
  }
}

function entryFile(entry: EntryLike): Promise<File | null> {
  return new Promise((resolve) => {
    if (!entry.file) return resolve(null)
    entry.file(resolve, () => resolve(null))
  })
}

async function readAll(entry: EntryLike): Promise<EntryLike[]> {
  const reader = entry.createReader?.()
  if (!reader) return []
  const out: EntryLike[] = []
  // readEntries returns the children in batches until an empty batch.
  for (;;) {
    const batch = await new Promise<EntryLike[]>((resolve) =>
      reader.readEntries(resolve, () => resolve([])),
    )
    if (batch.length === 0) break
    out.push(...batch)
  }
  return out
}

/**
 * Walk dropped items: files keep their name, folders are read recursively and
 * each file gets its path below the dropped folder (the folder name included).
 * Hidden files (".DS_Store", "~$x.docx") are skipped.
 */
export async function filesFromDataTransfer(
  transfer: Pick<DataTransfer, 'items' | 'files'> | null | undefined,
  limit = MAX_FOLDER_FILES,
): Promise<FileWithPath[]> {
  if (!transfer) return []
  const items = Array.from(transfer.items ?? [])
  const entries = items
    .map((item) =>
      typeof (item as DataTransferItem & { webkitGetAsEntry?: () => unknown }).webkitGetAsEntry ===
      'function'
        ? (item.webkitGetAsEntry() as EntryLike | null)
        : null,
    )
    .filter((entry): entry is EntryLike => !!entry)
  if (entries.length === 0) return filesFromInput(transfer.files)
  const out: FileWithPath[] = []
  const visit = async (entry: EntryLike, prefix: string): Promise<void> => {
    if (out.length >= limit) return
    if (entry.name.startsWith('.') || entry.name.startsWith('~$')) return
    const path = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isFile) {
      const file = await entryFile(entry)
      if (file) out.push({ file, path })
      return
    }
    if (entry.isDirectory) {
      for (const child of await readAll(entry)) await visit(child, path)
    }
  }
  for (const entry of entries) await visit(entry, '')
  return out
}
