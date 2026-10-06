/**
 * v9 visualization-generator prompt.
 *
 * Adds an interactive formula explorer for every subject, and university
 * figures for calculus (tangent, Riemann sums, Taylor polynomials), physics
 * (free-body diagrams, motion graphs, ray diagrams, resistor circuits),
 * statistics (regression, confidence intervals), chemistry (kinetics,
 * Arrhenius), biology (enzyme kinetics, population growth) and computer
 * science (sorting, binary search trees). Each family's rules are only sent
 * to the subjects that use it. v8 is kept unchanged.
 *
 * v8 notes:
 *
 * University-level science figures. Extends v7 with: t / χ² / F
 * distributions; `chisquare_test_2d` (goodness of fit) for statistics and
 * biology courses; polyprotic-acid and weak-base titrations; X-linked,
 * multiple-allele and codominant crosses; and translation with an explicit
 * strand direction and start codon. v7 is kept unchanged.
 *
 * v7 notes:
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

export const VERSION = 'v9' as const
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
 * Which science figures a subject's lessons may use. A course with no
 * specific subject ("other", or none recorded) is offered all of them; the
 * χ² test belongs to statistics and biology (genetics).
 */
export interface FigureFamilies {
  chemistry: boolean
  biology: boolean
  tests: boolean
  physics: boolean
  calculus: boolean
  regression: boolean
  kinetics: boolean
  enzyme: boolean
  population: boolean
  algorithms: boolean
}

export function scienceFiguresFor(subject: Subject | undefined): FigureFamilies {
  const open = subject === undefined || subject === 'other'
  const is = (...subjects: Subject[]) => open || (subject !== undefined && subjects.includes(subject))
  return {
    chemistry: is('chemistry'),
    biology: is('biology'),
    tests: is('stats', 'biology'),
    physics: is('physics'),
    calculus: is('calculus'),
    regression: is('stats', 'biology', 'chemistry', 'physics'),
    kinetics: is('chemistry'),
    enzyme: is('biology', 'chemistry'),
    population: is('biology'),
    algorithms: is('cs'),
  }
}

const FORMULA_RULES = [
  'INTERACTIVE FORMULA (any subject):',
  '  - `formula_2d`: a formula the lesson uses, with 1–6 parameters the student can vary with sliders (e.g. x(t) = A cos(ωt + φ), N(t) = N₀e^{rt}, k = A e^{−Ea/(RT)}, v = Vmax·S/(Km + S), or n log₂ n against n² for complexity).',
  '      Provide `variable` (the horizontal-axis symbol, e.g. "t"), `curves`: 1–4 items { "expression": "<plain syntax right-hand side using only the variable and the parameter names>", "label"?: "<name>" },',
  '      `params`: [{ "name": "omega", "value": <the lesson value>, "min": <number>, "max": <number>, "step"?: <number>, "label"?: "<meaning>", "unit"?: "rad/s" }] (names are letters/digits/underscore, never e or pi), `domain`: { "min", "max" } of the variable, and optional `xLabel` / `yLabel` with units.',
  '      Plain syntax only: * for multiplication, ^ for powers, sqrt(), exp(), ln(), log10(), sin(), cos(), tan(), abs(); write physical constants as numbers. Choose slider ranges in which the curve stays meaningful. NEVER provide points.',
  '      Example: { "type": "formula_2d", "variable": "t", "curves": [{ "expression": "A*exp(-b*t)*cos(omega*t)" }], "params": [{ "name": "A", "value": 2, "min": 0.5, "max": 5 }, { "name": "b", "value": 0.3, "min": 0, "max": 2 }, { "name": "omega", "value": 4, "min": 1, "max": 10, "unit": "rad/s" }], "domain": { "min": 0, "max": 10 }, "xLabel": "t (s)", "yLabel": "x (m)" }',
]

const CALCULUS_RULES = [
  'CALCULUS FIGURES:',
  '  - `tangent_2d`: the tangent (and a shrinking secant) to f at a point the lesson discusses. Provide `expression` (f in plain syntax), `variable`?: "x", `domain`: { "min", "max" }, `point` (x₀), `showSecant`?: true.',
  '  - `riemann_2d`: Riemann sums for ∫ₐᵇ f. Provide `expression`, `variable`?, `a`, `b`, `n` (1–200, the lesson\'s value or 8), `method`: "left" | "right" | "midpoint" | "trapezoid".',
  '  - `taylor_2d`: Taylor / Maclaurin polynomials. Provide `expression`, `variable`?, `center`, `order` (1–10, the lesson\'s order), `domain`.',
  '      NEVER provide derivatives, sums, integrals or coefficients — the app computes them (derivatives symbolically).',
]

const PHYSICS_RULES = [
  'PHYSICS FIGURES:',
  '  - `forces_2d`: a free-body diagram. Provide `forces`: 1–8 items { "label": "mg" | "N" | "f" | "T" | …, "magnitude": <number>, "angle": <degrees counter-clockwise from +x; up 90, left 180, down 270> } (only forces acting ON the body), `unit` (default "N"), optional `mass` (kg), `incline` (degrees, surface rising to the right; force angles stay absolute) and `body` label.',
  '  - `motion_2d`: one-dimensional motion with piecewise-constant acceleration. Provide `x0` (m), `v0` (m/s) and `segments`: 1–6 items { "duration": <s>, "acceleration": <m/s²> }.',
  '  - `optics_2d`: a thin lens or spherical mirror. Provide `element`: "converging_lens" | "diverging_lens" | "concave_mirror" | "convex_mirror", `focalLength` (magnitude), `objectDistance` and optional `objectHeight`, all in the same length unit.',
  '  - `circuit_2d`: resistors across an ideal source. Provide `voltage` (V) and `network`: nested { "kind": "series" | "parallel", "items": [ … ] } groups of { "kind": "resistor", "label": "R1", "resistance": <Ω> } (at most 8 resistors, 3 levels).',
  '      NEVER provide net forces, positions, velocities, image distances, magnifications, currents or voltages across resistors — the app computes them.',
]

const REGRESSION_RULES = [
  'DATA FIGURES:',
  '  - `regression_2d`: a scatter plot with the least-squares line. Provide `points`: 3–100 items { "x", "y" } copied from the lesson\'s data, optional `xLabel` / `yLabel` and `level` (default 0.95).',
  '  - `confidence_interval_2d`: a confidence interval for a mean. Provide `mean`, `sd`, `n`, `level` (e.g. 0.95), `sigmaKnown` (true only when the population σ is given — a z interval; otherwise t) and optional `label`.',
  '      NEVER provide slopes, R², intervals or critical values — the app computes them.',
]

const KINETICS_RULES = [
  'REACTION KINETICS FIGURES:',
  '  - `kinetics_2d`: an integrated rate law. Provide `order`: 0 | 1 | 2, `k` (in the lesson\'s units), `a0` (initial concentration), optional `species` (e.g. "N2O5") and `timeUnit` (default "s").',
  '  - `arrhenius_2d`: either measured `points`: 2–12 items { "t": <K>, "k": <rate constant> } (the app fits Ea and A), or `ea` (kJ/mol) and `a` (pre-exponential factor) when the lesson gives them.',
  '      NEVER provide half-lives, curves or fitted values.',
]

const ENZYME_RULES = [
  'ENZYME KINETICS FIGURE:',
  '  - `enzyme_2d`: Michaelis–Menten and Lineweaver–Burk plots. Provide `vmax`, `km`, optional `inhibitor`: { "type": "competitive" | "noncompetitive" | "uncompetitive" | "mixed", "concentration": [I], "ki": Kᵢ, "kiPrime"?: Kᵢ′ (mixed / uncompetitive) }, `substrateUnit`, `rateUnit`.',
  '      NEVER provide apparent constants or curve points.',
]

const POPULATION_RULES = [
  'POPULATION FIGURE:',
  '  - `population_2d`: `model`: "exponential" | "logistic", `n0`, `r` (per time unit), `k` (carrying capacity, logistic only), optional `timeUnit`.',
]

const ALGORITHM_RULES = [
  'ALGORITHM FIGURES:',
  '  - `sorting_2d`: a sorting algorithm step by step. Provide `algorithm`: "bubble" | "insertion" | "selection" | "merge" | "quick" and `values`: the lesson\'s array (2–12 integers).',
  '  - `bst_2d`: a binary search tree. Provide `keys`: 1–15 integers in insertion order.',
  '      NEVER provide intermediate arrays, trees or traversals — the app runs the algorithm.',
]

const CHEMISTRY_RULES = [
  'CHEMISTRY FIGURES:',
  '  - `molecule_2d`: skeletal structures of 1–3 molecules the lesson names.',
  '      Provide `molecules`: [{ "smiles": "<valid SMILES>", "formula": "<the molecular formula, e.g. C2H6O>", "name"?: "<name used in the lesson>" }].',
  '      The app computes the formula from the SMILES and DISCARDS the structure if it differs from `formula`, so write both carefully. Never supply coordinates or an image.',
  '  - `energy_2d`: a reaction energy profile the lesson describes with explicit energies.',
  '      Provide `states`: 2–7 items in reaction order { "label": "<species or TS name>", "energy": number, "transition"?: true } and `unit` (default "kJ/mol").',
  '      The first and last states are the reactants and products; mark transition states (peaks) with "transition": true. When the lesson gives ΔH and Eₐ, use energies relative to the reactants (reactants = 0).',
  '      NEVER provide ΔH or Eₐ themselves — the app computes them.',
  '  - `titration_2d`: an acid titrated with a strong base, or a base titrated with a strong acid, with explicit concentrations.',
  '      Provide `analyte`: "acid" | "base", `concentration` (mol/L) and `volume` (mL) of the analyte, `titrantConcentration` (mol/L), and optional `analyteLabel` / `titrantLabel` (e.g. "H3PO4", "NaOH").',
  '      Acid: `ka` = [Ka1, Ka2, Ka3] for a weak (polyprotic) acid, in decreasing order, one value per proton (e.g. acetic acid [1.8e-5]); omit `ka` for a strong monoprotic acid.',
  '      Base: `kb` for a weak base (e.g. NH3 1.8e-5); omit it for a strong base. Only monoprotic bases.',
  '      NEVER provide pH values, equivalence volumes or curve points — the app solves every pH itself.',
  '  - Not supported (omit): 3D structures, orbitals, mechanisms with curly arrows, crystal lattices, apparatus drawings.',
]

const BIOLOGY_RULES = [
  'BIOLOGY FIGURES:',
  '  - `punnett_2d`: a cross the lesson works through (at most 2 genes; the same genes for both parents).',
  '      Provide `mother` and `father` genotypes written like the lesson:',
  '        autosomal "Aa", "AaBb"; multiple alleles with superscripts "I^AI^B", "I^Ai" (use ^{..} for longer superscripts, e.g. "c^{ch}c");',
  '        X-linked "X^AX^a" (mother) and "X^AY" (father); one autosomal + one X-linked gene, e.g. "AaX^BX^b" × "aaX^bY".',
  '      `dominance`: "complete" (default) | "incomplete" | "codominant" for a two-allele gene. Two different dominant alleles (I^A, I^B) are always codominant.',
  '      Optionally provide `traits`: [{ "gene": "<letter, e.g. a, i, b>", "dominant"?: "<phenotype>", "recessive"?: "<phenotype>", "intermediate"?: "<heterozygote phenotype>", "alleles"?: [{ "allele": "I^A", "name": "A" }] }] with the names the lesson uses (for ABO give allele names: I^A → "A", I^B → "B", i → "O").',
  '      NEVER provide gametes, offspring, ratios or probabilities — the app computes them, and splits X-linked offspring by sex.',
  '  - `pedigree_2d`: a family pedigree the lesson presents (2–16 people).',
  '      Provide `members`: [{ "id": "<short id>", "sex": "male" | "female" | "unknown", "affected": boolean, "carrier"?: boolean, "father"?: "<id>", "mother"?: "<id>", "label"?: "<short label>" }].',
  '      Every parent id must be another member; fathers are male and mothers female. NEVER provide positions or generations — the app lays the pedigree out.',
  '  - `translation_2d`: transcription and translation of an explicit DNA sequence from the lesson (3–90 bases).',
  '      Provide `dna` exactly as written (A/C/G/T; keep 5\'/3\' end labels if the lesson shows them, e.g. "3\'-TACGGC-5\'"), `strand`: "coding" | "template",',
  '      `direction`: "5to3" | "3to5" — the direction the sequence is WRITTEN in the lesson (default "5to3", the university convention), and',
  '      `start`: "aug" (translate from the first AUG — usual for a gene) | "first" (from the first base — only when the lesson does so).',
  '      NEVER provide the mRNA, codons or amino acids — the app derives them with the standard codon table.',
  '  - Not supported (omit): cell or organ drawings, cell-cycle diagrams, food webs, phylogenetic trees, protein structures.',
]

const TEST_RULES = [
  'STATISTICAL TEST FIGURE:',
  '  - `chisquare_test_2d`: a chi-square goodness-of-fit test the lesson carries out (e.g. observed offspring vs a 9 : 3 : 3 : 1 ratio).',
  '      Provide `categories`: 2–12 items { "label": "<category>", "observed": <count>, and EITHER "ratio": <expected proportion> OR "expected": <expected count> } copied from the lesson,',
  '      optional `alpha` (default 0.05) and `df` ONLY if the lesson uses something other than (categories − 1).',
  '      NEVER provide χ², p-values, critical values or the conclusion — the app computes them.',
]

export function buildSystemPrompt(options: VisualizationPromptOptions = {}): string {
  const science = scienceFiguresFor(options.subject)
  const scienceTypes = [
    ...(science.chemistry ? ['molecule_2d', 'energy_2d', 'titration_2d'] : []),
    ...(science.biology ? ['punnett_2d', 'pedigree_2d', 'translation_2d'] : []),
    ...(science.tests ? ['chisquare_test_2d'] : []),
    'formula_2d',
    ...(science.calculus ? ['tangent_2d', 'riemann_2d', 'taylor_2d'] : []),
    ...(science.physics ? ['forces_2d', 'motion_2d', 'optics_2d', 'circuit_2d'] : []),
    ...(science.regression ? ['regression_2d', 'confidence_interval_2d'] : []),
    ...(science.kinetics ? ['kinetics_2d', 'arrhenius_2d'] : []),
    ...(science.enzyme ? ['enzyme_2d'] : []),
    ...(science.population ? ['population_2d'] : []),
    ...(science.algorithms ? ['sorting_2d', 'bst_2d'] : []),
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
    '  - `distribution_2d`: a normal, binomial, Poisson, uniform, exponential, Student t, chi-square or F distribution with explicit parameters, optionally with an interval whose probability the lesson discusses.',
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
    '  - Provide `family`: "normal" | "binomial" | "poisson" | "uniform" | "exponential" | "t" | "chisquare" | "f".',
    '  - Provide `params` copied exactly from the lesson: normal { "mu", "sigma" } (sigma is the standard deviation — if the lesson gives the variance σ², use its square root); binomial { "n", "p" } (n ≤ 60); poisson { "lambda" } (λ ≤ 50); uniform { "a", "b" }; exponential { "lambda" } (the rate); t { "df" }; chisquare { "df" }; f { "df1", "df2" }.',
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
    ...(science.tests ? [...TEST_RULES, ''] : []),
    ...FORMULA_RULES,
    '',
    ...(science.calculus ? [...CALCULUS_RULES, ''] : []),
    ...(science.physics ? [...PHYSICS_RULES, ''] : []),
    ...(science.regression ? [...REGRESSION_RULES, ''] : []),
    ...(science.kinetics ? [...KINETICS_RULES, ''] : []),
    ...(science.enzyme ? [...ENZYME_RULES, ''] : []),
    ...(science.population ? [...POPULATION_RULES, ''] : []),
    ...(science.algorithms ? [...ALGORITHM_RULES, ''] : []),
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
                  analyte: 'acid | base',
                  concentration: 0.1,
                  volume: 25,
                  titrantConcentration: 0.1,
                  ka: [7.5e-3, 6.2e-8, 4.8e-13],
                  kb: 1.8e-5,
                  analyteLabel: 'string (optional)',
                  titrantLabel: 'string (optional)',
                }
              : {}),
            ...(science.tests
              ? {
                  categories: [{ label: 'string', observed: 315, ratio: 9 }],
                  alpha: 0.05,
                }
              : {}),
            ...(science.biology
              ? {
                  mother: 'Aa',
                  father: 'Aa',
                  dominance: 'complete | incomplete | codominant',
                  traits: [
                    { gene: 'a', dominant: 'string', recessive: 'string' },
                    { gene: 'i', alleles: [{ allele: 'I^A', name: 'A' }] },
                  ],
                  members: [
                    { id: 'string', sex: 'male | female | unknown', affected: false, father: 'id (optional)', mother: 'id (optional)' },
                  ],
                  dna: 'ATGGCC',
                  strand: 'coding | template',
                  direction: '5to3 | 3to5',
                  start: 'aug | first',
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
