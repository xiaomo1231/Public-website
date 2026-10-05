/**
 * Biology figures: Punnett squares, pedigrees and transcription/translation.
 *
 * The model supplies only what the lesson states (parental genotypes, family
 * members and who is affected, a DNA sequence); gametes, offspring ratios,
 * generations, mRNA and the amino-acid chain are all computed here.
 */

// --- Punnett squares ---------------------------------------------------------

/** Genes per genotype the square supports (2 → a 4 × 4 square). */
export const MAX_PUNNETT_GENES = 2

/**
 * Split a genotype into allele pairs per gene: "AaBb" → [["A","a"],["B","b"]].
 * Each gene is one letter, written as a pair in either case order.
 */
export function genotypePairs(genotype: string): Array<[string, string]> | null {
  const text = genotype.replace(/\s+/g, '')
  if (!/^[A-Za-z]+$/.test(text) || text.length % 2 !== 0) return null
  const pairs: Array<[string, string]> = []
  for (let i = 0; i < text.length; i += 2) {
    const a = text[i]!
    const b = text[i + 1]!
    if (a.toLowerCase() !== b.toLowerCase()) return null
    // Dominant allele first, as genotypes are conventionally written.
    pairs.push(a <= b ? [a, b] : [b, a])
  }
  const genes = pairs.map(([a]) => a.toLowerCase())
  if (new Set(genes).size !== genes.length || pairs.length > MAX_PUNNETT_GENES) return null
  return pairs
}

/** Gametes by independent assortment, e.g. AaBb → AB, Ab, aB, ab. */
export function gametes(pairs: Array<[string, string]>): string[] {
  return pairs.reduce<string[]>(
    (acc, [a, b]) => acc.flatMap((prefix) => [`${prefix}${a}`, `${prefix}${b}`]),
    [''],
  )
}

/** Combine two gametes into a genotype in gene order, dominant first. */
export function combine(left: string, right: string): string {
  let out = ''
  for (let i = 0; i < left.length; i++) {
    const a = left[i]!
    const b = right[i]!
    out += a <= b ? `${a}${b}` : `${b}${a}`
  }
  return out
}

export type Dominance = 'complete' | 'incomplete'

/**
 * Phenotype class of a genotype: per gene "dominant", "recessive", or — with
 * incomplete dominance — "intermediate" for a heterozygote.
 */
export function phenotypeKey(genotype: string, dominance: Dominance): string {
  const parts: string[] = []
  for (let i = 0; i < genotype.length; i += 2) {
    const a = genotype[i]!
    const b = genotype[i + 1]!
    const gene = a.toLowerCase()
    const hasDominant = a !== a.toLowerCase() || b !== b.toLowerCase()
    const heterozygous = a !== b
    if (dominance === 'incomplete' && heterozygous) parts.push(`${gene}:intermediate`)
    else parts.push(`${gene}:${hasDominant ? 'dominant' : 'recessive'}`)
  }
  return parts.join(' ')
}

export interface PunnettResult {
  rows: string[]
  columns: string[]
  cells: string[][]
  /** Offspring genotypes with their counts, most frequent first. */
  genotypes: Array<{ genotype: string; count: number }>
  phenotypes: Array<{ key: string; count: number }>
  total: number
}

export function punnettSquare(
  mother: Array<[string, string]>,
  father: Array<[string, string]>,
  dominance: Dominance,
): PunnettResult {
  const rows = gametes(mother)
  const columns = gametes(father)
  const cells = rows.map((row) => columns.map((column) => combine(row, column)))
  const tally = (keys: string[]) => {
    const map = new Map<string, number>()
    for (const key of keys) map.set(key, (map.get(key) ?? 0) + 1)
    return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }
  const flat = cells.flat()
  return {
    rows,
    columns,
    cells,
    genotypes: tally(flat).map(([genotype, count]) => ({ genotype, count })),
    phenotypes: tally(flat.map((g) => phenotypeKey(g, dominance))).map(([key, count]) => ({ key, count })),
    total: flat.length,
  }
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

/** "3 : 1", "9 : 3 : 3 : 1" — counts in lowest terms. */
export function ratioText(counts: number[]): string {
  const divisor = counts.reduce((acc, n) => gcd(acc, n), 0) || 1
  return counts.map((n) => n / divisor).join(' : ')
}

// --- pedigrees --------------------------------------------------------------

export interface PedigreeMember {
  id: string
  label?: string
  sex: 'male' | 'female' | 'unknown'
  affected: boolean
  carrier?: boolean
  father?: string
  mother?: string
}

export const MAX_PEDIGREE_MEMBERS = 16

/**
 * Generation of every member (0 = founders), or null when the family is not
 * a valid pedigree (unknown parent, wrong-sex parent, or a cycle).
 */
export function pedigreeGenerations(members: PedigreeMember[]): Map<string, number> | null {
  const byId = new Map(members.map((member) => [member.id, member]))
  for (const member of members) {
    const father = member.father ? byId.get(member.father) : undefined
    const mother = member.mother ? byId.get(member.mother) : undefined
    if ((member.father && !father) || (member.mother && !mother)) return null
    if (father && father.sex === 'female') return null
    if (mother && mother.sex === 'male') return null
  }
  const generation = new Map<string, number>()
  const visiting = new Set<string>()
  const depth = (id: string): number | null => {
    if (generation.has(id)) return generation.get(id)!
    if (visiting.has(id)) return null
    visiting.add(id)
    const member = byId.get(id)!
    const parents = [member.father, member.mother].filter((p): p is string => Boolean(p))
    let level = 0
    for (const parent of parents) {
      const d = depth(parent)
      if (d === null) return null
      level = Math.max(level, d + 1)
    }
    visiting.delete(id)
    generation.set(id, level)
    return level
  }
  for (const member of members) if (depth(member.id) === null) return null
  // Partners without parents of their own sit in their spouse's generation.
  for (const member of members) {
    if (!member.father && !member.mother) continue
    for (const parent of [member.father, member.mother]) {
      const partner = [member.father, member.mother].find((p) => p && p !== parent)
      if (!parent || !partner) continue
      const partnerMember = byId.get(partner)!
      if (!partnerMember.father && !partnerMember.mother) {
        generation.set(partner, Math.max(generation.get(partner)!, generation.get(parent)!))
      }
    }
  }
  return generation
}

export interface PedigreeCouple {
  father?: string
  mother?: string
  children: string[]
}

export interface PedigreeLayout {
  generationCount: number
  /** Generation and horizontal slot (centred on 0) of every member. */
  positions: Map<string, { generation: number; slot: number }>
  couples: PedigreeCouple[]
  /** Members per generation, left to right. */
  rows: string[][]
}

/**
 * Left-to-right order within each generation: founders in input order with
 * their partners beside them; later generations sorted under their parents,
 * each followed by a partner who married in.
 */
export function pedigreeLayout(members: PedigreeMember[]): PedigreeLayout | null {
  const generations = pedigreeGenerations(members)
  if (!generations) return null
  const couples = new Map<string, PedigreeCouple>()
  const partners = new Map<string, Set<string>>()
  for (const member of members) {
    if (!member.father && !member.mother) continue
    const key = `${member.father ?? ''}|${member.mother ?? ''}`
    const couple = couples.get(key) ?? {
      ...(member.father ? { father: member.father } : {}),
      ...(member.mother ? { mother: member.mother } : {}),
      children: [],
    }
    couple.children.push(member.id)
    couples.set(key, couple)
    if (member.father && member.mother) {
      for (const [a, b] of [[member.father, member.mother], [member.mother, member.father]] as const) {
        const set = partners.get(a) ?? new Set<string>()
        set.add(b)
        partners.set(a, set)
      }
    }
  }

  const generationCount = Math.max(...generations.values()) + 1
  const positions = new Map<string, { generation: number; slot: number }>()
  const rows: string[][] = []
  const byId = new Map(members.map((member) => [member.id, member]))
  for (let generation = 0; generation < generationCount; generation++) {
    const inGeneration = members.filter((member) => generations.get(member.id) === generation)
    const parentCentre = (member: PedigreeMember): number => {
      const slots = [member.father, member.mother]
        .map((id) => (id ? positions.get(id)?.slot : undefined))
        .filter((slot): slot is number => slot !== undefined)
      return slots.length ? slots.reduce((a, b) => a + b, 0) / slots.length : Number.POSITIVE_INFINITY
    }
    const marriedIn = (id: string): string[] =>
      [...(partners.get(id) ?? [])].filter((partner) => {
        const other = byId.get(partner)!
        return generations.get(partner) === generation && !other.father && !other.mother
      })
    const sorted = [...inGeneration].sort((a, b) => parentCentre(a) - parentCentre(b))
    const row: string[] = []
    const placeWithPartners = (id: string, partnersFirst: boolean) => {
      if (row.includes(id)) return
      const others = marriedIn(id).filter((partner) => !row.includes(partner))
      if (partnersFirst) row.push(...others, id)
      else row.push(id, ...others)
    }
    // Keep each sibship together, with partners who married in on its outer
    // edges, so a sibship line never runs over an in-law.
    const groups = new Map<string, PedigreeMember[]>()
    for (const member of sorted) {
      if (!member.father && !member.mother) continue
      const key = `${member.father ?? ''}|${member.mother ?? ''}`
      groups.set(key, [...(groups.get(key) ?? []), member])
    }
    for (const member of sorted) {
      if (row.includes(member.id)) continue
      const key = `${member.father ?? ''}|${member.mother ?? ''}`
      const siblings = member.father || member.mother ? groups.get(key)! : [member]
      const married = siblings.filter((sibling) => marriedIn(sibling.id).length > 0)
      const single = siblings.filter((sibling) => marriedIn(sibling.id).length === 0)
      if (married.length >= 2) {
        placeWithPartners(married[0]!.id, true)
        for (const sibling of single) placeWithPartners(sibling.id, false)
        for (const sibling of married.slice(1)) placeWithPartners(sibling.id, false)
      } else {
        for (const sibling of [...single, ...married]) placeWithPartners(sibling.id, false)
      }
    }
    row.forEach((id, index) => positions.set(id, { generation, slot: index - (row.length - 1) / 2 }))
    rows.push(row)
  }
  return { generationCount, positions, couples: [...couples.values()], rows }
}

/** I, II, III … for generation labels. */
export function romanNumeral(n: number): string {
  const table: Array<[number, string]> = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']]
  let out = ''
  let rest = n
  for (const [value, symbol] of table) {
    while (rest >= value) {
      out += symbol
      rest -= value
    }
  }
  return out
}

// --- transcription and translation ------------------------------------------

export const MAX_DNA_LENGTH = 60

const CODONS: Record<string, string> = {}
const TABLE: Array<[string, string]> = [
  ['Phe', 'UUU UUC'], ['Leu', 'UUA UUG CUU CUC CUA CUG'], ['Ile', 'AUU AUC AUA'], ['Met', 'AUG'],
  ['Val', 'GUU GUC GUA GUG'], ['Ser', 'UCU UCC UCA UCG AGU AGC'], ['Pro', 'CCU CCC CCA CCG'],
  ['Thr', 'ACU ACC ACA ACG'], ['Ala', 'GCU GCC GCA GCG'], ['Tyr', 'UAU UAC'], ['Stop', 'UAA UAG UGA'],
  ['His', 'CAU CAC'], ['Gln', 'CAA CAG'], ['Asn', 'AAU AAC'], ['Lys', 'AAA AAG'], ['Asp', 'GAU GAC'],
  ['Glu', 'GAA GAG'], ['Cys', 'UGU UGC'], ['Trp', 'UGG'], ['Arg', 'CGU CGC CGA CGG AGA AGG'],
  ['Gly', 'GGU GGC GGA GGG'],
]
for (const [aminoAcid, codons] of TABLE) for (const codon of codons.split(' ')) CODONS[codon] = aminoAcid

const COMPLEMENT: Record<string, string> = { A: 'U', T: 'A', C: 'G', G: 'C' }

export interface TranslationResult {
  /** mRNA 5′→3′. */
  mrna: string
  codons: Array<{ codon: string; aminoAcid: string }>
  /** True when translation ended at a stop codon. */
  stopped: boolean
}

/**
 * mRNA and amino acids from a DNA strand, read 5′→3′ from its first base.
 * A coding strand gives the mRNA directly (T → U); a template strand, written
 * 3′→5′ as textbooks align it, is complemented base by base.
 */
export function translateDna(dna: string, strand: 'coding' | 'template'): TranslationResult | null {
  const bases = dna.toUpperCase().replace(/[\s-]/g, '')
  if (!/^[ACGT]+$/.test(bases) || bases.length < 3 || bases.length > MAX_DNA_LENGTH) return null
  const mrna = strand === 'coding' ? bases.replace(/T/g, 'U') : [...bases].map((b) => COMPLEMENT[b]).join('')
  const codons: TranslationResult['codons'] = []
  let stopped = false
  for (let i = 0; i + 3 <= mrna.length; i += 3) {
    const codon = mrna.slice(i, i + 3)
    const aminoAcid = CODONS[codon]!
    codons.push({ codon, aminoAcid })
    if (aminoAcid === 'Stop') {
      stopped = true
      break
    }
  }
  return { mrna, codons, stopped }
}
