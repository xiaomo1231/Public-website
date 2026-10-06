/**
 * Subject profile v1 — how a course's subject is normally taught.
 *
 * Not a prompt on its own: a block appended to the system prompt of every
 * teaching / grading / analysis call for a project (see `withSubject`). It
 * carries notation, how to reason, how answers are written and the mistakes
 * typical for the subject, so the tutor, homework walkthroughs, quizzes and
 * mistake analysis all speak the subject's language.
 *
 * Versioned on its own: callers that cache or compare a prompt version fold
 * it in with `subjectPromptVersion`, so changing a profile (or a project's
 * subject) invalidates exactly what was generated under the old one.
 */
import type { Subject } from '@/entities/project/types'

export const VERSION = 'subject-profile/v1' as const

interface SubjectProfile {
  /** English subject name used inside prompts (prompts are English). */
  name: string
  notation: string[]
  reasoning: string[]
  answers: string[]
  pitfalls: string[]
  /** Extra guidance for teaching lessons only (see `withSubject`'s `forLesson`). */
  lesson?: string[]
}

const COURSE_FIGURES =
  'When the course material includes a figure for this topic, refer the student to it instead of describing it from memory.'

const PROFILES: Record<Exclude<Subject, 'other'>, SubjectProfile> = {
  calculus: {
    name: 'Calculus / mathematical analysis',
    notation: [
      'Limits as \\lim_{x \\to a}, derivatives as f\'(x) or \\frac{dy}{dx} (follow the course material), integrals always with their differential (dx).',
    ],
    reasoning: [
      'Check and state the hypotheses before applying a theorem (continuity, differentiability, the 0/0 or ∞/∞ form for L\'Hôpital, convergence for series and improper integrals).',
      'When the course is rigorous (ε–δ, uniform convergence, compactness), keep that rigour instead of replacing it with intuition.',
    ],
    answers: [
      'Prefer exact forms (fractions, π, e, radicals) over decimals unless a numeric value is asked for. Indefinite integrals end with + C.',
    ],
    pitfalls: [
      'missing chain-rule factors',
      'sign errors in integration by parts or substitution',
      'forgetting + C or changing integration limits',
      'applying L\'Hôpital outside an indeterminate form',
      'swapping limits, sums or integrals without justification',
    ],
    lesson: [
      'Anchor each idea in one explicit function with numbers: the point of tangency for a derivative, the interval and number of subintervals for a Riemann sum, the centre and order for a Taylor polynomial, so the figure can show it converging.',
    ],
  },
  linear_algebra: {
    name: 'Linear algebra',
    notation: [
      'Matrices with \\begin{bmatrix} … \\end{bmatrix}; vectors as column vectors unless the material uses another convention; state dimensions (m × n) when they matter.',
    ],
    reasoning: [
      'Show row reduction step by step with the row operation written out (e.g. R_2 \\leftarrow R_2 - 2R_1).',
      'Justify span, independence, rank and invertibility through pivot positions or an explicit equation, not by appearance.',
      'Keep a matrix and the linear map it represents distinct; work over ℝ unless the course says otherwise.',
    ],
    answers: [
      'Exact fractions, reduced row echelon form, and solution sets in parametric vector form. Verify eigenpairs by checking Av = λv.',
    ],
    pitfalls: [
      'arithmetic slips during row reduction',
      'confusing row space, column space and null space',
      'wrong order in matrix multiplication',
      'assuming a matrix is diagonalizable or invertible without checking',
      'misusing the rank–nullity theorem',
    ],
  },
  discrete_math: {
    name: 'Discrete mathematics',
    notation: [
      'Set-builder notation, ∈ / ⊆, logical connectives (\\wedge, \\vee, \\neg, \\rightarrow, \\leftrightarrow), quantifiers, \\triangle for symmetric difference, graphs as G = (V, E).',
    ],
    reasoning: [
      'Name the proof method and keep its structure visible: direct, contrapositive, contradiction, or induction with the base case and inductive step stated separately.',
      'For counting, name the principle used (product rule, sum rule, inclusion–exclusion, pigeonhole) and whether order and repetition matter.',
      'Check general claims on a small explicit example; a truth table is welcome when it settles a logical claim.',
    ],
    answers: ['Exact integers or closed forms; a small table or enumeration when it makes the answer checkable.'],
    pitfalls: [
      'off-by-one errors in counting',
      'confusing ordered and unordered selections',
      'treating a converse as a contrapositive',
      'a missing or wrong base case in induction',
      'swapping the order of quantifiers',
    ],
  },
  physics: {
    name: 'Physics (university level, calculus-based: mechanics, electromagnetism, waves and optics, thermodynamics, modern physics)',
    notation: [
      'SI units throughout; vectors with explicit components or directions (\\vec{F}, \\hat{x}); state the coordinate axes and sign convention used.',
      'Use calculus where the course does: v = dx/dt, a = dv/dt, W = \\int \\vec{F}\\cdot d\\vec{r}, flux integrals for Gauss\'s law, line integrals for Ampère\'s law.',
    ],
    reasoning: [
      'Identify the system and the forces or interactions (a free-body diagram), list knowns and unknowns, then start from the governing law (Newton\'s laws, conservation of energy, momentum or angular momentum, Maxwell\'s equations, the laws of thermodynamics).',
      'Solve symbolically first, substitute numbers last, then check units (dimensional analysis) and a limiting case.',
      'For oscillations and waves write the equation of motion and its solution (x = A cos(ωt + φ), ω = √(k/m)); for circuits apply Kirchhoff\'s laws; for optics state the sign convention of 1/f = 1/d_o + 1/d_i.',
      'Thermodynamics: distinguish state functions from path quantities (Q, W) and use the first and second laws with entropy.',
    ],
    answers: [
      'Numerical results carry units and sensible significant figures — unless an output field explicitly asks for a bare number, in which case give the number in the unit the question uses.',
    ],
    pitfalls: [
      'unit conversion errors',
      'sign or direction errors',
      'a missing force or interaction',
      'confusing mass and weight',
      'using constant-acceleration formulas when acceleration is not constant',
      'confusing distance with displacement, or speed with velocity',
      'mixing up real and virtual images in optics sign conventions',
      'adding resistances in parallel as if in series',
    ],
    lesson: [
      'When a free-body diagram, motion graph, lens or mirror, or circuit is central, state its data explicitly: every force with its magnitude and direction (and the mass or incline angle); the initial position and velocity and each interval of constant acceleration; the focal length and object distance; the source voltage and each resistance with how they are connected.',
      'Give the governing formula with its parameters and realistic values (e.g. x(t) = A cos(ωt + φ) with A, ω, φ), so the student can explore how each parameter changes the result.',
    ],
  },
  chemistry: {
    name: 'Chemistry (university level: general, physical, organic, inorganic, analytical)',
    notation: [
      'Write every chemical formula, ion and equation with mhchem inside maths: $\\ce{H2SO4}$, $\\ce{Fe^3+}$, $\\ce{SO4^2-}$, $\\ce{2H2 + O2 -> 2H2O}$, $\\ce{N2 + 3H2 <=> 2NH3}$, with states as $\\ce{NaCl(aq)}$. Never use Unicode subscripts or plain-text formulas.',
      'Organic species as condensed structural formulas with bonds where they matter ($\\ce{CH2=CH2}$, $\\ce{CH3COOH}$, $\\ce{HC#CH}$) and IUPAC names; state stereochemistry (R/S, E/Z) when it matters.',
      'Concentrations in mol/L (M, mM); thermodynamic quantities with standard-state symbols (ΔH°, ΔS°, ΔG°, E°) and units (kJ/mol, J/(mol·K), V); rate constants with their units.',
    ],
    reasoning: [
      'Balance equations by atoms and by charge; for redox use half-reactions with electrons; carry stoichiometry through moles; state conditions and assumptions (temperature, pressure, ideal gas, standard state, activities ≈ concentrations).',
      'Thermodynamics and equilibrium: connect ΔG° = ΔH° − TΔS° = −RT ln K and ΔG° = −nFE°; decide spontaneity from ΔG, not ΔH; use the reaction quotient Q to predict the direction of shift.',
      'Kinetics: determine rate laws and orders from data (not from the stoichiometry), use integrated rate laws and half-lives, and the Arrhenius equation for temperature dependence; distinguish thermodynamic from kinetic control.',
      'Acid–base: choose the governing equilibrium, use ICE tables or the charge and mass balances, and justify approximations (e.g. x ≪ C, 5 % rule); Henderson–Hasselbalch only for buffers.',
      'Organic: explain reactivity by structure (functional groups, inductive and resonance effects, sterics, carbocation stability), name the mechanism type (SN1/SN2/E1/E2, electrophilic addition, nucleophilic acyl substitution …) and its stereochemical outcome.',
    ],
    answers: [
      'Balanced equations with integer coefficients; quantities with units and significant figures that match the data; equilibrium constants without units unless the course uses them.',
    ],
    pitfalls: [
      'unbalanced equations or missing electrons in half-reactions',
      'molar-mass or mole-ratio errors',
      'missing the limiting reagent',
      'concentration and unit mistakes (mM vs M, kJ vs J in ΔG = ΔH − TΔS)',
      'the sign of ΔH, ΔS, ΔG or E°',
      'reading reaction order from the balanced equation',
      'applying Henderson–Hasselbalch outside the buffer region',
      'ignoring stereochemistry or regiochemistry (Markovnikov) in organic products',
    ],
    lesson: [
      'When a molecular structure, a reaction energy change or a titration is central to the topic, state its facts explicitly so a diagram can be drawn from them: name each molecule with its formula (e.g. ethanol, $\\ce{C2H6O}$); give the reactant, transition-state, intermediate and product energies (or ΔH and Eₐ) with units; for a titration give the analyte and titrant concentrations, the volume titrated, and every Kₐ (polyprotic acids) or K_b (weak bases).',
      'Work at least one quantitative example with real numbers and units, the way a university exam would ask it.',
      'For kinetics give the reaction order, rate constant and initial concentration, or a table of (T, k) for an Arrhenius analysis; for enzyme kinetics give Vmax, Km and any inhibitor with its Kᵢ and concentration.',
      COURSE_FIGURES,
    ],
  },
  biology: {
    name: 'Biology (university level: molecular and cell biology, genetics, biochemistry, physiology, ecology and evolution)',
    notation: [
      'Use precise biological terms (e.g. "allele", "homologous chromosome", "ATP synthase"); give the Latin binomial in italics for species; use gene symbols in italics and protein symbols upright when the course does.',
      'Genotypes as letters (AA, Aa, aa; AaBb) with the dominant allele upper-case; multiple alleles with superscripts ($I^A I^B$, $I^A i$); X-linked genotypes as $X^A X^a$ and $X^a Y$.',
      'Nucleic acids with polarity: write every strand 5′→3′ unless stated, label 5′ and 3′ ends, and say whether a DNA sequence is the coding (sense) or template (antisense) strand.',
    ],
    reasoning: [
      'Describe processes as ordered steps with where they happen (organelle, tissue) and what goes in and out; name the enzymes and regulators involved.',
      'Connect structure to function, and name the level you are explaining (molecule, cell, organ, organism, population).',
      'Experiments: state the hypothesis, independent and dependent variables, controls (positive/negative) and what the result does and does not show; do not treat correlation as causation; mention the statistical test used.',
      'Genetics: write the parental genotypes, the gametes and the offspring genotype and phenotype ratios; for sex-linked traits give ratios separately by sex; test observed ratios with a χ² goodness-of-fit test (df = categories − 1); use recombination frequency for linkage maps; apply Hardy–Weinberg (p² + 2pq + q² = 1) with its assumptions.',
      'Pedigrees: decide dominant vs recessive and autosomal vs X-linked from decisive families (e.g. unaffected parents with an affected child ⇒ recessive; an affected daughter of an unaffected father ⇒ not X-linked recessive).',
      'Biochemistry: use Michaelis–Menten (V₀ = V_max[S]/(K_m + [S])) and inhibition types; reason about energetics with ΔG.',
    ],
    answers: [
      'Short, precise explanations using the correct terms; ratios in lowest terms (3 : 1, 9 : 3 : 3 : 1); probabilities as fractions; for tests give χ², df, p and the conclusion.',
    ],
    pitfalls: [
      'confusing mitosis and meiosis',
      'mixing up genotype and phenotype, or dominance and frequency',
      'treating a correlation as a cause',
      'wrong order of the steps in a process',
      'confusing DNA template and coding strands, or reading a strand in the wrong direction',
      'translating from the first base instead of the start codon',
      'giving sex-linked ratios without separating sons and daughters',
      'using the wrong degrees of freedom in a χ² test',
    ],
    lesson: [
      'When a genetic cross, a pedigree, a χ² test or transcription/translation is central to the topic, work one explicit example: the parental genotypes (e.g. Aa × Aa, $X^A X^a$ × $X^a Y$, $I^A i$ × $I^B i$) with the phenotype each allele gives; a small family stating who is affected; observed counts against an expected ratio; or a short DNA sequence with its 5′/3′ ends and whether it is the coding or the template strand.',
      'For enzyme kinetics give Vmax, Km and any inhibitor (type, [I], Kᵢ); for population growth give N₀, r and, for logistic growth, K.',
      COURSE_FIGURES,
    ],
  },
  cs: {
    name: 'Computer science (university level: data structures, algorithms, systems, theory)',
    notation: [
      'Code snippets go in fenced code blocks with a language tag (never wrap the whole answer in one). Complexity in LaTeX, e.g. O(n \\log n), with Θ / Ω when the course distinguishes them.',
    ],
    reasoning: [
      'Trace an algorithm on a small concrete input; state invariants (loop invariants for correctness proofs), pre- and postconditions; analyse time and space complexity.',
      'Analyse recursive algorithms with a recurrence (e.g. T(n) = 2T(n/2) + Θ(n)) solved by the master theorem or a recursion tree; distinguish worst, average and amortised cost.',
      'Consider edge cases explicitly: empty input, a single element, duplicates, boundaries, overflow; mention stability and in-place behaviour for sorting.',
    ],
    answers: ['Precise code or pseudocode in the language the course uses, with its complexity stated.'],
    pitfalls: [
      'off-by-one and boundary errors',
      'a missing or wrong recursion base case',
      'mutating a collection while iterating over it',
      'confusing worst, average and amortised cost',
      'assuming a BST is balanced (its height can be n − 1)',
    ],
    lesson: [
      'When an algorithm or data structure is central, trace it on one explicit small input: the array to sort (6–10 values), or the keys inserted into a tree in order, so the student can step through it.',
    ],
  },
  stats: {
    name: 'Probability and statistics',
    notation: [
      'P(A), P(A \\mid B), \\mathbb{E}[X], \\operatorname{Var}(X), distributions as X \\sim N(\\mu, \\sigma^2); keep sample quantities (\\bar{x}, s) distinct from population ones (\\mu, \\sigma).',
    ],
    reasoning: [
      'Define the random variable and sample space first, and state independence and other assumptions before using them.',
      'For inference, state H_0 and H_1, the test statistic and its sampling distribution (z, t with its degrees of freedom, χ², F), the significance level, the p-value or critical value, and a conclusion in the context of the question.',
      'Check the conditions of each method (normality or a large sample for the CLT, equal variances for pooled t, expected counts ≥ 5 for χ², independence) and say which test fits (one- vs two-sample, paired, one- vs two-sided).',
      'Estimation: derive estimators (method of moments, maximum likelihood), discuss bias and variance, and build confidence intervals from the pivot.',
      'Regression and ANOVA: interpret coefficients, R², residuals and the F test; distinguish association from causation.',
    ],
    answers: [
      'Probabilities as exact fractions when practical, otherwise decimals to 3–4 significant figures; give test statistics, df and p-values; interpret the result in words.',
    ],
    pitfalls: [
      'confusing P(A | B) with P(B | A)',
      'assuming independence without justification',
      'n versus n − 1 in the sample variance',
      'misreading a p-value or a confidence interval',
      'mixing up a PMF, a PDF and a CDF',
      'using z instead of t for a small sample with unknown σ',
      'wrong degrees of freedom',
      'one-sided vs two-sided p-values',
    ],
    lesson: [
      'When a distribution or a test is central to the topic, work an explicit example with the numbers stated: the distribution and its parameters (including degrees of freedom for t, χ² and F), the interval whose probability is computed, or the observed counts against expected proportions for a χ² test.',
      'For regression give the data table (x, y pairs); for a confidence interval give the sample mean, standard deviation, size and confidence level, and say whether σ is known.',
    ],
  },
}

export interface SubjectBlockOptions {
  /** A teaching lesson: also include the subject's lesson guidance. */
  forLesson?: boolean
}

/** The block appended to a system prompt, or '' for subject "other". */
export function buildSubjectBlock(subject: Subject | undefined, options: SubjectBlockOptions = {}): string {
  if (!subject || subject === 'other') return ''
  const profile = PROFILES[subject]
  const list = (items: string[]) => items.map((item) => `  - ${item}`).join('\n')
  const lesson = options.forLesson && profile.lesson?.length ? ['In this lesson:', list(profile.lesson)] : []
  return [
    `COURSE SUBJECT: ${profile.name}.`,
    'Use the conventions below for this subject. They never override explicit output rules elsewhere in these instructions (JSON shape, field formats, numeric-answer rules), and when the course material uses a different notation, follow the material.',
    'Notation:',
    list(profile.notation),
    'Reasoning:',
    list(profile.reasoning),
    'Answers:',
    list(profile.answers),
    `Typical mistakes in this subject (watch for them; name them neutrally, never as carelessness): ${profile.pitfalls.join('; ')}.`,
    ...lesson,
  ].join('\n')
}

/** Append the subject block to a system prompt. */
export function withSubject(
  systemPrompt: string,
  subject: Subject | undefined,
  options: SubjectBlockOptions = {},
): string {
  const block = buildSubjectBlock(subject, options)
  return block ? `${systemPrompt}\n\n${block}` : systemPrompt
}

/**
 * Per-subject revision of a profile. Editing one subject's profile bumps only
 * its revision, so only that subject's cached lessons and analyses regenerate
 * (a change to the shared wording above bumps `VERSION` for every subject).
 * Revision 1 is implicit, which keeps every existing version string stable.
 */
const PROFILE_REVISIONS: Partial<Record<Subject, number>> = {
  // r2: formulas and equations in mhchem (`\ce{…}`); lesson figure guidance.
  // r3: university depth (organic notation, thermodynamics, kinetics, acid–base)
  //     and lesson data for kinetics / enzyme figures.
  chemistry: 3,
  // r2: university depth (strand polarity, sex-linkage, χ², pedigrees,
  //     biochemistry) and lesson data for enzyme / population figures.
  biology: 2,
  // r2: university depth (t / χ² / F, test conditions, estimation, regression).
  stats: 2,
  // r2: calculus-based university physics and lesson data for force, motion,
  //     optics, circuit and formula figures.
  physics: 2,
  // r2: lesson data for tangent, Riemann-sum and Taylor figures.
  calculus: 2,
  // r2: university depth (recurrences, invariants) and traceable inputs.
  cs: 2,
}

/**
 * The version string to store / compare for output generated with a subject
 * block: the base prompt version plus this profile version and the subject.
 */
export function subjectPromptVersion(baseVersion: string, subject: Subject | undefined): string {
  const key = subject ?? 'other'
  const revision = subject ? (PROFILE_REVISIONS[subject] ?? 1) : 1
  return `${baseVersion}+${VERSION}:${key}${revision > 1 ? `.r${revision}` : ''}`
}
