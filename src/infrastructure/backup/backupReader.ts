/**
 * Streaming reader for backup files written by `DataManagementService`:
 *
 *   {"json":{"exportedAt":…,"schemaVersion":…,"<table>":[row,…],…},
 *    "blobs":[{"id":…,"kind":…,"mimeType":…,"bytesBase64":"…"},…]}
 *
 * The file is read in slices and decoded with a streaming `TextDecoder`, so it
 * never becomes one string. Every table row is parsed on its own, and each
 * blob's base64 text is validated (and optionally decoded) piece by piece.
 * Whitespace between tokens is allowed, so `JSON.stringify(exportAll())` and
 * `exportFile()` output (and pretty-printed copies) are all accepted.
 *
 * Structural problems throw `BackupFormatError`; the caller decides how to
 * present them. No business rules live here.
 */

export class BackupFormatError extends Error {
  constructor(readonly reason: string) {
    super(`Backup file is not readable: ${reason}`)
    this.name = 'BackupFormatError'
  }
}

/** Keys of the `json` object that describe the backup rather than hold a table. */
export const BACKUP_META_KEYS = ['exportedAt', 'schemaVersion', 'blobEncoding'] as const

export interface BackupMeta {
  exportedAt?: unknown
  schemaVersion?: unknown
  blobEncoding?: unknown
}

export interface BackupBlobEntry {
  /** Every key of the blob object except `bytesBase64`, JSON-parsed. */
  fields: Record<string, unknown>
  /** Decoded bytes when decoding was requested and the entry had `bytesBase64`. */
  bytes: ArrayBuffer | null
  /** Decoded size in bytes (computed even when not decoding). */
  size: number
  hasBytes: boolean
}

export interface BackupScanHandlers {
  /** A meta key of the `json` object was read. Throw to stop the scan. */
  meta?(key: (typeof BACKUP_META_KEYS)[number], value: unknown): void | Promise<void>
  /**
   * A table key of `json` is next. Return false to skip its value unread
   * (unknown or excluded tables).
   */
  tableStart?(table: string): boolean | Promise<boolean>
  row?(table: string, row: unknown): void | Promise<void>
  tableEnd?(table: string): void | Promise<void>
  /** Called once `json` is complete, before any blob. */
  jsonEnd?(): void | Promise<void>
  blob?(entry: BackupBlobEntry): void | Promise<void>
}

export interface BackupScanOptions {
  /** Bytes read per slice. Tests use a tiny value to split tokens. */
  chunkSize?: number
  /** Decode base64 into bytes (restore) or only validate it (inspect). */
  decodeBlobs?: boolean
  /**
   * Wraps every file read. Restore passes `Dexie.waitFor` so the reads can
   * happen inside one IndexedDB transaction.
   */
  wait?: <T>(promise: Promise<T>) => Promise<T>
  /** Bytes of the file consumed so far. */
  onBytes?(read: number, total: number): void
}

const DEFAULT_CHUNK = 4 * 1024 * 1024
const NOT_BASE64 = /[^A-Za-z0-9+/=]/

function isWs(code: number): boolean {
  return code === 32 || code === 10 || code === 13 || code === 9
}

function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new BackupFormatError(`invalid JSON in ${what}`)
  }
}

function decodeBase64(text: string): Uint8Array {
  let binary: string
  try {
    binary = atob(text)
  } catch {
    throw new BackupFormatError('invalid base64 file data')
  }
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

class Reader {
  private buf = ''
  private pos = 0
  private offset = 0
  private eof = false
  private readonly decoder = new TextDecoder('utf-8', { fatal: true })

  constructor(
    private readonly file: Blob,
    private readonly chunkSize: number,
    private readonly wait: <T>(promise: Promise<T>) => Promise<T>,
    private readonly onBytes?: (read: number, total: number) => void,
  ) {}

  /** Append the next slice. False at end of file. */
  private async fill(): Promise<boolean> {
    if (this.eof) return false
    this.buf = this.buf.slice(this.pos)
    this.pos = 0
    try {
      if (this.offset >= this.file.size) {
        this.eof = true
        const tail = this.decoder.decode()
        this.buf += tail
        return tail.length > 0
      }
      const end = Math.min(this.file.size, this.offset + this.chunkSize)
      const bytes = await this.wait(this.file.slice(this.offset, end).arrayBuffer())
      this.offset = end
      this.buf += this.decoder.decode(new Uint8Array(bytes), { stream: true })
    } catch (err) {
      if (err instanceof TypeError) throw new BackupFormatError('file is not UTF-8 text')
      throw err
    }
    this.onBytes?.(this.offset, this.file.size)
    return true
  }

  /** Make at least one character available; false at end of file. */
  private async ensure(): Promise<boolean> {
    while (this.pos >= this.buf.length) {
      if (!(await this.fill())) return false
    }
    return true
  }

  /** Next non-whitespace character without consuming it, or null at end of file. */
  async peek(): Promise<string | null> {
    for (;;) {
      if (!(await this.ensure())) return null
      while (this.pos < this.buf.length && isWs(this.buf.charCodeAt(this.pos))) this.pos++
      if (this.pos < this.buf.length) return this.buf[this.pos]!
    }
  }

  async expect(char: string): Promise<void> {
    const next = await this.peek()
    if (next === null) throw new BackupFormatError('file ends too early (truncated?)')
    if (next !== char) throw new BackupFormatError(`expected "${char}" but found "${next}"`)
    this.pos++
  }

  /** Consume `,` (returns true) or `close` (returns false). */
  async separator(close: string): Promise<boolean> {
    const next = await this.peek()
    if (next === null) throw new BackupFormatError('file ends too early (truncated?)')
    this.pos++
    if (next === ',') return true
    if (next === close) return false
    throw new BackupFormatError(`expected "," or "${close}" but found "${next}"`)
  }

  /**
   * Raw text of the next JSON value (string, number, literal, object, array).
   * With `keep` false the value is skipped and an empty string is returned.
   */
  async value(keep = true): Promise<string> {
    const first = await this.peek()
    if (first === null) throw new BackupFormatError('file ends too early (truncated?)')
    const scalar = first !== '{' && first !== '[' && first !== '"'
    const parts: string[] = []
    let depth = 0
    let inString = false
    let escaped = false
    for (;;) {
      if (!(await this.ensure())) {
        if (scalar && parts.length) break
        throw new BackupFormatError('file ends too early (truncated?)')
      }
      const buf = this.buf
      const start = this.pos
      let i = start
      let done = false
      for (; i < buf.length; i++) {
        const c = buf.charCodeAt(i)
        if (inString) {
          if (escaped) escaped = false
          else if (c === 92) escaped = true
          else if (c === 34) {
            inString = false
            if (depth === 0) {
              i++
              done = true
              break
            }
          }
          continue
        }
        if (c === 34) {
          if (scalar) throw new BackupFormatError('unexpected quote')
          inString = true
        } else if (c === 123 || c === 91) {
          if (scalar) throw new BackupFormatError('unexpected bracket')
          depth++
        } else if (c === 125 || c === 93) {
          if (depth === 0) {
            done = true
            break
          }
          depth--
          if (depth === 0) {
            i++
            done = true
            break
          }
        } else if (depth === 0 && (c === 44 || isWs(c))) {
          done = true
          break
        }
      }
      if (keep) parts.push(buf.slice(start, i))
      this.pos = i
      if (done) break
    }
    return parts.join('')
  }

  async key(): Promise<string> {
    const next = await this.peek()
    if (next !== '"') throw new BackupFormatError('expected a property name')
    const name = parseJson(await this.value(), 'a property name')
    await this.expect(':')
    return name as string
  }

  /**
   * Stream the base64 string that starts at the cursor, validating every
   * piece and decoding it when `decode` is set.
   */
  async base64(decode: boolean): Promise<{ bytes: ArrayBuffer | null; size: number }> {
    await this.expect('"')
    const pieces: Uint8Array[] = []
    let carry = ''
    let chars = 0
    let padding = 0
    for (;;) {
      if (!(await this.ensure())) throw new BackupFormatError('file ends too early (truncated?)')
      const quote = this.buf.indexOf('"', this.pos)
      const end = quote === -1 ? this.buf.length : quote
      const segment = this.buf.slice(this.pos, end)
      this.pos = quote === -1 ? end : quote + 1
      if (NOT_BASE64.test(segment)) throw new BackupFormatError('invalid base64 file data')
      const eq = segment.indexOf('=')
      if (padding > 0 && eq !== 0 && segment.length > 0) {
        throw new BackupFormatError('invalid base64 file data')
      }
      if (eq !== -1) {
        const tail = segment.slice(eq)
        if (/[^=]/.test(tail)) throw new BackupFormatError('invalid base64 file data')
        padding += tail.length
        if (padding > 2) throw new BackupFormatError('invalid base64 file data')
      }
      chars += segment.length
      const text = carry + segment
      const closing = quote !== -1
      if (closing && text.length % 4 !== 0) throw new BackupFormatError('invalid base64 file data')
      const usable = closing ? text.length : text.length - (text.length % 4)
      const body = text.slice(0, usable)
      carry = text.slice(usable)
      if (decode && body) pieces.push(decodeBase64(body))
      if (closing) break
    }
    const size = (chars / 4) * 3 - padding
    if (!decode) return { bytes: null, size }
    const out = new Uint8Array(size)
    let at = 0
    for (const piece of pieces) {
      out.set(piece, at)
      at += piece.length
    }
    return { bytes: out.buffer, size }
  }

  async end(): Promise<void> {
    if ((await this.peek()) !== null) throw new BackupFormatError('unexpected text after the end')
  }
}

const META = new Set<string>(BACKUP_META_KEYS)

async function scanJson(reader: Reader, handlers: BackupScanHandlers): Promise<void> {
  await reader.expect('{')
  if ((await reader.peek()) === '}') {
    await reader.expect('}')
    return
  }
  do {
    const key = await reader.key()
    if (META.has(key)) {
      // Read the value even without a handler (`?.()` would skip evaluating it).
      const value = parseJson(await reader.value(), key)
      await handlers.meta?.(key as (typeof BACKUP_META_KEYS)[number], value)
      continue
    }
    const wanted = (await handlers.tableStart?.(key)) ?? true
    if (!wanted) {
      await reader.value(false)
      continue
    }
    await reader.expect('[')
    if ((await reader.peek()) === ']') {
      await reader.expect(']')
    } else {
      do {
        const row = parseJson(await reader.value(), `table ${key}`)
        await handlers.row?.(key, row)
      } while (await reader.separator(']'))
    }
    await handlers.tableEnd?.(key)
  } while (await reader.separator('}'))
}

async function scanBlobs(
  reader: Reader,
  handlers: BackupScanHandlers,
  decode: boolean,
): Promise<void> {
  await reader.expect('[')
  if ((await reader.peek()) === ']') {
    await reader.expect(']')
    return
  }
  do {
    await reader.expect('{')
    const entry: BackupBlobEntry = { fields: {}, bytes: null, size: 0, hasBytes: false }
    if ((await reader.peek()) === '}') {
      await reader.expect('}')
    } else {
      do {
        const key = await reader.key()
        if (key === 'bytesBase64') {
          if ((await reader.peek()) !== '"') throw new BackupFormatError('file data is not text')
          const { bytes, size } = await reader.base64(decode)
          entry.bytes = bytes
          entry.size = size
          entry.hasBytes = true
        } else {
          entry.fields[key] = parseJson(await reader.value(), 'a file entry')
        }
      } while (await reader.separator('}'))
    }
    await handlers.blob?.(entry)
  } while (await reader.separator(']'))
}

/**
 * Walk a backup file once, reporting meta values, rows and blobs to the
 * handlers. `json` must come before `blobs`; other top-level keys are skipped.
 */
export async function scanBackup(
  file: Blob,
  handlers: BackupScanHandlers,
  options: BackupScanOptions = {},
): Promise<void> {
  const reader = new Reader(
    file,
    Math.max(1, options.chunkSize ?? DEFAULT_CHUNK),
    options.wait ?? ((promise) => promise),
    options.onBytes,
  )
  const decode = options.decodeBlobs ?? false
  let sawJson = false
  await reader.expect('{')
  if ((await reader.peek()) !== '}') {
    do {
      const key = await reader.key()
      if (key === 'json') {
        if (sawJson) throw new BackupFormatError('"json" appears twice')
        if ((await reader.peek()) !== '{') throw new BackupFormatError('"json" is not an object')
        await scanJson(reader, handlers)
        sawJson = true
        await handlers.jsonEnd?.()
      } else if (key === 'blobs') {
        if (!sawJson) throw new BackupFormatError('"blobs" must come after "json"')
        if ((await reader.peek()) !== '[') throw new BackupFormatError('"blobs" is not a list')
        await scanBlobs(reader, handlers, decode)
      } else {
        await reader.value(false)
      }
    } while (await reader.separator('}'))
  } else {
    await reader.expect('}')
  }
  await reader.end()
  if (!sawJson) throw new BackupFormatError('no "json" section')
}
