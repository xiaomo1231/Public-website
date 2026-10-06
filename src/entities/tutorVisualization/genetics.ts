/**
 * Punnett squares at university level.
 *
 * Genotypes are written the way genetics courses write them, and every
 * gamete, offspring genotype, phenotype class and ratio is computed here:
 *
 *   AaBb × AaBb               two autosomal genes (9 : 3 : 3 : 1)
 *   Rr × Rr                   incomplete dominance or codominance (1 : 2 : 1)
 *   I^AI^B × I^Ai             multiple alleles, codominant I^A / I^B (ABO)
 *   X^AX^a × X^AY             X-linked: offspring split by sex
 *   AaX^BX^b × aaX^bY         one autosomal and one X-linked gene
 *
 * Allele tokens: a letter (`A`, `a`), a letter with a superscript (`I^A`,
 * `c^{ch}`), an X-linked allele (`X^A`), or `Y`. An allele is dominant when
 * its base letter (the superscript, for X alleles) is upper-case; two
 * different dominant alleles of one gene are both expressed (codominance).
 */

/** Genes per genotype the square supports (2 → a 4 × 4 square). */
export const MAX_PUNNETT_GENES = 2

export type Dominance = 'complete' | 'incomplete' | 'codominant'
export type Sex = 'female' | 'male'

/** Split a genotype into allele tokens, or null when it cannot be read. */
export function alleleTokens(genotype: string): string[] | null {
  const text = genotype.replace(/\s+/g, '').replace(/\^\{([A-Za-z0-9])\}/g, '^$1')
  const sexLinked = /X\^/.test(text)
  const tokens: string[] = []
  let i = 0
  while (i < text.length) {
    const rest = text.slice(i)
    const x = /^X\^(\{[A-Za-z0-9]+\}|[A-Za-z0-9])/.exec(rest)
    if (x) {
      tokens.push(x[0])
      i += x[0].length
      continue
    }
    if (sexLinked && rest[0] === 'Y') {
      tokens.push('Y')
      i += 1
      continue
    }
    const plain = /^[A-Za-z](\^(\{[A-Za-z0-9]+\}|[A-Za-z0-9]))?/.exec(rest)
    if (!plain) return null
    tokens.push(plain[0])
    i += plain[0].length
  }
  return tokens
}

/** The letter that decides dominance: the superscript for X alleles. */
function deciding(token: string): string {
  if (token.startsWith('X^')) return token.slice(2).replace(/[{}]/g, '')[0] ?? ''
  return token[0]!
}

export function isDominant(token: string): boolean {
  const letter = deciding(token)
  return letter !== '' && letter === letter.toUpperCase() && letter !== letter.toLowerCase()
}

/**
 * `Y` is the Y chromosome only in a genotype that also has X alleles; in
 * `YyRr` (Mendel's seed colour) it is an ordinary dominant allele.
 */
function isYChromosome(token: string, sexLinked: boolean): boolean {
  return sexLinked && token === 'Y'
}

function hasX(tokens: string[]): boolean {
  return tokens.some((token) => token.startsWith('X^'))
}

/** Gene identity of an allele pair: `a` for A/a or I^A/i, `X:b` for X^B/X^b/Y. */
export function geneOf(pair: [string, string]): string {
  const x = pair.find((token) => token.startsWith('X^'))
  if (x) return `X:${deciding(x).toLowerCase()}`
  return pair[0][0]!.toLowerCase()
}

/** Dominant first; for X-linked pairs the X before the Y. */
function orderPair(a: string, b: string): [string, string] {
  const sexLinked = hasX([a, b])
  if (isYChromosome(a, sexLinked)) return [b, a]
  if (isYChromosome(b, sexLinked)) return [a, b]
  if (isDominant(a) !== isDominant(b)) return isDominant(a) ? [a, b] : [b, a]
  return a <= b ? [a, b] : [b, a]
}

/**
 * Allele pairs per gene, e.g. "AaX^BY" → [["A","a"],["X^B","Y"]], or null
 * when the genotype is not a valid diploid genotype of at most two genes.
 */
export function genotypePairs(genotype: string): Array<[string, string]> | null {
  const tokens = alleleTokens(genotype)
  if (!tokens || tokens.length === 0 || tokens.length % 2 !== 0) return null
  const pairs: Array<[string, string]> = []
  for (let i = 0; i < tokens.length; i += 2) {
    const a = tokens[i]!
    const b = tokens[i + 1]!
    const sexLinked = hasX(tokens)
    const sexA = a.startsWith('X^') || isYChromosome(a, sexLinked)
    const sexB = b.startsWith('X^') || isYChromosome(b, sexLinked)
    if (sexA || sexB) {
      if (!sexA || !sexB || (a === 'Y' && b === 'Y')) return null
      if (a !== 'Y' && b !== 'Y' && deciding(a).toLowerCase() !== deciding(b).toLowerCase()) return null
    } else if (a[0]!.toLowerCase() !== b[0]!.toLowerCase()) {
      return null
    }
    pairs.push(orderPair(a, b))
  }
  const genes = pairs.map(geneOf)
  if (new Set(genes).size !== genes.length || pairs.length > MAX_PUNNETT_GENES) return null
  if (genes.filter((gene) => gene.startsWith('X:')).length > 1) return null
  return pairs
}

/** The sex a genotype implies (XX / XY), or undefined without an X-linked gene. */
export function sexOf(pairs: Array<[string, string]>): Sex | undefined {
  const sexPair = pairs.find((pair) => geneOf(pair).startsWith('X:'))
  if (!sexPair) return undefined
  return sexPair.includes('Y') ? 'male' : 'female'
}

/** Gametes as strings, e.g. AaBb → AB, Ab, aB, ab. */
export function gametes(pairs: Array<[string, string]>): string[] {
  return pairs
    .reduce<string[][]>((acc, [a, b]) => acc.flatMap((prefix) => [[...prefix, a], [...prefix, b]]), [[]])
    .map((alleles) => alleles.join(''))
}

/** Combine two gametes (allele lists, gene order) into a genotype. */
function combineAlleles(egg: string[], sperm: string[]): Array<[string, string]> {
  return egg.map((allele, i) => orderPair(allele, sperm[i]!))
}

/**
 * Phenotype class of one genotype: per gene the expressed alleles (or
 * `intermediate`), prefixed with the sex when a gene is X-linked.
 */
export function phenotypeOf(pairs: Array<[string, string]>, dominance: Dominance): string {
  const sex = sexOf(pairs)
  const parts = pairs.map((pair) => {
    const gene = geneOf(pair)
    const [a, b] = pair
    if (b === 'Y' && a.startsWith('X^')) return `${gene}:${a}`
    const dominant = [...new Set(pair.filter(isDominant))]
    let expressed: string[]
    if (dominant.length >= 2) expressed = dominant.sort()
    else if (dominant.length === 1 && a !== b && dominance === 'incomplete') return `${gene}:intermediate`
    else if (dominant.length === 1 && a !== b && dominance === 'codominant') expressed = [a, b]
    else if (dominant.length === 1) expressed = dominant
    else expressed = [...new Set(pair)].sort()
    return `${gene}:${expressed.join('+')}`
  })
  return `${sex ? `${sex}|` : ''}${parts.join(' ')}`
}

export interface PunnettCell {
  genotype: string
  phenotype: string
  sex?: Sex
}

export interface PunnettResult {
  rows: string[]
  columns: string[]
  cells: PunnettCell[][]
  /** Offspring genotypes with their counts, most frequent first. */
  genotypes: Array<{ genotype: string; count: number }>
  phenotypes: Array<{ key: string; count: number }>
  total: number
  /** For an X-linked cross: the phenotype classes within each sex. */
  bySex?: Record<Sex, { total: number; phenotypes: Array<{ key: string; count: number }> }>
}

function tally(keys: string[]): Array<[string, number]> {
  const map = new Map<string, number>()
  for (const key of keys) map.set(key, (map.get(key) ?? 0) + 1)
  return [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

/** Gene order must match: the father's pairs reordered to the mother's genes. */
function alignGenes(mother: Array<[string, string]>, father: Array<[string, string]>): Array<[string, string]> | null {
  const genes = mother.map(geneOf)
  const byGene = new Map(father.map((pair) => [geneOf(pair), pair]))
  const aligned = genes.map((gene) => byGene.get(gene))
  return aligned.every(Boolean) && father.length === mother.length ? (aligned as Array<[string, string]>) : null
}

/** Why two parental genotypes cannot be crossed, or null when they can. */
export function crossProblem(
  mother: Array<[string, string]>,
  father: Array<[string, string]>,
): 'genes-differ' | 'sex-mismatch' | null {
  if (!alignGenes(mother, father)) return 'genes-differ'
  const motherSex = sexOf(mother)
  const fatherSex = sexOf(father)
  if (motherSex === 'male' || fatherSex === 'female') return 'sex-mismatch'
  return null
}

export function punnettSquare(
  mother: Array<[string, string]>,
  fatherInput: Array<[string, string]>,
  dominance: Dominance,
): PunnettResult {
  const father = alignGenes(mother, fatherInput) ?? fatherInput
  const eggs = mother.reduce<string[][]>((acc, [a, b]) => acc.flatMap((p) => [[...p, a], [...p, b]]), [[]])
  const sperm = father.reduce<string[][]>((acc, [a, b]) => acc.flatMap((p) => [[...p, a], [...p, b]]), [[]])
  const cells = eggs.map((egg) =>
    sperm.map((s) => {
      const pairs = combineAlleles(egg, s)
      const sex = sexOf(pairs)
      return {
        genotype: pairs.map(([a, b]) => `${a}${b}`).join(''),
        phenotype: phenotypeOf(pairs, dominance),
        ...(sex ? { sex } : {}),
      }
    }),
  )
  const flat = cells.flat()
  const result: PunnettResult = {
    rows: eggs.map((egg) => egg.join('')),
    columns: sperm.map((s) => s.join('')),
    cells,
    genotypes: tally(flat.map((cell) => cell.genotype)).map(([genotype, count]) => ({ genotype, count })),
    phenotypes: tally(flat.map((cell) => cell.phenotype)).map(([key, count]) => ({ key, count })),
    total: flat.length,
  }
  if (flat.some((cell) => cell.sex)) {
    const group = (sex: Sex) => {
      const within = flat.filter((cell) => cell.sex === sex)
      return { total: within.length, phenotypes: tally(within.map((cell) => cell.phenotype)).map(([key, count]) => ({ key, count })) }
    }
    result.bySex = { female: group('female'), male: group('male') }
  }
  return result
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

/** "3 : 1", "9 : 3 : 3 : 1" — counts in lowest terms. */
export function ratioText(counts: number[]): string {
  const divisor = counts.reduce((acc, n) => gcd(acc, n), 0) || 1
  return counts.map((n) => n / divisor).join(' : ')
}
