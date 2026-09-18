/**
 * Streaming response parser for Server-Sent Events (SSE).
 *
 * Handles payloads of the form:
 *   data: {"choices":[{"delta":{"content":"hi"}}]}
 *
 * Also tolerates the `[DONE]` sentinel emitted by OpenAI-compatible APIs.
 */

export interface SSEEvent {
  data: string
  event?: string
}

/**
 * Transform a fetch Response stream into an async iterable of SSE events.
 * Yields events as soon as they are fully buffered.
 */
export async function* parseSSE(stream: ReadableStream<Uint8Array>): AsyncGenerator<SSEEvent> {
  const reader = stream.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''

  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      // SSE events are separated by double newlines.
      let boundary: number
      while ((boundary = buffer.indexOf('\n\n')) !== -1 || (boundary = buffer.indexOf('\r\n\r\n')) !== -1) {
        const chunk = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary + (buffer.startsWith('\r', boundary) ? 4 : 2))
        const ev = parseEventBlock(chunk)
        if (ev) yield ev
      }
    }

    if (buffer.trim().length > 0) {
      const ev = parseEventBlock(buffer)
      if (ev) yield ev
    }
  } finally {
    try {
      reader.releaseLock()
    } catch {
      /* ignore */
    }
  }
}

function parseEventBlock(block: string): SSEEvent | null {
  let data = ''
  let event: string | undefined
  for (const rawLine of block.split(/\r?\n/)) {
    if (!rawLine) continue
    if (rawLine.startsWith(':')) continue // SSE comment
    const idx = rawLine.indexOf(':')
    if (idx === -1) continue
    const field = rawLine.slice(0, idx).trim()
    let value = rawLine.slice(idx + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'data') data = data ? `${data}\n${value}` : value
    else if (field === 'event') event = value
  }
  if (!data && !event) return null
  return { data, event }
}