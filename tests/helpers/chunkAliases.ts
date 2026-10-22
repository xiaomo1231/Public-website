import { getDb } from '@/infrastructure/db/database'

/**
 * Test helper for the analyzer prompts that label passages with short
 * per-request aliases (`document-analyzer/v3`, `topic-analyzer/v2`).
 *
 * A fake AI written in terms of real chunk ids answers with the alias the
 * prompt printed in front of each chunk's text. An id whose chunk text is not
 * in the prompt is returned unchanged, so it stays invalid.
 */
export function aliasFor(prompt: string, chunk: { text: string }): string | undefined {
  const at = prompt.indexOf(chunk.text)
  if (at < 0) return undefined
  const labels = [...prompt.slice(0, at).matchAll(/\[(c\d+)\b/g)]
  return labels.at(-1)?.[1]
}

export function toPromptAliases(
  prompt: string,
  ids: readonly string[],
  chunks: ReadonlyArray<{ id: string; text: string }>,
): string[] {
  return ids.map((id) => {
    const chunk = chunks.find((entry) => entry.id === id)
    return (chunk && aliasFor(prompt, chunk)) ?? id
  })
}

/**
 * Rewrite a fake analyzer response written with stored chunk ids (in
 * `topics[].sourceChunkIds` or `topic.sourceChunkIds`) into the aliases the
 * request printed. Chunks are read from the test database; an id that is not
 * stored, or whose text is not in the prompt, stays as written (invalid).
 */
export async function aliasResponse<T>(
  messages: ReadonlyArray<{ content: string }>,
  response: T,
): Promise<T> {
  const record = response as { data?: Record<string, unknown> } | undefined
  const data = record?.data
  if (!data) return response
  const prompt = messages.map((message) => message.content).join('\n')
  const rewrite = async (value: unknown): Promise<unknown> => {
    if (!Array.isArray(value)) return value
    const ids = value.filter((id): id is string => typeof id === 'string')
    const chunks = (await getDb().chunks.bulkGet(ids)).filter(
      (chunk): chunk is NonNullable<typeof chunk> => chunk !== undefined,
    )
    return value.map((id) =>
      typeof id === 'string' ? (toPromptAliases(prompt, [id], chunks)[0] ?? id) : id,
    )
  }
  const next: Record<string, unknown> = { ...data }
  if (Array.isArray(data.topics))
    next.topics = await Promise.all(
      (data.topics as Array<Record<string, unknown>>).map(async (topic) => ({
        ...topic,
        sourceChunkIds: await rewrite(topic.sourceChunkIds),
      })),
    )
  if (data.topic && typeof data.topic === 'object') {
    const topic = data.topic as Record<string, unknown>
    next.topic = { ...topic, sourceChunkIds: await rewrite(topic.sourceChunkIds) }
  }
  return { ...record, data: next } as T
}
