/**
 * Biology figures: Punnett squares, pedigrees (with inheritance-mode
 * analysis) and transcription/translation.
 *
 * The model supplies only what the lesson states (parental genotypes, family
 * members and who is affected, a DNA sequence and its orientation); gametes,
 * offspring ratios, generations, possible modes of inheritance, mRNA and the
 * amino-acid chain are all computed here.
 */

export * from './genetics'

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

// --- inheritance-mode analysis ------------------------------------------------

/**
 * Modes of inheritance a pedigree can be checked against, assuming full
 * penetrance and no new mutations (the textbook assumptions).
 */
export type InheritanceMode = 'AD' | 'AR' | 'XD' | 'XR' | 'YL'
export const INHERITANCE_MODES: readonly InheritanceMode[] = ['AD', 'AR', 'XD', 'XR', 'YL']

export type InheritanceWitness =
  | 'unaffected-parents-affected-child'
  | 'affected-parents-unaffected-child'
  | 'affected-mother-unaffected-son'
  | 'affected-daughter-unaffected-father'
  | 'affected-father-unaffected-daughter'
  | 'affected-son-unaffected-mother'
  | 'affected-female'
  | 'father-son-differ'
  | 'carrier-in-dominant'
  | 'male-carrier'
  | 'no-assignment'

export interface InheritanceVerdict {
  mode: InheritanceMode
  possible: boolean
  /** Why the mode is excluded: the classic pattern and the members showing it. */
  reason?: { kind: InheritanceWitness; ids: string[] }
}

/** Genotype = number of disease alleles; for males on X/Y it is 0 or 1. */
interface Assignment {
  sex: 'female' | 'male'
  count: number
}

function options(member: PedigreeMember, mode: InheritanceMode): Assignment[] {
  const sexes: Array<'female' | 'male'> = member.sex === 'unknown' ? ['female', 'male'] : [member.sex]
  const out: Assignment[] = []
  for (const sex of sexes) {
    const autosomal = mode === 'AD' || mode === 'AR'
    const counts = autosomal ? [0, 1, 2] : mode === 'YL' ? (sex === 'male' ? [0, 1] : [0]) : sex === 'male' ? [0, 1] : [0, 1, 2]
    for (const count of counts) {
      const affected =
        mode === 'AR' ? count === 2
        : mode === 'AD' ? count >= 1
        : mode === 'XR' ? (sex === 'male' ? count === 1 : count === 2)
        : mode === 'XD' ? count >= 1
        : count === 1
      if (affected !== member.affected) continue
      // A marked carrier is a heterozygote for a recessive trait.
      if (member.carrier && !((mode === 'AR' || (mode === 'XR' && sex === 'female')) && count === 1)) continue
      out.push({ sex, count })
    }
  }
  return out
}

/** Disease alleles a parent can pass on, for the child's sex. */
function transmitted(parent: Assignment, mode: InheritanceMode, childSex: 'female' | 'male', role: 'father' | 'mother'): number[] {
  if (mode === 'AD' || mode === 'AR') return parent.count === 0 ? [0] : parent.count === 2 ? [1] : [0, 1]
  if (mode === 'YL') return role === 'father' && childSex === 'male' ? [parent.count] : [0]
  // X-linked: a father gives his X to daughters only; a mother gives an X to everyone.
  if (role === 'father') return childSex === 'female' ? [parent.count] : [0]
  return parent.count === 0 ? [0] : parent.count === 2 ? [1] : [0, 1]
}

function consistentWithParents(
  child: Assignment,
  father: Assignment | undefined,
  mother: Assignment | undefined,
  mode: InheritanceMode,
): boolean {
  const fromFather = father ? transmitted(father, mode, child.sex, 'father') : null
  const fromMother = mother ? transmitted(mother, mode, child.sex, 'mother') : null
  const maleOnX = (mode === 'XD' || mode === 'XR') && child.sex === 'male'
  const fatherOptions = fromFather ?? (maleOnX ? [0] : mode === 'YL' && child.sex === 'male' ? [0, 1] : [0, 1])
  const motherOptions = fromMother ?? (mode === 'YL' ? [0] : [0, 1])
  for (const f of fatherOptions) for (const m of motherOptions) if (f + m === child.count) return true
  return false
}

function witnessFor(members: PedigreeMember[], mode: InheritanceMode): InheritanceVerdict['reason'] | undefined {
  const byId = new Map(members.map((member) => [member.id, member]))
  if (mode !== 'AR' && mode !== 'XR') {
    const carrier = members.find((member) => member.carrier)
    if (carrier) return { kind: 'carrier-in-dominant', ids: [carrier.id] }
  }
  if (mode === 'XR') {
    const maleCarrier = members.find((member) => member.carrier && member.sex === 'male')
    if (maleCarrier) return { kind: 'male-carrier', ids: [maleCarrier.id] }
  }
  for (const child of members) {
    const father = child.father ? byId.get(child.father) : undefined
    const mother = child.mother ? byId.get(child.mother) : undefined
    const ids = (...list: Array<PedigreeMember | undefined>) => list.filter(Boolean).map((m) => m!.id)
    if ((mode === 'AD' || mode === 'XD') && father && mother && !father.affected && !mother.affected && child.affected) {
      return { kind: 'unaffected-parents-affected-child', ids: ids(father, mother, child) }
    }
    if (mode === 'AR' && father && mother && father.affected && mother.affected && !child.affected) {
      return { kind: 'affected-parents-unaffected-child', ids: ids(father, mother, child) }
    }
    if (mode === 'XR') {
      if (mother?.affected && child.sex === 'male' && !child.affected) {
        return { kind: 'affected-mother-unaffected-son', ids: ids(mother, child) }
      }
      if (father && !father.affected && child.sex === 'female' && child.affected) {
        return { kind: 'affected-daughter-unaffected-father', ids: ids(father, child) }
      }
    }
    if (mode === 'XD') {
      if (father?.affected && child.sex === 'female' && !child.affected) {
        return { kind: 'affected-father-unaffected-daughter', ids: ids(father, child) }
      }
      if (mother && !mother.affected && child.sex === 'male' && child.affected) {
        return { kind: 'affected-son-unaffected-mother', ids: ids(mother, child) }
      }
    }
    if (mode === 'YL') {
      if (child.sex === 'female' && child.affected) return { kind: 'affected-female', ids: [child.id] }
      if (father && child.sex === 'male' && father.affected !== child.affected) {
        return { kind: 'father-son-differ', ids: ids(father, child) }
      }
    }
  }
  if (mode === 'YL') {
    const female = members.find((member) => member.sex === 'female' && member.affected)
    if (female) return { kind: 'affected-female', ids: [female.id] }
  }
  return undefined
}

/**
 * Which modes of inheritance the pedigree allows. A mode is possible when
 * some genotype for every member explains every phenotype and every
 * parent–child transmission (searched exhaustively; at most 16 members).
 */
export function inheritanceAnalysis(members: PedigreeMember[]): InheritanceVerdict[] | null {
  const generations = pedigreeGenerations(members)
  if (!generations || !members.some((member) => member.affected)) return null
  const ordered = [...members].sort((a, b) => generations.get(a.id)! - generations.get(b.id)!)
  const index = new Map(ordered.map((member, i) => [member.id, i]))

  return INHERITANCE_MODES.map((mode) => {
    const choices = ordered.map((member) => options(member, mode))
    const assigned: Array<Assignment | undefined> = new Array(ordered.length)
    const search = (i: number): boolean => {
      if (i === ordered.length) return true
      const member = ordered[i]!
      for (const choice of choices[i]!) {
        const father = member.father ? assigned[index.get(member.father)!] : undefined
        const mother = member.mother ? assigned[index.get(member.mother)!] : undefined
        if (father && father.sex !== 'male') continue
        if (mother && mother.sex !== 'female') continue
        if ((member.father || member.mother) && !consistentWithParents(choice, father, mother, mode)) continue
        assigned[i] = choice
        if (search(i + 1)) return true
      }
      assigned[i] = undefined
      return false
    }
    // Parents must be the right sex in every assignment.
    for (let i = 0; i < ordered.length; i++) {
      const member = ordered[i]!
      if (members.some((child) => child.father === member.id)) choices[i] = choices[i]!.filter((c) => c.sex === 'male')
      if (members.some((child) => child.mother === member.id)) choices[i] = choices[i]!.filter((c) => c.sex === 'female')
    }
    const possible = choices.every((list) => list.length > 0) && search(0)
    if (possible) return { mode, possible }
    return { mode, possible, reason: witnessFor(members, mode) ?? { kind: 'no-assignment', ids: [] } }
  })
}

// --- transcription and translation ------------------------------------------

export const MAX_DNA_LENGTH = 90

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
const DNA_COMPLEMENT: Record<string, string> = { A: 'T', T: 'A', C: 'G', G: 'C' }

/** The direction a strand is written in, left to right. */
export type WrittenDirection = '5to3' | '3to5'

export interface TranslationOptions {
  /**
   * How the given strand is written. University texts write every strand
   * 5′→3′ unless stated; omitted, the legacy reading applies (coding 5′→3′,
   * template 3′→5′ aligned under the mRNA).
   */
  direction?: WrittenDirection
  /** Start at the first AUG (default `first` — from the first base). */
  start?: 'aug' | 'first'
}

export interface TranslationResult {
  /** mRNA 5′→3′. */
  mrna: string
  /** The given strand re-oriented to line up base by base with `mrna`. */
  alignedDna: string
  /** True when the strand had to be reversed to line up 5′→3′ with the mRNA. */
  reversed: boolean
  /** Index in `mrna` where translation starts; -1 when no AUG was found. */
  startIndex: number
  codons: Array<{ codon: string; aminoAcid: string }>
  /** True when translation ended at a stop codon. */
  stopped: boolean
}

/**
 * mRNA and amino acids from a DNA strand. A coding strand matches the mRNA
 * (T → U); a template strand is its complement, read antiparallel. The
 * strand is first put into the orientation that lines up with the mRNA
 * written 5′→3′.
 */
export function translateDna(
  dna: string,
  strand: 'coding' | 'template',
  options: TranslationOptions = {},
): TranslationResult | null {
  const bases = dna.toUpperCase().replace(/[\s-]/g, '').replace(/^5'|3'$|^3'|5'$/g, '')
  if (!/^[ACGT]+$/.test(bases) || bases.length < 3 || bases.length > MAX_DNA_LENGTH) return null
  const direction = options.direction ?? (strand === 'coding' ? '5to3' : '3to5')
  // Coding strand lines up 5′→3′; template strand lines up 3′→5′.
  const reversed = strand === 'coding' ? direction === '3to5' : direction === '5to3'
  const alignedDna = reversed ? [...bases].reverse().join('') : bases
  const mrna = strand === 'coding' ? alignedDna.replace(/T/g, 'U') : [...alignedDna].map((b) => COMPLEMENT[b]).join('')
  const startIndex = options.start === 'aug' ? mrna.indexOf('AUG') : 0
  const codons: TranslationResult['codons'] = []
  let stopped = false
  if (startIndex >= 0) {
    for (let i = startIndex; i + 3 <= mrna.length; i += 3) {
      const codon = mrna.slice(i, i + 3)
      const aminoAcid = CODONS[codon]!
      codons.push({ codon, aminoAcid })
      if (aminoAcid === 'Stop') {
        stopped = true
        break
      }
    }
  }
  return { mrna, alignedDna, reversed, startIndex, codons, stopped }
}

/** The complementary DNA strand, base by base (no reversal). */
export function complementDna(dna: string): string {
  return [...dna].map((b) => DNA_COMPLEMENT[b] ?? b).join('')
}
