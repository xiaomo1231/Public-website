import {
  genotypePairs,
  pedigreeLayout,
  phenotypeKey,
  punnettSquare,
  ratioText,
  romanNumeral,
  translateDna,
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

/** "a:dominant b:recessive" → "Tall, wrinkled" or "A_ bb". */
function phenotypeName(key: string, traits: PunnettTrait[], t: T): string {
  return key
    .split(' ')
    .map((part) => {
      const [gene = '', kind] = part.split(':')
      const trait = traits.find((item) => item.gene === gene)
      const upper = gene.toUpperCase()
      if (kind === 'dominant') return trait?.dominant ?? `${upper}_`
      if (kind === 'recessive') return trait?.recessive ?? `${gene}${gene}`
      return trait?.intermediate ?? (trait ? t('viz.punnettIntermediate', { dominant: trait.dominant, recessive: trait.recessive }) : `${upper}${gene}`)
    })
    .join(traits.length ? ', ' : ' ')
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
                  {gamete}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((gamete, row) => (
              <tr key={`r-${row}`}>
                <th scope="row" className="data-num p-2 font-medium">
                  {gamete}
                </th>
                {result.cells[row]!.map((genotype, column) => {
                  const index = classIndex.get(phenotypeKey(genotype, visualization.dominance)) ?? 0
                  return (
                    <td
                      key={`${row}-${column}`}
                      className="data-num min-w-12 border border-border/80 p-2"
                      style={{ background: CLASS_TINTS[index % CLASS_TINTS.length] }}
                    >
                      {genotype}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-1 text-center text-[13px] text-muted-foreground">
        <p>
          <span className="font-medium text-foreground">{t('viz.punnettCross', { mother: visualization.mother, father: visualization.father })}</span>
        </p>
        <p className="data-num">
          {t('viz.punnettGenotypes')}{' '}
          {result.genotypes.map((entry) => entry.genotype).join(' : ')} = {ratioText(result.genotypes.map((entry) => entry.count))}
        </p>
        <ul className="flex flex-wrap justify-center gap-x-4 gap-y-1">
          <li className="sr-only">{t('viz.punnettPhenotypes')}</li>
          {result.phenotypes.map((entry, index) => (
            <li key={entry.key} className="inline-flex items-center gap-1.5">
              <span
                aria-hidden
                className="inline-block h-2.5 w-2.5 rounded-sm"
                style={{ background: CLASS_SWATCHES[index % CLASS_SWATCHES.length] }}
              />
              {phenotypeName(entry.key, visualization.traits, t)}
              <span className="data-num">
                {entry.count}/{result.total}
              </span>
            </li>
          ))}
        </ul>
        <p className="data-num font-medium text-foreground">
          {t('viz.punnettPhenotypeRatio', { ratio: ratioText(result.phenotypes.map((entry) => entry.count)) })}
        </p>
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

export function TutorTranslationFigure({
  visualization,
  t,
  language,
}: {
  visualization: TranslationVisualization
  t: T
  language: UILanguage
}): JSX.Element | null {
  const result = translateDna(visualization.dna, visualization.strand)
  if (!result) return null
  const used = result.codons.length * 3
  const rest = visualization.dna.slice(used)
  const restMrna = result.mrna.slice(used)
  const strandLabel = visualization.strand === 'coding' ? t('viz.translationCoding') : t('viz.translationTemplate')
  const chain = result.codons.filter((codon) => codon.aminoAcid !== 'Stop').map((codon) => codon.aminoAcid)

  return (
    <div className="space-y-3 px-1 py-2">
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <dt className="font-medium">1</dt>
        <dd>{strandLabel}</dd>
        <dt className="font-medium">2</dt>
        <dd>{t('viz.translationMrna')}</dd>
        <dt className="font-medium">3</dt>
        <dd>{t('viz.translationAminoAcid')}</dd>
      </dl>
      <ol className="flex flex-wrap gap-1.5" aria-label={t('viz.translationAria')}>
        {result.codons.map((codon, index) => {
          const stop = codon.aminoAcid === 'Stop'
          return (
            <li
              key={index}
              className="data-num flex min-w-[3.75rem] flex-col items-center rounded-md border border-border/80 px-1.5 py-1 text-center"
              style={{ background: stop ? 'hsl(var(--viz-series-2) / 0.12)' : 'hsl(var(--viz-series-1) / 0.08)' }}
            >
              <span className="font-mono text-xs tracking-wider text-muted-foreground">
                {visualization.dna.slice(index * 3, index * 3 + 3)}
              </span>
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
        {rest && (
          <li className="data-num flex flex-col items-center justify-start rounded-md border border-dashed border-border px-1.5 py-1 text-center text-muted-foreground">
            <span className="font-mono text-xs tracking-wider">{rest}</span>
            <span className="font-mono text-sm tracking-wider">{restMrna}</span>
            <span className="text-[10px]">{t('viz.translationUntranslated')}</span>
          </li>
        )}
      </ol>
      <p className="text-center text-[13px] text-muted-foreground">
        <span className="font-medium text-foreground">{t('viz.translationChain')}</span>{' '}
        <span className="data-num">{chain.length ? chain.join('–') : '—'}</span>
        {!result.stopped && <span className="ml-2">{t('viz.translationNoStop')}</span>}
      </p>
    </div>
  )
}
