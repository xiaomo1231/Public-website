import { normalizeFolderPath } from './folders'

/**
 * 考卷照片合并: photos of one paper are usually picked together and named
 * with a shared stem and a sequence number ("大题（带答案和评分）01.jpg … 07.jpg",
 * "选择题 01.jpg …", "IMG_0001.jpg …"). These pure helpers find such groups so
 * the upload queue (and the file batch bar) can offer to merge each group into
 * one PDF, pages in numeric order. No I/O.
 */

export interface PhotoGroupInput {
  id: string
  name: string
  folderPath?: string
}

export interface PhotoGroup {
  /** Stable key: folder + normalised stem. */
  key: string
  /** Stem as written in the first file (trimmed), e.g. `大题（带答案和评分）`. */
  stem: string
  folderPath: string
  /** Member ids in page order (numeric, then by name). */
  ids: string[]
  /** Sequence numbers in the same order. */
  numbers: number[]
  /** Suggested file name of the merged PDF. */
  name: string
}

const IMAGE_EXT = /\.(?:jpe?g|png|webp|gif|bmp|heic|heif|tiff?)$/i
// Separators that may sit between the stem and its number, and trail the stem.
const TRAILING_SEPARATORS = /[\s_\-–—.#·・,，、]+$/u
const OPEN_BRACKET_TAIL = /[(（[【]$/u

/** `name` without its extension. */
export function nameStem(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, '')
}

/**
 * Split a file name into a stem and a trailing sequence number:
 * `大题（带答案和评分）01.jpg` → `{ stem: '大题（带答案和评分）', number: 1 }`,
 * `IMG_0001.JPG` → `{ stem: 'IMG', number: 1 }`, `scan (3).png` → `scan`, 3.
 * `null` when the name does not end with a number.
 */
export function splitSequence(name: string): { stem: string; number: number } | null {
  const base = nameStem(name.trim())
  // "scan (3)" / "scan（3）" / "p-12" / "page 4" / "第3页".
  const match = /^(.*?)(?:第\s*)?(\d{1,4})\s*(?:[)）\]】]|页|張|张)?\s*$/u.exec(base)
  if (!match) return null
  const number = Number(match[2])
  if (!Number.isFinite(number)) return null
  let stem = match[1] ?? ''
  stem = stem.replace(OPEN_BRACKET_TAIL, '').replace(TRAILING_SEPARATORS, '')
  // A trailing "page" / "p" / "第" word is part of the numbering, not the name.
  stem = stem
    .replace(/(?:^|[\s_-])(?:page|pg|p)$/iu, '')
    .replace(/第$/u, '')
    .replace(TRAILING_SEPARATORS, '')
  return { stem: stem.trim(), number }
}

export function isImageName(name: string): boolean {
  return IMAGE_EXT.test(name.trim())
}

function stemKey(stem: string): string {
  return stem.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Name of the merged PDF: the stem, else the folder's last segment, else `fallback`. */
export function mergedPdfName(stem: string, folderPath = '', fallback = 'photos'): string {
  const own = stem.trim()
  const folder = normalizeFolderPath(folderPath).split('/').pop() ?? ''
  return `${own || folder || fallback}.pdf`
}

/**
 * Groups of ≥2 image names sharing a stem (and folder) that end with a
 * sequence number. A single numbered photo, an unnumbered photo and any
 * non-image are never grouped. Groups are returned in the order their first
 * member appears.
 */
export function detectPhotoGroups(
  items: ReadonlyArray<PhotoGroupInput>,
  options: { fallbackName?: string } = {},
): PhotoGroup[] {
  const buckets = new Map<
    string,
    { stem: string; folderPath: string; members: Array<{ id: string; name: string; n: number }> }
  >()
  for (const item of items) {
    if (!isImageName(item.name)) continue
    const parts = splitSequence(item.name)
    if (!parts) continue
    const folderPath = normalizeFolderPath(item.folderPath)
    const key = JSON.stringify([folderPath, stemKey(parts.stem)])
    const bucket = buckets.get(key) ?? { stem: parts.stem, folderPath, members: [] }
    bucket.members.push({ id: item.id, name: item.name, n: parts.number })
    buckets.set(key, bucket)
  }
  const groups: PhotoGroup[] = []
  for (const [key, bucket] of buckets) {
    if (bucket.members.length < 2) continue
    const ordered = bucket.members
      .slice()
      .sort((a, b) => a.n - b.n || a.name.localeCompare(b.name, undefined, { numeric: true }))
    groups.push({
      key,
      stem: bucket.stem,
      folderPath: bucket.folderPath,
      ids: ordered.map((m) => m.id),
      numbers: ordered.map((m) => m.n),
      name: mergedPdfName(bucket.stem, bucket.folderPath, options.fallbackName),
    })
  }
  return groups
}

/**
 * "保留两份": the next free name "name (2).ext", "name (3).ext"… Names are
 * compared case-insensitively. An existing " (n)" suffix is counted up from.
 */
export function keepBothName(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((n) => n.trim().toLowerCase()))
  const trimmed = name.trim()
  if (!used.has(trimmed.toLowerCase())) return trimmed
  const ext = /\.[a-z0-9]+$/i.exec(trimmed)?.[0] ?? ''
  let base = trimmed.slice(0, trimmed.length - ext.length)
  let n = 2
  const suffix = /^(.*?) \((\d{1,4})\)$/.exec(base)
  if (suffix) {
    base = suffix[1] ?? base
    n = Number(suffix[2]) + 1
  }
  for (; ; n++) {
    const candidate = `${base} (${n})${ext}`
    if (!used.has(candidate.toLowerCase())) return candidate
  }
}
