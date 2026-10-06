import {
  alleleTokens,
  genotypePairs,
  inheritanceAnalysis,
  isDominant,
  pedigreeLayout,
  punnettSquare,
  ratioText,
  romanNumeral,
  translateDna,
  type InheritanceVerdict,
} from '@/entities/tutorVisualization/biology'
import type {
  PedigreeVisualization,
  PunnettTrait,
  PunnettVisualization,
  TranslationVisualization,
} from '@/entities/tutorVisualization/types'
import type { UseTranslationResult } from '@/i18n'
import type { UILanguage } from '@/i18n/types'
import type { PlotLayout } from './plotLayout'

type T = UseTranslationResult['t']

const SERIES = 'hsl(var(--viz-series-1))'
const LINE = 'hsl(var(--foreground))'
const CARD = 'hsl(var(--card))'
const LABEL = 'hsl(var(--viz-label))'

/** Soft backgrounds per phenotype class (cycled for more than four). */
const CLASS_TINTS = [1, 2, 3, 4].map((slot) => `hsl(var(--viz-series-${slot}) / 0.16)`)
const CLASS_SWATCHES = [1, 2, 3, 4].map((slot) => `hsl(var(--viz-series-${slot}))`)

// --- Punnett square ----------------------------------------------------------

/** A genotype or gamete with its superscripts set as superscripts (I^A → Iᴬ). */
export function GenotypeText({ text }: { text: string }): JSX.Element {
  const tokens = alleleTokens(text) ?? [text]
  return (
    <span className="whitespace-nowrap">
      {tokens.map((token, i) => {
        const caret = token.indexOf('^')
        if (caret < 0) return <span key={i}>{token}</span>
        return (
          <span key={i}>
            {token.slice(0, caret)}
            <sup className="text-[0.7em]">{token.slice(caret + 1).replace(/[{}]/g, '')}</sup>
          </span>
        )
      })}
    </span>
  )
}

/** One gene's part of a phenotype key: `a:A`, `i:I^A+I^B`, `X:b:X^b`, `a:intermediate`. */
function splitPart(part: string): { gene: string; expr: string } {
  if (part.startsWith('X:')) return { gene: part.slice(2, 3), expr: part.slice(4) }
  return { gene: part.slice(0, 1), expr: part.slice(2) }
}

/** The display name of a phenotype class, from the lesson's trait names where given. */
function PhenotypeName({ phenotype, traits, t }: { phenotype: string; traits: PunnettTrait[]; t: T }): JSX.Element {
  const [sexPart, genesPart] = phenotype.includes('|') ? phenotype.split('|') : ['', phenotype]
  const male = sexPart === 'male'
  const parts = genesPart!.split(' ').map((part, index) => {
    const { gene, expr } = splitPart(part)
    const trait = traits.find((item) => item.gene === gene)
    const xLinked = part.startsWith('X:')
    if (expr === 'intermediate') {
      if (trait?.intermediate) return trait.intermediate
      if (trait?.dominant && trait.recessive) return t('viz.punnettIntermediate', { dominant: trait.dominant, recessive: trait.recessive })
      return <GenotypeText key={index} text={`${gene.toUpperCase()}${gene}`} />
    }
    const tokens = expr.split('+')
    if (trait?.alleles?.length) {
      const names = tokens.map((token) => trait.alleles!.find((entry) => entry.allele === token)?.name)
      if (names.every(Boolean)) return names.every((name) => name!.length === 1) ? names.join('') : names.join(' + ')
    }
    if (trait?.dominant && trait.recessive) {
      if (tokens.length === 1) return isDominant(tokens[0]!) ? trait.dominant : trait.recessive
      return trait.intermediate ?? `${trait.dominant} + ${trait.recessive}`
    }
    // No names: the genotype class, e.g. A_, aa, I^AI^B, X^aY.
    if (tokens.length > 1) return <GenotypeText key={index} text={tokens.join('')} />
    const token = tokens[0]!
    if (xLinked && male) return <GenotypeText key={index} text={`${token}Y`} />
    return <GenotypeText key={index} text={isDominant(token) ? `${token}_` : `${token}${token}`} />
  })
  return (
    <span>
      {sexPart ? <span className="mr-1">{male ? '♂' : '♀'}</span> : null}
      {parts.map((part, i) => (
        <span key={i}>
          {i > 0 ? (traits.length ? ', ' : ' ') : null}
          {part}
        </span>
      ))}
    </span>
  )
}

function PhenotypeList({
  phenotypes,
  total,
  classIndex,
  traits,
  t,
}: {
  phenotypes: Array<{ key: string; count: number }>
  total: number
  classIndex: Map<string, number>
  traits: PunnettTrait[]
  t: T
}): JSX.Element {
  return (
    <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1">
      {phenotypes.map((entry) => (
        <li key={entry.key} className="inline-flex items-center gap-1.5">
          <span
            aria-hidden
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ background: CLASS_SWATCHES[(classIndex.get(entry.key) ?? 0) % CLASS_SWATCHES.length] }}
          />
          <PhenotypeName phenotype={entry.key} traits={traits} t={t} />
          <span className="data-num">
            {entry.count}/{total}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function TutorPunnettFigure({ visualization, t }: { visualization: PunnettVisualization; t: T }): JSX.Element | null {
  const mother = genotypePairs(visualization.mother)
  const father = genotypePairs(visualization.father)
  if (!mother || !father) return null
  const result = punnettSquare(mother, father, visualization.dominance)
  const classIndex = new Map(result.phenotypes.map((entry, index) => [entry.key, index]))

  return (
    <div className="space-y-3 px-1 py-2">
      <div className="overflow-x-auto">
        <table
          className="mx-auto border-collapse text-center text-sm"
          aria-label={t('viz.punnettAria', { mother: visualization.mother, father: visualization.father })}
        >
          <thead>
            <tr>
              <th scope="col" className="p-2 text-xs font-normal text-muted-foreground">
                ♀ \ ♂
              </th>
              {result.columns.map((gamete, index) => (
                <th key={`c-${index}`} scope="col" className="data-num min-w-12 p-2 font-medium">
                  <GenotypeText text={gamete} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((gamete, row) => (
              <tr key={`r-${row}`}>
                <th scope="row" className="data-num p-2 font-medium">
                  <GenotypeText text={gamete} />
                </th>
                {result.cells[row]!.map((cell, column) => (
                  <td
                    key={`${row}-${column}`}
                    className="data-num min-w-12 border border-border/80 p-2"
                    style={{ background: CLASS_TINTS[(classIndex.get(cell.phenotype) ?? 0) % CLASS_TINTS.length] }}
                  >
                    <GenotypeText text={cell.genotype} />
                    {cell.sex ? <span className="ml-0.5 text-[10px] text-muted-foreground">{cell.sex === 'male' ? '♂' : '♀'}</span> : null}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-1 text-center text-[13px] text-muted-foreground">
        <p className="font-medium text-foreground">
          {t('viz.punnettCrossLabel')} <GenotypeText text={visualization.mother} /> × <GenotypeText text={visualization.father} />
        </p>
        <p className="data-num">
          {t('viz.punnettGenotypes')}{' '}
          {result.genotypes.map((entry, i) => (
            <span key={entry.genotype}>
              {i > 0 ? ' : ' : ''}
              <GenotypeText text={entry.genotype} />
            </span>
          ))}{' '}
          = {ratioText(result.genotypes.map((entry) => entry.count))}
        </p>
        {result.bySex ? (
          (['female', 'male'] as const).map((sex) => (
            <div key={sex} className="space-y-0.5">
              <p className="font-medium text-foreground">
                {sex === 'female' ? t('viz.punnettDaughters') : t('viz.punnettSons')}{' '}
                {result.bySex![sex].phenotypes.length > 1 && (
                  <span className="data-num">{t('viz.punnettPhenotypeRatio', { ratio: ratioText(result.bySex![sex].phenotypes.map((entry) => entry.count)) })}</span>
                )}
              </p>
              <PhenotypeList phenotypes={result.bySex![sex].phenotypes} total={result.bySex![sex].total} classIndex={classIndex} traits={visualization.traits} t={t} />
            </div>
          ))
        ) : (
          <>
            <PhenotypeList phenotypes={result.phenotypes} total={result.total} classIndex={classIndex} traits={visualization.traits} t={t} />
            <p className="data-num font-medium text-foreground">
              {t('viz.punnettPhenotypeRatio', { ratio: ratioText(result.phenotypes.map((entry) => entry.count)) })}
            </p>
          </>
        )}
      </div>
    </div>
  )
}

// --- pedigree ------------------------------------------------------------------

const SYMBOL = 24
const ROW_HEIGHT = 96

export function TutorPedigreeSvg({
  visualization,
  layout,
  t,
}: {
  visualization: PedigreeVisualization
  layout: PlotLayout
  t: T
}): JSX.Element | null {
  const pedigree = pedigreeLayout(visualization.members)
  if (!pedigree) return null
  const byId = new Map(visualization.members.map((member) => [member.id, member]))
  const widest = Math.max(...pedigree.rows.map((row) => row.length))
  const width = layout.width
  const labelColumn = 34
  const slotWidth = Math.min(84, (width - labelColumn - 16) / Math.max(widest, 1))
  // Room for the last row's symbols and its two label lines.
  const height = 28 + (pedigree.generationCount - 1) * ROW_HEIGHT + 48
  const centre = labelColumn + (width - labelColumn) / 2
  const pos = (id: string) => {
    const p = pedigree.positions.get(id)!
    return { x: centre + p.slot * slotWidth, y: 28 + p.generation * ROW_HEIGHT }
  }
  const half = SYMBOL / 2

  const label = t('viz.pedigreeAria', {
    count: visualization.members.length,
    affected: visualization.members.filter((member) => member.affected).length,
  })
  const hasCarrier = visualization.members.some((member) => member.carrier)

  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={label} className="block h-auto w-full max-w-full">
        <title>{label}</title>
        <g aria-hidden="true">
          {pedigree.rows.map((_, generation) => (
            <text key={`g-${generation}`} x={8} y={28 + generation * ROW_HEIGHT + 4} fontSize="12" fill={LABEL}>
              {romanNumeral(generation + 1)}
            </text>
          ))}

          {/* Partnership, descent and sibship lines. */}
          {pedigree.couples.map((couple, index) => {
            const parents = [couple.father, couple.mother].filter((id): id is string => Boolean(id)).map(pos)
            const children = couple.children.map(pos)
            const parentY = parents[0]!.y
            const midX = parents.reduce((sum, p) => sum + p.x, 0) / parents.length
            const sibshipY = parentY + ROW_HEIGHT / 2
            const xs = [...children.map((c) => c.x), midX]
            return (
              <g key={`couple-${index}`} stroke={LINE} strokeWidth="1.4" fill="none">
                {parents.length === 2 && (
                  <line
                    x1={Math.min(parents[0]!.x, parents[1]!.x) + half}
                    x2={Math.max(parents[0]!.x, parents[1]!.x) - half}
                    y1={parentY}
                    y2={parentY}
                  />
                )}
                <line x1={midX} x2={midX} y1={parents.length === 2 ? parentY : parentY + half} y2={sibshipY} />
                <line x1={Math.min(...xs)} x2={Math.max(...xs)} y1={sibshipY} y2={sibshipY} />
                {children.map((child, i) => (
                  <line key={i} x1={child.x} x2={child.x} y1={sibshipY} y2={child.y - half} />
                ))}
              </g>
            )
          })}

          {pedigree.rows.map((row, generation) =>
            row.map((id, index) => {
              const member = byId.get(id)!
              const { x, y } = pos(id)
              const fill = member.affected ? SERIES : CARD
              const shape =
                member.sex === 'male' ? (
                  <rect x={x - half} y={y - half} width={SYMBOL} height={SYMBOL} fill={fill} stroke={LINE} strokeWidth="1.6" />
                ) : member.sex === 'female' ? (
                  <circle cx={x} cy={y} r={half} fill={fill} stroke={LINE} strokeWidth="1.6" />
                ) : (
                  <path d={`M ${x} ${y - half} L ${x + half} ${y} L ${x} ${y + half} L ${x - half} ${y} Z`} fill={fill} stroke={LINE} strokeWidth="1.6" />
                )
              return (
                <g key={id}>
                  {shape}
                  {member.carrier && <circle cx={x} cy={y} r={3.5} fill={LINE} />}
                  <text x={x} y={y + half + 14} textAnchor="middle" fontSize="11" fill={LABEL}>
                    {`${romanNumeral(generation + 1)}-${index + 1}`}
                  </text>
                  {member.label && (
                    <text x={x} y={y + half + 27} textAnchor="middle" fontSize="11" fill={LINE}>
                      {member.label}
                    </text>
                  )}
                </g>
              )
            }),
          )}
        </g>
      </svg>
      <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-3 w-3 border border-foreground" style={{ background: SERIES }} />
          {t('viz.pedigreeAffected')}
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-3 w-3 border border-foreground bg-card" />
          {t('viz.pedigreeUnaffected')}
        </li>
        {hasCarrier && (
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden className="relative inline-block h-3 w-3 rounded-full border border-foreground bg-card">
              <span className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground" />
            </span>
            {t('viz.pedigreeCarrier')}
          </li>
        )}
        <li>{t('viz.pedigreeShapes')}</li>
      </ul>
      <InheritanceSummary
        verdicts={inheritanceAnalysis(visualization.members)}
        nameOf={(id) => {
          const p = pedigree.positions.get(id)
          if (!p) return id
          const row = pedigree.rows[p.generation]!
          return `${romanNumeral(p.generation + 1)}-${row.indexOf(id) + 1}`
        }}
        t={t}
      />
    </div>
  )
}

const MODE_KEYS = {
  AD: 'viz.inheritanceAD',
  AR: 'viz.inheritanceAR',
  XD: 'viz.inheritanceXD',
  XR: 'viz.inheritanceXR',
  YL: 'viz.inheritanceYL',
} as const

const WITNESS_KEYS = {
  'unaffected-parents-affected-child': 'viz.witnessUnaffectedParents',
  'affected-parents-unaffected-child': 'viz.witnessAffectedParents',
  'affected-mother-unaffected-son': 'viz.witnessAffectedMother',
  'affected-daughter-unaffected-father': 'viz.witnessAffectedDaughter',
  'affected-father-unaffected-daughter': 'viz.witnessAffectedFather',
  'affected-son-unaffected-mother': 'viz.witnessAffectedSon',
  'affected-female': 'viz.witnessAffectedFemale',
  'father-son-differ': 'viz.witnessFatherSon',
  'carrier-in-dominant': 'viz.witnessCarrierDominant',
  'male-carrier': 'viz.witnessMaleCarrier',
  'no-assignment': 'viz.witnessNoAssignment',
} as const

/** Which modes of inheritance the pedigree allows, with the reason for each exclusion. */
function InheritanceSummary({
  verdicts,
  nameOf,
  t,
}: {
  verdicts: InheritanceVerdict[] | null
  nameOf: (id: string) => string
  t: T
}): JSX.Element | null {
  if (!verdicts) return null
  return (
    <div className="space-y-1 rounded-md border border-border/70 px-3 py-2 text-[13px]">
      <p className="font-medium text-foreground">{t('viz.inheritanceTitle')}</p>
      <ul className="space-y-0.5">
        {verdicts.map((verdict) => (
          <li key={verdict.mode} className={verdict.possible ? 'text-foreground' : 'text-muted-foreground'}>
            <span className="mr-1.5 inline-block w-4 text-center" aria-hidden>
              {verdict.possible ? '✓' : '✗'}
            </span>
            {t(MODE_KEYS[verdict.mode])}
            {verdict.possible ? (
              <span className="ml-1">{t('viz.inheritancePossible')}</span>
            ) : (
              <span className="ml-1">
                {t('viz.inheritanceExcluded')}
                {verdict.reason ? ` — ${t(WITNESS_KEYS[verdict.reason.kind], { who: verdict.reason.ids.map(nameOf).join(', ') })}` : ''}
              </span>
            )}
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">{t('viz.inheritanceAssumption')}</p>
    </div>
  )
}

// --- transcription and translation ------------------------------------------------

const AMINO_ACIDS_ZH: Record<string, string> = {
  Phe: '苯丙氨酸', Leu: '亮氨酸', Ile: '异亮氨酸', Met: '甲硫氨酸', Val: '缬氨酸', Ser: '丝氨酸',
  Pro: '脯氨酸', Thr: '苏氨酸', Ala: '丙氨酸', Tyr: '酪氨酸', His: '组氨酸', Gln: '谷氨酰胺',
  Asn: '天冬酰胺', Lys: '赖氨酸', Asp: '天冬氨酸', Glu: '谷氨酸', Cys: '半胱氨酸', Trp: '色氨酸',
  Arg: '精氨酸', Gly: '甘氨酸',
}

function BaseRun({ dna, mrna, label }: { dna: string; mrna: string; label: string }): JSX.Element {
  return (
    <li className="data-num flex flex-col items-center justify-start rounded-md border border-dashed border-border px-1.5 py-1 text-center text-muted-foreground">
      <span className="font-mono text-xs tracking-wider">{dna}</span>
      <span className="font-mono text-sm tracking-wider">{mrna}</span>
      <span className="text-[10px]">{label}</span>
    </li>
  )
}

export function TutorTranslationFigure({
  visualization,
  t,
  language,
}: {
  visualization: TranslationVisualization
  t: T
  language: UILanguage
}): JSX.Element | null {
  const result = translateDna(visualization.dna, visualization.strand, {
    ...(visualization.direction ? { direction: visualization.direction } : {}),
    ...(visualization.start ? { start: visualization.start } : {}),
  })
  if (!result) return null
  const start = Math.max(0, result.startIndex)
  const end = result.startIndex < 0 ? 0 : start + result.codons.length * 3
  const leader = result.startIndex > 0 ? { dna: result.alignedDna.slice(0, start), mrna: result.mrna.slice(0, start) } : null
  const trailing =
    end < result.mrna.length && result.startIndex >= 0
      ? { dna: result.alignedDna.slice(end), mrna: result.mrna.slice(end) }
      : null
  const writtenDirection = visualization.direction ?? (visualization.strand === 'coding' ? '5to3' : '3to5')
  const alignedLabel = visualization.strand === 'coding' ? t('viz.translationCoding') : t('viz.translationTemplate')
  const chain = result.codons.filter((codon) => codon.aminoAcid !== 'Stop').map((codon) => codon.aminoAcid)

  return (
    <div className="space-y-3 px-1 py-2">
      <p className="break-all text-xs text-muted-foreground">
        {t('viz.translationGiven', {
          strand: visualization.strand === 'coding' ? t('viz.translationCodingShort') : t('viz.translationTemplateShort'),
          direction: writtenDirection === '5to3' ? "5′→3′" : "3′→5′",
        })}{' '}
        <span className="font-mono tracking-wider text-foreground">{visualization.dna}</span>
        {result.reversed ? <span className="ml-1">{t('viz.translationReversed')}</span> : null}
      </p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <dt className="font-medium">1</dt>
        <dd>{alignedLabel}</dd>
        <dt className="font-medium">2</dt>
        <dd>{t('viz.translationMrna')}</dd>
        <dt className="font-medium">3</dt>
        <dd>{t('viz.translationAminoAcid')}</dd>
      </dl>
      {result.startIndex < 0 ? (
        <p className="text-sm text-muted-foreground">{t('viz.translationNoStart')}</p>
      ) : null}
      <ol className="flex flex-wrap gap-1.5" aria-label={t('viz.translationAria')}>
        {leader ? <BaseRun dna={leader.dna} mrna={leader.mrna} label={t('viz.translationLeader')} /> : null}
        {result.codons.map((codon, index) => {
          const stop = codon.aminoAcid === 'Stop'
          const from = start + index * 3
          return (
            <li
              key={index}
              className="data-num flex min-w-[3.75rem] flex-col items-center rounded-md border border-border/80 px-1.5 py-1 text-center"
              style={{ background: stop ? 'hsl(var(--viz-series-2) / 0.12)' : 'hsl(var(--viz-series-1) / 0.08)' }}
            >
              <span className="font-mono text-xs tracking-wider text-muted-foreground">{result.alignedDna.slice(from, from + 3)}</span>
              <span className="font-mono text-sm font-semibold tracking-wider">{codon.codon}</span>
              <span className="text-xs">
                {stop ? t('viz.translationStop') : codon.aminoAcid}
                {!stop && language === 'zh-CN' && AMINO_ACIDS_ZH[codon.aminoAcid] && (
                  <span className="block text-[10px] text-muted-foreground">{AMINO_ACIDS_ZH[codon.aminoAcid]}</span>
                )}
              </span>
            </li>
          )
        })}
        {trailing ? <BaseRun dna={trailing.dna} mrna={trailing.mrna} label={t('viz.translationUntranslated')} /> : null}
        {result.startIndex < 0 ? <BaseRun dna={result.alignedDna} mrna={result.mrna} label={t('viz.translationUntranslated')} /> : null}
      </ol>
      <p className="text-center text-[13px] text-muted-foreground">
        <span className="font-medium text-foreground">{t('viz.translationChain')}</span>{' '}
        <span className="data-num">{chain.length ? `N–${chain.join('–')}–C` : '—'}</span>
        {result.startIndex >= 0 && !result.stopped && <span className="ml-2">{t('viz.translationNoStop')}</span>}
      </p>
    </div>
  )
}
