import { TAG_ORDER, type DictEntry, type ExamTag } from '@/entities/vocab/types'
import type { RootEntry } from '@/entities/vocab/text'

/**
 * The word data shipped with the app (`public/vocab/`, built from ECDICT by
 * scripts/build-vocab.mjs). Loaded on demand and kept in memory for the rest
 * of the visit; the browser's HTTP cache usually keeps the files too.
 */

type Loader = (file: string) => Promise<unknown>

const fetchLoader: Loader = async (file) => {
  const response = await fetch(`${import.meta.env.BASE_URL}vocab/${file}`)
  if (!response.ok) throw new Error(`Word data ${file}: HTTP ${response.status}`)
  return response.json()
}

let loader: Loader = fetchLoader
let dictionary: Promise<DictEntry[]> | null = null
let common: Promise<Set<string>> | null = null
let roots: Promise<RootEntry[]> | null = null

/** Test helper: read the files some other way (null restores fetch) and drop the caches. */
export function setVocabDataLoaderForTesting(next: Loader | null): void {
  loader = next ?? fetchLoader
  dictionary = common = roots = null
}

type RawWord = [word: string, phonetic: string, meanings: string[], mask: number, rank: number, exchange: string]

function decode([word, phonetic, meanings, mask, rank, exchange]: RawWord): DictEntry {
  return {
    word,
    phonetic,
    meanings,
    tags: TAG_ORDER.filter((_, bit) => (mask & (1 << bit)) !== 0) as ExamTag[],
    rank,
    forms: exchange
      ? exchange
          .split('/')
          .map((part) => part.split(':')[1] ?? '')
          .filter(Boolean)
      : [],
  }
}

/** Every exam-tagged word, most frequent first. */
export function loadDictionary(): Promise<DictEntry[]> {
  dictionary ??= loader('dictionary.json').then((data) => ((data as { words: RawWord[] }).words ?? []).map(decode))
  dictionary.catch(() => (dictionary = null))
  return dictionary
}

/** The most frequent words and their forms (course vocabulary skips them). */
export function loadCommonWords(): Promise<Set<string>> {
  common ??= loader('common.json').then((data) => new Set((data as { words: string[] }).words ?? []))
  common.catch(() => (common = null))
  return common
}

/** Roots and affixes: [key, kind, meaning, examples]. */
export function loadRoots(): Promise<RootEntry[]> {
  roots ??= loader('roots.json').then((data) => (data as { roots: RootEntry[] }).roots ?? [])
  roots.catch(() => (roots = null))
  return roots
}
