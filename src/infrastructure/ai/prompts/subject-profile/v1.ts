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
    name: 'Physics',
    notation: [
      'SI units throughout; vectors with explicit components or directions; state the coordinate axes and sign convention used.',
    ],
    reasoning: [
      'Identify the system and the forces or interactions (a free-body description), list knowns and unknowns, then start from the governing law (Newton\'s laws, conservation of energy or momentum, …).',
      'Solve symbolically first, substitute numbers last, then check units and a limiting case.',
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
    ],
  },
  chemistry: {
    name: 'Chemistry',
    notation: [
      'Write every chemical formula, ion and equation with mhchem inside maths: $\\ce{H2SO4}$, $\\ce{Fe^3+}$, $\\ce{SO4^2-}$, $\\ce{2H2 + O2 -> 2H2O}$, $\\ce{N2 + 3H2 <=> 2NH3}$, with states as $\\ce{NaCl(aq)}$. Never use Unicode subscripts or plain-text formulas.',
    ],
    reasoning: [
      'Balance equations by atoms and by charge; carry stoichiometry through moles; state conditions and assumptions (temperature, pressure, ideal gas, standard state).',
    ],
    answers: ['Balanced equations with integer coefficients; quantities with units and appropriate significant figures.'],
    pitfalls: [
      'unbalanced equations',
      'molar-mass or mole-ratio errors',
      'missing the limiting reagent',
      'concentration unit mistakes',
      'the sign of ΔH or ΔG',
    ],
    lesson: [
      'When a molecular structure, a reaction energy change or a titration is central to the topic, state its facts explicitly so a diagram can be drawn from them: name each molecule with its formula (e.g. ethanol, $\\ce{C2H6O}$); give the reactant, transition-state and product energies (or ΔH and Eₐ) with units; give the acid and base concentrations, the volume titrated and, for a weak acid, Kₐ.',
      COURSE_FIGURES,
    ],
  },
  biology: {
    name: 'Biology',
    notation: [
      'Use precise biological terms (e.g. "allele", "homologous chromosome", "ATP synthase"); give the Latin binomial in italics for species. Genotypes as letters (AA, Aa, aa; AaBb), with the dominant allele upper-case.',
    ],
    reasoning: [
      'Describe processes as ordered steps with where they happen (organelle, tissue) and what goes in and out.',
      'Connect structure to function, and name the level you are explaining (molecule, cell, organ, organism, population).',
      'In experiments, state the independent and dependent variables, the controls and what the result does and does not show; do not treat correlation as causation.',
      'In genetics, write the parental genotypes, the gametes, and the offspring genotype and phenotype ratios.',
    ],
    answers: [
      'Short, precise explanations using the correct terms; ratios in lowest terms (3 : 1, 9 : 3 : 3 : 1); probabilities as fractions.',
    ],
    pitfalls: [
      'confusing mitosis and meiosis',
      'mixing up genotype and phenotype, or dominance and frequency',
      'treating a correlation as a cause',
      'wrong order of the steps in a process',
      'confusing DNA template and coding strands in transcription',
    ],
    lesson: [
      'When a genetic cross, a pedigree or transcription/translation is central to the topic, work one explicit example: the parental genotypes (e.g. Aa × Aa) with the phenotype each allele gives; a small family stating who is affected; or a short DNA sequence (say whether it is the coding or the template strand) that is transcribed and translated.',
      COURSE_FIGURES,
    ],
  },
  cs: {
    name: 'Computer science',
    notation: [
      'Code snippets go in fenced code blocks with a language tag (never wrap the whole answer in one). Complexity in LaTeX, e.g. O(n \\log n).',
    ],
    reasoning: [
      'Trace an algorithm on a small concrete input; state invariants, pre- and postconditions; analyse time and space complexity.',
      'Consider edge cases explicitly: empty input, a single element, duplicates, boundaries, overflow.',
    ],
    answers: ['Precise code or pseudocode in the language the course uses, with its complexity stated.'],
    pitfalls: [
      'off-by-one and boundary errors',
      'a missing or wrong recursion base case',
      'mutating a collection while iterating over it',
      'confusing worst, average and amortised cost',
    ],
  },
  stats: {
    name: 'Probability and statistics',
    notation: [
      'P(A), P(A \\mid B), \\mathbb{E}[X], \\operatorname{Var}(X), distributions as X \\sim N(\\mu, \\sigma^2); keep sample quantities (\\bar{x}, s) distinct from population ones (\\mu, \\sigma).',
    ],
    reasoning: [
      'Define the random variable and sample space first, and state independence and other assumptions before using them.',
      'For inference, state H_0 and H_1, the test statistic and its distribution, the significance level, and a conclusion in the context of the question.',
    ],
    answers: [
      'Probabilities as exact fractions when practical, otherwise decimals to 3–4 significant figures; interpret the result in words.',
    ],
    pitfalls: [
      'confusing P(A | B) with P(B | A)',
      'assuming independence without justification',
      'n versus n − 1 in the sample variance',
      'misreading a p-value or a confidence interval',
      'mixing up a PMF, a PDF and a CDF',
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
  // Biology was introduced together with its lesson guidance, so it is r1.
  chemistry: 2,
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
