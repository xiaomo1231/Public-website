import type { DocumentAnalysisOutput, SourceReference } from '@/infrastructure/ai/prompts/types'

/**
 * Merge the analyses of the parts of a long course into one.
 *
 * Each part was analysed on its own, so the same concept, formula or symbol
 * can come back from several parts; those are combined. Topics keep their
 * order. Two parts reusing a topic name are told apart: when the parts share
 * a chapter (a long chapter was split) it is the same topic and the two are
 * combined; otherwise (e.g. "Summary" in every chapter) the later one is
 * renamed with its part label, and that part's references follow the rename.
 *
 * Pure: no storage, no AI.
 */

export interface AnalysisPart {
  output: DocumentAnalysisOutput
  /** Short label of the part, e.g. "Ch 3 – Ch 4". */
  label: string
  /** Chapters the part covers. */
  chapterIds: string[]
}

const key = (text: string) => text.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase()

function refKey(ref: SourceReference): string {
  return [ref.documentName, ref.page ?? '', ref.slideNumber ?? '', ref.section ?? '', ref.quote ?? ''].join('|')
}

function mergeRefs(into: SourceReference[], more: SourceReference[]): SourceReference[] {
  const seen = new Set(into.map(refKey))
  return [...into, ...more.filter((ref) => !seen.has(refKey(ref)) && seen.add(refKey(ref)))]
}

const union = (a: string[], b: string[]) => [...new Set([...a, ...b])]

/** Combine items that share a key; `combine` folds a later duplicate into the kept one. */
function dedupe<T>(items: T[], keyOf: (item: T) => string, combine: (kept: T, extra: T) => T): T[] {
  const byKey = new Map<string, number>()
  const out: T[] = []
  for (const item of items) {
    const k = keyOf(item)
    const at = byKey.get(k)
    if (at === undefined) {
      byKey.set(k, out.length)
      out.push(item)
    } else {
      out[at] = combine(out[at]!, item)
    }
  }
  return out
}

export function mergeDocumentAnalyses(parts: AnalysisPart[]): DocumentAnalysisOutput {
  if (parts.length === 1) return parts[0]!.output

  const topics: DocumentAnalysisOutput['topics'] = []
  const topicAt = new Map<string, { index: number; part: number }>()
  const renamed: Array<Map<string, string>> = []

  parts.forEach((part, partIndex) => {
    const renames = new Map<string, string>()
    renamed.push(renames)
    for (const topic of part.output.topics) {
      const existing = topicAt.get(key(topic.name))
      if (!existing) {
        topicAt.set(key(topic.name), { index: topics.length, part: partIndex })
        topics.push({ ...topic })
        continue
      }
      const sharesChapter = parts[existing.part]!.chapterIds.some((id) => part.chapterIds.includes(id))
      if (sharesChapter) {
        const kept = topics[existing.index]!
        topics[existing.index] = {
          ...kept,
          sourceChunkIds: union(kept.sourceChunkIds ?? [], topic.sourceChunkIds ?? []),
          sourceRefs: mergeRefs(kept.sourceRefs, topic.sourceRefs),
        }
        continue
      }
      let name = `${topic.name} · ${part.label}`
      for (let n = 2; topicAt.has(key(name)); n++) name = `${topic.name} · ${part.label} (${n})`
      renames.set(topic.name, name)
      topicAt.set(key(name), { index: topics.length, part: partIndex })
      topics.push({ ...topic, name })
    }
  })

  const names = (partIndex: number, list: string[]) => list.map((name) => renamed[partIndex]!.get(name) ?? name)
  const each = <T>(pick: (output: DocumentAnalysisOutput) => T[], fix: (item: T, partIndex: number) => T): T[] =>
    parts.flatMap((part, partIndex) => pick(part.output).map((item) => fix(item, partIndex)))

  return {
    language: parts[0]!.output.language,
    topics,
    concepts: dedupe(
      each((o) => o.concepts, (c, i) => ({ ...c, topicNames: names(i, c.topicNames) })),
      (c) => key(c.name),
      (kept, extra) => ({
        ...kept,
        topicNames: union(kept.topicNames, extra.topicNames),
        sourceRefs: mergeRefs(kept.sourceRefs, extra.sourceRefs),
      }),
    ),
    formulas: dedupe(
      each((o) => o.formulas, (f) => f),
      (f) => f.latex.replace(/\s+/g, ''),
      (kept, extra) => ({ ...kept, sourceRefs: mergeRefs(kept.sourceRefs, extra.sourceRefs) }),
    ),
    symbols: dedupe(
      each((o) => o.symbols, (s) => s),
      (s) => `${s.symbol.trim()}|${key(s.meaning)}`,
      (kept, extra) => ({ ...kept, sourceRefs: mergeRefs(kept.sourceRefs, extra.sourceRefs) }),
    ),
    examples: dedupe(
      each((o) => o.examples, (e, i) => ({ ...e, topicNames: names(i, e.topicNames) })),
      (e) => `${key(e.title)}|${key(e.problem)}`,
      (kept, extra) => ({ ...kept, topicNames: union(kept.topicNames, extra.topicNames) }),
    ),
    exercises: dedupe(
      each((o) => o.exercises, (e, i) => ({ ...e, topicNames: names(i, e.topicNames) })),
      (e) => key(e.prompt),
      (kept, extra) => ({ ...kept, topicNames: union(kept.topicNames, extra.topicNames) }),
    ),
    prerequisites: dedupe(
      each((o) => o.prerequisites, (p, i) => ({ ...p, topicNames: names(i, p.topicNames) })),
      (p) => key(p.name),
      (kept, extra) => ({ ...kept, topicNames: union(kept.topicNames, extra.topicNames) }),
    ),
  }
}
