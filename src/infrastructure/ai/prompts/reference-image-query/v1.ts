/**
 * v1 reference-image-query prompt.
 *
 * Proposes SEARCH TERMS for open-licence reference pictures that would help a
 * student understand a chemistry or biology lesson. The model never returns a
 * URL or an image: the app searches PubChem / Wikimedia Commons itself, checks
 * licences, and labels anything unverified.
 */

import { securityFooter, untrustedContentWrapper } from '../security'

export const VERSION = 'v1' as const
export const PROMPT_KIND = 'reference-image-query' as const

export interface ReferenceImageQueryInput {
  topicName: string
  topicDescription: string
  language: 'zh' | 'en' | 'mixed'
  lessonContent: string
  /** PubChem is only offered for chemistry. */
  allowPubChem: boolean
}

export interface ReferenceImageQuery {
  source: 'pubchem' | 'wikimedia'
  term: string
  /** PubChem only: the molecular formula the compound must have. */
  formula?: string
  /** What the picture should show, in the lesson language. */
  purpose: string
}

export const MAX_REFERENCE_QUERIES = 3

export function buildSystemPrompt(options: { allowPubChem: boolean }): string {
  return [
    'You suggest search terms for reference pictures that would genuinely help a student understand a lesson. You never return a URL or an image.',
    '',
    'Sources:',
    ...(options.allowPubChem
      ? [
          '  - "pubchem": the 2D structure of ONE specific compound named in the lesson. `term` = its common English name (e.g. "acetic acid"); `formula` = its molecular formula (e.g. "C2H4O2") — the app rejects the result if PubChem\'s formula differs.',
        ]
      : []),
    '  - "wikimedia": a diagram or photo on Wikimedia Commons. `term` = a short English search phrase of 2–6 words naming the structure or process (e.g. "mitochondrion structure diagram", "DNA replication fork diagram").',
    '',
    'Rules:',
    `  - At most ${MAX_REFERENCE_QUERIES} queries, most useful first. Return {"queries": []} when no picture would clearly help (definitions, calculations, history).`,
    '  - Each query targets something the lesson actually teaches. Never a person, a brand or anything unrelated to the lesson.',
    '  - `purpose`: one short phrase in the lesson language saying what the picture should show.',
    '',
    'Output strictly valid JSON only:',
    '{"queries":[{"source":"pubchem | wikimedia","term":"...","formula":"(pubchem only)","purpose":"..."}]}',
    '',
    securityFooter(),
  ].join('\n')
}

export function buildUserPrompt(input: ReferenceImageQueryInput): string {
  const language =
    input.language === 'zh' ? 'Simplified Chinese' : input.language === 'en' ? 'English' : 'the lesson language'
  return [
    `Topic: ${input.topicName}.`,
    input.topicDescription ? `Topic summary: ${input.topicDescription}.` : '',
    `Write each purpose in ${language}.`,
    untrustedContentWrapper('LESSON', input.lessonContent.slice(0, 6000)),
    'Respond with the JSON object only.',
  ]
    .filter(Boolean)
    .join('\n')
}

const TERM = /^[\p{L}\p{N} ,'()-]+$/u

/** Validated queries (search terms only), or [] when the output is unusable. */
export function normalizeReferenceQueries(output: unknown, options: { allowPubChem: boolean }): ReferenceImageQuery[] {
  const raw = output && typeof output === 'object' ? (output as { queries?: unknown }).queries : undefined
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const queries: ReferenceImageQuery[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const source = record.source === 'pubchem' ? 'pubchem' : record.source === 'wikimedia' ? 'wikimedia' : null
    const term = typeof record.term === 'string' ? record.term.replace(/\s+/g, ' ').trim() : ''
    const purpose = typeof record.purpose === 'string' ? record.purpose.replace(/\s+/g, ' ').trim().slice(0, 80) : ''
    if (!source || (source === 'pubchem' && !options.allowPubChem)) continue
    if (!term || term.length > 60 || !TERM.test(term) || !purpose) continue
    const formula =
      typeof record.formula === 'string' && /^[A-Za-z0-9]{1,30}$/.test(record.formula.trim())
        ? record.formula.trim()
        : undefined
    // A PubChem result is only trusted when its formula can be checked.
    if (source === 'pubchem' && !formula) continue
    const key = `${source}:${term.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    queries.push({ source, term, purpose, ...(formula ? { formula } : {}) })
    if (queries.length === MAX_REFERENCE_QUERIES) break
  }
  return queries
}
