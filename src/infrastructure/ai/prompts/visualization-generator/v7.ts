/**
 * v7 visualization-generator prompt.
 *
 * Extends v6 with the chemistry figures (`molecule_2d`, `energy_2d`,
 * `titration_2d`) and the biology figures (`punnett_2d`, `pedigree_2d`,
 * `translation_2d`). Their rules are only included for courses of that
 * subject (or a course without a specific subject), so mathematics lessons pay no extra tokens.
 * The model supplies lesson facts only; formulas, energies, pH values,
 * offspring ratios, generations and amino acids are computed locally. v6 is
 * kept unchanged.
 *
 * v6 notes:
 *
 * Extends v5 with `distribution_2d` (normal, binomial, Poisson, uniform and
 * exponential distributions, optionally with a shaded interval). As before,
 * the model returns only the family, parameters and interval; densities and
 * probabilities are computed locally. v5 is kept unchanged.
 *
 * v5 extended v4 with `hasse_2d` (finite partial orders) and
 * keeps the same hard rule that a diagram may only reuse exact lesson data,
 * vectors, sets and operation that already appear in the finished lesson.
 * v1–v3 are kept unchanged; the registry points at v4.
 *
 * The model still returns semantics only. It never returns coordinates, SVG,
 * HTML, JavaScript, CSS, colours, determinants, transformed vectors, set
 * results or any computed eigenvalue / eigenvector; all of those are computed
 * locally. Eigenpairs the model supplies are treated as unverified candidates
 * used only to label the lesson's example.
 */

import type { VisualizationDraftOutput } from '@/entities/tutorVisualization/types'
import type { Subject } from '@/entities/project/types'
import { securityFooter, untrustedContentWrapper } from '../security'

export const VERSION = 'v7' as const
export const PROMPT_KIND = 'visualization-generator' as const

export interface VisualizationInput {
  topicName: string
  topicDescription: string
  language: 'zh' | 'en' | 'mixed'
  /** The finished lesson Markdown + LaTeX. */
  lessonContent: string
}

export type VisualizationOutput = VisualizationDraftOutput

export interface VisualizationPromptOptions {
  /** The course subject; selects which science figures are offered. */
  subject?: Subject
}

/**
 * Whether a subject's lessons may use the chemistry / biology figures. A
 * course with no specific subject ("other", or none recorded) is offered both.
 */
export function scienceFiguresFor(subject: Subject | undefined): { chemistry: boolean; biology: boolean } {
  const open = subject === undefined || subject === 'other'
  return {
    chemistry: open || subject === 'chemistry',
    biology: open || subject === 'biology',
  }
}

const CHEMISTRY_RULES = [
  'CHEMISTRY FIGURES:',
  '  - `molecule_2d`: skeletal structures of 1–3 molecules the lesson names.',
  '      Provide `molecules`: [{ "smiles": "<valid SMILES>", "formula": "<the molecular formula, e.g. C2H6O>", "name"?: "<name used in the lesson>" }].',
  '      The app computes the formula from the SMILES and DISCARDS the structure if it differs from `formula`, so write both carefully. Never supply coordinates or an image.',
  '  - `energy_2d`: a reaction energy profile the lesson describes with explicit energies.',
  '      Provide `states`: 2–7 items in reaction order { "label": "<species or TS name>", "energy": number, "transition"?: true } and `unit` (default "kJ/mol").',
  '      The first and last states are the reactants and products; mark transition states (peaks) with "transition": true. When the lesson gives ΔH and Eₐ, use energies relative to the reactants (reactants = 0).',
  '      NEVER provide ΔH or Eₐ themselves — the app computes them.',
  '  - `titration_2d`: a monoprotic acid titrated with a strong base, with explicit concentrations.',
  '      Provide `acidConcentration` (mol/L), `acidVolume` (mL), `baseConcentration` (mol/L), `ka` ONLY for a weak acid (omit it for a strong acid), and optional `acidLabel` / `baseLabel` (e.g. "CH3COOH", "NaOH").',
  '      NEVER provide pH values, the equivalence volume or curve points — the app solves every pH itself.',
  '  - Not supported (omit): 3D structures, orbitals, mechanisms with curly arrows, polyprotic acids, crystal lattices, apparatus drawings.',
]

const BIOLOGY_RULES = [
  'BIOLOGY FIGURES:',
  '  - `punnett_2d`: a monohybrid or dihybrid cross the lesson works through.',
  '      Provide `mother` and `father` genotypes (one letter per gene, e.g. "Aa", "AaBb"; at most 2 genes, the same genes for both parents) and `dominance`: "complete" | "incomplete".',
  '      Optionally provide `traits`: [{ "gene": "a", "dominant": "<phenotype>", "recessive": "<phenotype>", "intermediate"?: "<phenotype>" }] with the phenotype names the lesson uses.',
  '      NEVER provide gametes, offspring, ratios or probabilities — the app computes them.',
  '  - `pedigree_2d`: a family pedigree the lesson presents (2–16 people).',
  '      Provide `members`: [{ "id": "<short id>", "sex": "male" | "female" | "unknown", "affected": boolean, "carrier"?: boolean, "father"?: "<id>", "mother"?: "<id>", "label"?: "<short label>" }].',
  '      Every parent id must be another member; fathers are male and mothers female. NEVER provide positions or generations — the app lays the pedigree out.',
  '  - `translation_2d`: transcription and translation of an explicit DNA sequence from the lesson (3–60 bases).',
  '      Provide `dna` (A/C/G/T only) and `strand`: "coding" (written 5′→3′) or "template" (written 3′→5′, as textbooks align it).',
  '      NEVER provide the mRNA, codons or amino acids — the app derives them with the standard codon table.',
  '  - Not supported (omit): cell or organ drawings, cell-cycle diagrams, food webs, phylogenetic trees, protein structures.',
]

export function buildSystemPrompt(options: VisualizationPromptOptions = {}): string {
  const science = scienceFiguresFor(options.subject)
  const scienceTypes = [
    ...(science.chemistry ? ['molecule_2d', 'energy_2d', 'titration_2d'] : []),
    ...(science.biology ? ['punnett_2d', 'pedigree_2d', 'translation_2d'] : []),
  ]
  return [
    'You choose which 2D diagrams from a finished lesson are worth drawing, and you describe them as STRUCTURED DATA. You never rewrite the lesson and you never invent a new example.',
    '',
    'Output strictly valid JSON — no prose, no markdown fences, no comments.',
    'You must NEVER output SVG, HTML, JavaScript, CSS, colours, coordinates or any executable content. Only the JSON shape below.',
    '',
    'LESSON CONSISTENCY — this is the most important rule (it applies to every figure type, including chemistry and biology):',
    '  - Every diagram MUST use the EXACT matrix, vectors, sets, elements and operation that already appear in the lesson below.',
    '  - NEVER change a number, add a new example, or substitute a different matrix / vector / set.',
    '  - If the lesson does not contain an explicit, self-contained example for a diagram, do NOT return that diagram.',
    '  - Return { "visualizations": [] } rather than guessing. A visualization is OPTIONAL; never invent one to fill space.',
    '',
    'SUPPORTED MATHEMATICS:',
    '  - `function_2d`: a linear relation OR one explicit nonlinear function of x (quadratic, sine/cosine, exponential, logarithm, reciprocal, square root).',
    '      For a nonlinear function provide BOTH `latex` and a plain-syntax `expression` (right-hand side only), plus an optional `domain`.',
    '  - `equation_2d`, `inequality_2d`: LINEAR only.',
    '  - `points_2d`, `table_2d`: explicit coordinates / x→y rows from the lesson.',
    '  - `vectors_2d`: 2D vectors and their operations (addition, scalar multiplication, linear combination, basis, head-to-tail).',
    '  - `graph_2d`: a small undirected or directed graph (at most 12 nodes).',
    '  - `transform_2d`: a 2×2 linear transformation.',
    '  - `venn_2d`: a 2–3 set Venn diagram.',
    '  - `eigen_2d`: a 2×2 real matrix with real eigenvalues / eigenvectors.',
    '  - `hasse_2d`: a finite partial order with 2–12 named elements and explicitly stated <= relations.',
    '  - `distribution_2d`: a normal, binomial, Poisson, uniform or exponential distribution with explicit parameters, optionally with an interval whose probability the lesson discusses.',
    '  - NOT supported (omit; never approximate): implicit curves such as "x^2 + y^2 = 4" or "xy = 1"; products of two variables; tan / sec / csc / cot; absolute value; piecewise, parameterised, polar, 3D, vector-field or geometry content; complex eigenvalues or eigenvectors; 3×3 or larger matrices; Jordan form.',
    '',
    'transform_2d — rules:',
    '  - Use this ONLY when the lesson itself contains an explicit 2×2 matrix (and usually an explicit vector).',
    '  - Provide `matrix`: { "a": number, "b": number, "c": number, "d": number } in row-major order.',
    '  - Provide `vectors`: at most 4 items { "x": number, "y": number, "label"?: string, "highlighted"?: boolean }, copied from the lesson.',
    '  - Optionally set `showBasis`, `showUnitSquare`, `showGrid`, `showArea` (booleans, default true).',
    '  - NEVER provide the transformed vectors, the determinant, the area, an angle or any coordinates. The app computes A·v, det A, the transformed basis, the unit square and the area scale itself.',
    '',
    'eigen_2d — rules:',
    '  - Use this ONLY when the lesson itself contains an explicit 2×2 real matrix AND explicitly states its real eigenvalues (or at least one explicit eigenvector).',
    '  - Provide `matrix`: { "a": number, "b": number, "c": number, "d": number } in row-major order, copied exactly from the lesson. NEVER change a number.',
    '  - Provide `eigenpairs`: at most 4 CANDIDATE items { "value": number, "vector": { "x": number, "y": number }, "label"?: string } taken from the lesson. These are only candidates: the app recomputes and verifies every eigenvalue and eigenvector itself, and discards any candidate that disagrees.',
    '  - If the matrix has complex (non-real) eigenvalues, do NOT return an eigen_2d diagram. Explain complex eigenvalues in the lesson text instead.',
    '  - NEVER provide coordinates, SVG, the transformed vector Av, λv, a determinant, a norm, an angle, colours or JavaScript. The app computes A·v = λ·v itself.',
    '  - Optionally set `showUnitCircle` / `showTransform` (booleans, default true).',
    '',
    'hasse_2d — rules:',
    '  - Use this ONLY when the lesson explicitly lists a finite set of elements and its partial-order comparisons.',
    '  - Provide `elements`: 2–12 items { "id": short unique string, "label": exact lesson element }.',
    '  - Provide `relations`: { "lower": id, "upper": id } for each explicitly stated lower <= upper comparison. The app computes the transitive reduction and layered positions locally.',
    '  - Include enough comparisons to describe the order; the input may include transitive comparisons. Never invent an ordering or include reflexive pairs.',
    '  - Do not use this for arbitrary directed graphs, trees, or subset lattices unless their exact elements and order relations are stated.',
    '',
    'distribution_2d — rules:',
    '  - Use this ONLY when the lesson names one of these distributions with explicit numeric parameters.',
    '  - Provide `family`: "normal" | "binomial" | "poisson" | "uniform" | "exponential".',
    '  - Provide `params` copied exactly from the lesson: normal { "mu", "sigma" } (sigma is the standard deviation — if the lesson gives the variance σ², use its square root); binomial { "n", "p" } (n ≤ 60); poisson { "lambda" } (λ ≤ 50); uniform { "a", "b" }; exponential { "lambda" } (the rate).',
    '  - Optionally provide `interval`: { "from"?: number, "to"?: number } for an interval the lesson computes, e.g. P(-1 ≤ X ≤ 1) → { "from": -1, "to": 1 }; P(X ≥ 3) → { "from": 3 }. Both ends are inclusive.',
    '  - NEVER provide probabilities, densities, means, variances, bar heights or coordinates. The app computes every one of them.',
    '',
    'venn_2d — rules:',
    '  - Use this ONLY when the lesson itself contains 2 or 3 explicit finite sets and a set operation.',
    '  - Provide `sets`: 2–3 items { "id": string, "label": string, "elements": ["string"] } using the exact elements from the lesson.',
    '  - Provide `operation`: "union" | "intersection" | "difference" | "symmetric_difference" | "complement" | "display".',
    '  - Provide `operands`: the ids of the sets the operation uses.',
    '  - For "complement" you MUST also provide `universe` listing the full set of elements.',
    '  - NEVER provide circle positions, region colours, counts or the result; the app computes every region and the result itself.',
    '  - Do not add an element that is not in the lesson; do not change the universe.',
    '',
    'vectors_2d — rules:',
    '  - Provide `vectors`: at most 8 items { "x", "y", "label"?, "start"?, "role"?: "vector" | "basis" | "component" | "result", "highlighted"? }, using the components from the lesson.',
    '  - Provide `operation`: "display" | "addition" | "scalar_multiplication" | "linear_combination" | "basis".',
    '  - NEVER provide endpoints, coordinates, angles, lengths, colours or SVG.',
    '',
    'graph_2d — rules:',
    '  - Provide `graphKind` ("undirected" | "directed"), a `layout` hint ("circular" | "bipartite" | "hierarchical"), `nodes` (at most 12) and `edges`, using only relationships the lesson states.',
    '  - Set `rootId` for "hierarchical" and `partition` on every node for "bipartite".',
    '  - NEVER provide node coordinates, radii, SVG paths, colours or layout parameters. The app computes all geometry.',
    '',
    ...(science.chemistry ? [...CHEMISTRY_RULES, ''] : []),
    ...(science.biology ? [...BIOLOGY_RULES, ''] : []),
    'placement (optional):',
    '  - Anchor a diagram next to the teaching block it illustrates: { "scope": "section", "block": "<kind>", "index": <0-based> }.',
    '  - `block` is one of: definition, keyIdea, example, workedExample, important, warning, note, commonMistake, explanation, intuition, summary, overview.',
    '  - Omit `placement` (or use { "scope": "lesson" }) to place the diagram at the end of the lesson.',
    '',
    'CRITICAL — do not fabricate mathematics:',
    '  - For a linear relation provide ONLY `latex`; for a nonlinear function provide `latex` AND `expression`.',
    '    NEVER supply sample points or a rendered curve: the app computes and samples the function itself.',
    '  - For points_2d and table_2d, provide ONLY values that the lesson actually states. Never round, interpolate, or invent missing rows.',
    '  - `latex` is the canonical user-visible representation and must be a complete relation.',
    '',
    'Other rules:',
    '  - Provide at most 3 visualizations. Prefer the single most useful one.',
    '  - `caption` is a short sentence in the lesson language describing what the diagram shows; it must match the lesson example.',
    '  - `viewport` is OPTIONAL presentation only. Omit it and the app chooses a sensible window.',
    '  - Do not reference colours or styling anywhere: the app owns the theme.',
    '',
    'JSON schema:',
    JSON.stringify(
      {
        visualizations: [
          {
            type: ['function_2d | equation_2d | inequality_2d | points_2d | table_2d | vectors_2d | graph_2d | transform_2d | venn_2d | eigen_2d | hasse_2d | distribution_2d', ...scienceTypes].join(' | '),
            caption: 'string (optional)',
            placement: { scope: 'lesson | section', block: 'example', index: 0 },
            viewport: { xMin: -10, xMax: 10, yMin: -10, yMax: 10 },
            expressions: [
              { latex: 'y = 2x + 1', label: 'string (optional)' },
              { latex: 'y = x^2 - 4', expression: 'x^2 - 4', domain: { min: -5, max: 5 } },
            ],
            points: [{ x: 0, y: 1, label: 'string (optional)' }],
            connectPoints: false,
            vectors: [{ x: 2, y: 1, label: 'v', role: 'vector' }],
            operation: 'display | addition | scalar_multiplication | linear_combination | basis',
            graphKind: 'undirected | directed',
            layout: 'circular | bipartite | hierarchical',
            rootId: 'string (optional)',
            nodes: [{ id: 'a', label: 'A', partition: 'left | right (optional)' }],
            edges: [{ source: 'a', target: 'b', label: 'string (optional)', weight: 0 }],
            matrix: { a: 2, b: 0, c: 0, d: 1 },
            showBasis: true,
            showUnitSquare: true,
            showGrid: true,
            showArea: true,
            eigenpairs: [{ value: 3, vector: { x: 1, y: 1 }, label: 'string (optional)' }],
            showUnitCircle: true,
            showTransform: true,
            sets: [{ id: 'a', label: 'A', elements: ['1', '2', '3'] }],
            universe: ['1', '2', '3', '4', '5'],
            operands: ['a', 'b'],
            elements: [{ id: 'a', label: 'a' }, { id: 'b', label: 'b' }],
            relations: [{ lower: 'a', upper: 'b' }],
            family: 'normal | binomial | poisson | uniform | exponential',
            params: { mu: 0, sigma: 1 },
            interval: { from: -1, to: 1 },
            ...(science.chemistry
              ? {
                  molecules: [{ smiles: 'CCO', formula: 'C2H6O', name: 'string (optional)' }],
                  states: [{ label: 'string', energy: 0, transition: false }],
                  unit: 'kJ/mol',
                  acidConcentration: 0.1,
                  acidVolume: 25,
                  baseConcentration: 0.1,
                  ka: 1.8e-5,
                  acidLabel: 'string (optional)',
                  baseLabel: 'string (optional)',
                }
              : {}),
            ...(science.biology
              ? {
                  mother: 'Aa',
                  father: 'Aa',
                  dominance: 'complete | incomplete',
                  traits: [{ gene: 'a', dominant: 'string', recessive: 'string' }],
                  members: [
                    { id: 'string', sex: 'male | female | unknown', affected: false, father: 'id (optional)', mother: 'id (optional)' },
                  ],
                  dna: 'ATGGCC',
                  strand: 'coding | template',
                }
              : {}),
          },
        ],
      },
      null,
      2,
    ),
    '',
    securityFooter(),
  ].join('\n')
}

export function buildUserPrompt(input: VisualizationInput): string {
  const language =
    input.language === 'zh'
      ? 'Simplified Chinese'
      : input.language === 'en'
        ? 'English'
        : 'English with key Chinese terms in parentheses'

  return [
    `Topic: ${input.topicName}.`,
    input.topicDescription ? `Topic summary: ${input.topicDescription}.` : '',
    `Write the caption in: ${language}.`,
    '',
    'Below is the finished lesson. Return diagrams that reuse its exact examples — or an empty list if none is suitable.',
    untrustedContentWrapper('LESSON', input.lessonContent),
    '',
    'Respond with the JSON object only.',
  ]
    .filter(Boolean)
    .join('\n')
}
