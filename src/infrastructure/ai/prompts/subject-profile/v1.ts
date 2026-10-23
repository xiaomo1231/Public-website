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
import type { Subject, SubjectContext, SubjectInput } from '@/entities/project/types'

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
  /** Limits that apply to every call for this subject (e.g. medical safety). */
  boundaries?: string[]
}

const COURSE_FIGURES =
  'When the course material includes a figure for this topic, refer the student to it instead of describing it from memory.'

/** Medical safety limits, shared by medicine (both exam styles) and language courses. */
export const MEDICAL_BOUNDARIES = [
  'This is education, not medical care: never diagnose the student or anyone they describe, and never give treatment or dosage advice for a real person; if the student describes their own symptoms, suggest seeing a doctor.',
  'Reference ranges and drug doses in examples are illustrative and vary by laboratory, guideline and patient — say so when you use them.',
]

const PROFILES: Record<Exclude<Subject, 'other' | 'language'>, SubjectProfile> = {
  calculus: {
    name: 'Calculus / mathematical analysis',
    notation: [
      "Limits as \\lim_{x \\to a}, derivatives as f'(x) or \\frac{dy}{dx} (follow the course material), integrals always with their differential (dx).",
    ],
    reasoning: [
      "Check and state the hypotheses before applying a theorem (continuity, differentiability, the 0/0 or ∞/∞ form for L'Hôpital, convergence for series and improper integrals).",
      'When the course is rigorous (ε–δ, uniform convergence, compactness), keep that rigour instead of replacing it with intuition.',
    ],
    answers: [
      'Prefer exact forms (fractions, π, e, radicals) over decimals unless a numeric value is asked for. Indefinite integrals end with + C.',
    ],
    pitfalls: [
      'missing chain-rule factors',
      'sign errors in integration by parts or substitution',
      'forgetting + C or changing integration limits',
      "applying L'Hôpital outside an indeterminate form",
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
    answers: [
      'Exact integers or closed forms; a small table or enumeration when it makes the answer checkable.',
    ],
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
      "Use calculus where the course does: v = dx/dt, a = dv/dt, W = \\int \\vec{F}\\cdot d\\vec{r}, flux integrals for Gauss's law, line integrals for Ampère's law.",
    ],
    reasoning: [
      "Identify the system and the forces or interactions (a free-body diagram), list knowns and unknowns, then start from the governing law (Newton's laws, conservation of energy, momentum or angular momentum, Maxwell's equations, the laws of thermodynamics).",
      'Solve symbolically first, substitute numbers last, then check units (dimensional analysis) and a limiting case.',
      "For oscillations and waves write the equation of motion and its solution (x = A cos(ωt + φ), ω = √(k/m)); for circuits apply Kirchhoff's laws; for optics state the sign convention of 1/f = 1/d_o + 1/d_i.",
      'Thermodynamics: distinguish state functions from path quantities (Q, W) and use the first and second laws with entropy.',
    ],
    answers: [
      'Numerical results carry units and sensible significant figures — unless an output field explicitly asks for a bare number, in which case give the number in the unit the question uses.',
      'Significant figures: a result from measured data keeps as many significant figures as the least precise datum for products and quotients (the fewest decimal places for sums and differences); round only the final answer, carrying extra digits through intermediate steps; use scientific notation (1.50 × 10³ m) when trailing zeros would be ambiguous. Exact numbers (counts, defined conversions) do not limit them.',
      'Vectors: give components with the axes used, or magnitude and direction with the convention stated (an angle from +x, or a compass bearing such as 17.7° W of N).',
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
      'Significant figures follow the general-chemistry rules: products and quotients keep the fewest significant figures of the data, sums and differences the fewest decimal places; leading zeros never count, trailing zeros after a decimal point do, and a trailing zero of an integer is ambiguous (write 1.50 × 10³); exact numbers (counts, stoichiometric coefficients, defined conversions) do not limit them; round only the final answer; a logarithm (pH) has as many decimal places as the concentration has significant figures.',
      'Nomenclature: IUPAC / Stock names (iron(III) sulfate) with accepted classical names where the course uses them; nuclides with mass number and charge (⁵⁴Cr⁶⁺, $\\ce{^{54}Cr^{6+}}$).',
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
  medicine: {
    name: 'Basic medical sciences for clinical medicine and dentistry (years 1–2: systematic and regional anatomy, histology and embryology, physiology, medical biochemistry and molecular biology, medical cell biology, immunology, medical microbiology, oral anatomy and physiology, introductory pharmacology)',
    notation: [
      'Give each term in Chinese followed by English (and the Latin name for anatomical structures where the course uses it), e.g. 三角肌（deltoid）; define abbreviations on first use (ACh, GFR, CO).',
      "Directions are relative to the anatomical position (superior / inferior, medial / lateral, proximal / distal, superficial / deep, anterior / posterior); left and right are the body's own, never the viewer's.",
      'Dentistry: FDI two-digit tooth notation unless the course uses another system (11 = upper right permanent central incisor, 55 = upper right primary second molar); tooth surfaces mesial, distal, buccal / labial, lingual / palatal, occlusal / incisal.',
      'Units: mmHg (and kPa), mmol/L, mL/min, L/min, bpm; reference ranges are approximate and laboratory-dependent.',
    ],
    reasoning: [
      'Connect structure to function and name the level (molecule, cell, tissue, organ, system).',
      'Describe regulation as a loop: stimulus, receptor, afferent pathway, integrating centre, efferent pathway, effector, and whether the feedback is negative or positive.',
      'Write mechanisms as cause → effect chains, and quantify with the governing equation where one exists (Nernst / GHK, Fick, Starling forces, Henderson–Hasselbalch, clearance C = U·V/P, CO = HR × SV, one-compartment pharmacokinetics).',
      'Anatomy: position and relations (毗邻), blood supply, innervation and lymphatic drainage; trace nerve pathways neuron by neuron and name where each decussates.',
      'Biochemistry: the pathway, its rate-limiting enzyme, regulation, energy yield and a clinical link.',
      'Use a clinical example only to illustrate a basic-science principle.',
    ],
    answers: [
      'Follow Chinese medical exam styles: 名词解释 (a concise definition with its key qualifier), 简答 (numbered points), 论述 (a structured argument); compare easily confused concepts in a table.',
    ],
    pitfalls: [
      'left and right taken from the viewer instead of the body',
      "confusing afferent / efferent, sympathetic / parasympathetic, or a muscle's origin / insertion",
      'mixing up similar structures (layers of an organ wall, arteries and veins in histology)',
      'unit errors (mmHg vs kPa, mmol/L vs mg/dL)',
      'getting the direction of a shift wrong (e.g. oxyhaemoglobin curve to the right)',
      'reading a correlation in a clinical observation as a cause',
      'confusing primary and permanent tooth notation, or mesial and distal',
    ],
    lesson: [
      'When a quantitative physiology or biochemistry topic is central, state the values a diagram needs: ion concentrations (and permeabilities) for membrane potentials; P50 for oxygen binding; EDV, ESV and pressures for the cardiac cycle; lung volumes; Starling forces or clearance data; pH, PaCO₂ and HCO₃⁻ for acid–base; pKa values for an amino acid; the steps of a pathway with their ATP / NADH / FADH₂ changes; dose, volume of distribution, half-life and dosing interval for pharmacokinetics.',
      "For anatomy give relations as a table (a muscle's origin, insertion, action, innervation and blood supply); trace sensory and motor pathways neuron by neuron with the level of each decussation; for embryology and tooth eruption give a timeline with ages.",
      'Anatomy and histology are learnt from images: refer the student to the course figures by page rather than describing them from memory.',
    ],
    boundaries: MEDICAL_BOUNDARIES,
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
    answers: [
      'Precise code or pseudocode in the language the course uses, with its complexity stated.',
    ],
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
  economics: {
    name: 'Economics (introductory micro- and macroeconomics: supply and demand, elasticity, welfare, government intervention, market structures)',
    notation: [
      'Market diagrams: price P on the vertical axis and quantity Q on the horizontal axis; curves are straight lines unless the question says otherwise. Label curves D and S, a shifted curve D1 → D2 (S1 → S2), and the equilibrium (Q*, P*); a new equilibrium (Q2*, P2*).',
      'State the unit of every amount ($, $ per unit, units per week, thousands of units, %); when an axis is in thousands, say so and convert in the answer (½ × 60 × 2 thousand = $60,000).',
    ],
    reasoning: [
      'Keep a change in quantity demanded (a movement along D, caused by the good’s own price) apart from a change in demand (a shift of D, caused by income, prices of substitutes and complements, tastes, expectations, the number of buyers); likewise a change in quantity supplied vs a change in supply (input prices, technology, expectations, the number of sellers, taxes and subsidies on producers).',
      'Draw-and-explain questions: say which curve shifts, in which direction and why, then the previous and the new equilibrium P and Q, and finish with the direction of change of every variable asked.',
      'Elasticity by the midpoint method, ε = (ΔQ / Q_avg) ÷ (ΔP / P_avg); report the price elasticity of demand as an absolute value unless the question asks for the sign; |ε| > 1 elastic, < 1 inelastic, = 1 unit elastic; through a given point, the relatively more elastic of two linear curves is the flatter one. Use the total revenue test (price and total revenue move in opposite directions when demand is elastic). Income and cross-price elasticities keep their sign (normal / inferior, substitutes / complements).',
      'Welfare as areas on the diagram: consumer surplus, producer surplus, tax revenue and deadweight loss as triangles or rectangles (½ × base × height), each with its unit. The burden of a tax falls more on the less elastic side of the market.',
      'A price ceiling binds only below the equilibrium price (shortage), a price floor only above it (surplus); a non-binding control changes nothing.',
      'Keep positive statements (what is, testable) apart from normative ones (what ought to be).',
    ],
    answers: [
      'Give the number with its unit and sign convention ($1,800; 85,000 units; 10%; |ε| = 1.25). Round as the question says, otherwise to two decimal places for elasticities and to whole dollars for money.',
      'Multiple-choice questions often come in groups that all refer to one figure; answer each from the same figure.',
    ],
    pitfalls: [
      'calling a movement along a curve a shift of the curve (or the reverse)',
      'shifting the wrong curve, or shifting a curve in the wrong direction',
      'computing elasticity from end-point percentages instead of the midpoint method',
      'reading the flatter curve as less elastic',
      'forgetting the "thousands" of an axis in an area',
      'treating a non-binding price ceiling or floor as binding',
      'putting the whole tax burden on one side regardless of elasticities',
    ],
    lesson: [
      'Work every market from explicit lines so the diagram can be drawn exactly: give the demand and supply equations (e.g. Qd = 100 − 2P, Qs = 3P − 20) or their intercepts and slopes, the equilibrium they give, and for each change the curve that shifts and by how much (e.g. "supply shifts right by 10 units at every price", or the new equation); for a tax, subsidy, ceiling or floor give its amount or level.',
      COURSE_FIGURES,
    ],
  },
}

/**
 * Medicine for an English-taught programme (e.g. a Central European medical
 * school): English + Latin terminology and that programme's exam formats. The
 * domestic profile above is unchanged, so its cached output stays valid.
 */
const MEDICINE_INTERNATIONAL: SubjectProfile = {
  ...PROFILES.medicine,
  name: `${PROFILES.medicine.name}, in an English-taught programme (international exam style)`,
  notation: [
    'Use English anatomical and medical terms with the Latin name alongside (Terminologia Anatomica / Histologica / Embryologica), e.g. deltoid muscle (musculus deltoideus), and map eponyms to their anatomical names (Eustachian tube → pharyngotympanic tube, tuba auditiva). Do not add Chinese equivalents unless you are responding in Chinese; then explain in Chinese but keep the English and Latin names as the terms to learn. Define abbreviations on first use (ACh, GFR, CO).',
    ...PROFILES.medicine.notation.slice(1),
  ],
  reasoning: PROFILES.medicine.reasoning.map((line) =>
    line.replace('position and relations (毗邻)', 'position and relations (topography)'),
  ),
  answers: [
    'Follow the exam formats of English-taught medical programmes: structure identification on a specimen, model or image ("identify / name the structure": give the English and Latin name and the features that identify it); a full oral-exam style description of a structure in a fixed order (parts and features, position and relations, innervation, blood supply, venous and lymphatic drainage, development, clinical relevance); and single- or multiple-choice questions (MCQ) in English. Compare easily confused structures in a table.',
  ],
  pitfalls: [
    ...PROFILES.medicine.pitfalls,
    'mixing up the English and Latin names, or using an eponym where the anatomical name is expected',
  ],
  lesson: [
    ...(PROFILES.medicine.lesson ?? []),
    'For a structure that is examined by identification, list the features that tell it apart from its neighbours, and end with the full description in exam order.',
  ],
}

/** English names (with the endonym) of languages a course may teach. */
const LANGUAGE_NAMES: Record<string, string> = {
  de: 'German (Deutsch)',
  hu: 'Hungarian (magyar)',
  en: 'English',
  fr: 'French (français)',
  es: 'Spanish (español)',
  it: 'Italian (italiano)',
  pt: 'Portuguese (português)',
  la: 'Latin (latina)',
  ru: 'Russian (русский)',
  pl: 'Polish (polski)',
  cs: 'Czech (čeština)',
  sk: 'Slovak (slovenčina)',
  ro: 'Romanian (română)',
  nl: 'Dutch (Nederlands)',
  sv: 'Swedish (svenska)',
  ja: 'Japanese (日本語)',
  ko: 'Korean (한국어)',
  zh: 'Chinese (中文)',
}

/** English name of a language tag for prompts; unknown tags are named by their code. */
export function targetLanguageName(tag: string): string {
  const known = LANGUAGE_NAMES[tag]
  if (known) return known
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(tag)
    if (name && name !== tag) return `${name} (${tag})`
  } catch {
    // Unsupported tag or no Intl.DisplayNames: fall through.
  }
  return `the language with code "${tag}"`
}

/** Profile of a foreign-language course; the target language comes from the project. */
function languageProfile(targetLanguage: string | undefined): SubjectProfile {
  const full = targetLanguage ? targetLanguageName(targetLanguage) : undefined
  const short = full ? full.replace(/ \(.*\)$/, '') : 'the target language'
  const german = targetLanguage === 'de'
  const hungarian = targetLanguage === 'hu'
  const tableNotes = german
    ? ' such as article and plural'
    : hungarian
      ? ' such as segmentation and vowel-harmony class'
      : ''
  return {
    name: full
      ? `Foreign-language course — the language being learnt is ${full}, often its medical / professional register`
      : 'Foreign-language course (the language being learnt is the one the course material teaches), often its medical / professional register',
    notation: [
      `Explain in the language these instructions ask you to respond in (the student's explanation language), not in ${short}. Every ${short} word, phrase and example sentence stays in ${short}, spelled exactly as in the course material — diacritics, capitalisation and punctuation included — never transliterated, anglicised or stripped of accents.`,
      `Give a translation of each ${short} item in the explanation language the first time it appears. Where these instructions ask for key terms in English alongside the explanation, the terms to learn are the ${short} ones: give the ${short} term (English may follow it).`,
      ...(german
        ? [
            'German: give every noun with its definite article and plural (der Kopf, die Köpfe; die Niere, die Nieren; das Herz, die Herzen), capitalise nouns, and give irregular verb forms when they matter (wehtun — es tut weh — hat wehgetan). Use the formal Sie in doctor–patient talk unless the material does otherwise.',
          ]
        : []),
      ...(hungarian
        ? [
            'Hungarian: segment words into root + suffixes with plus signs (nyak+am+ban "in my neck", fáj+ik), name the vowel-harmony class of the stem (back, front unrounded or front rounded) and pick suffix variants by it (-ban / -ben, -hoz / -hez / -höz). Short and long vowels are different letters (o / ó, ö / ő, u / ú, ü / ű). Use the formal Ön / maga forms in doctor–patient talk unless the material does otherwise.',
          ]
        : []),
      'Pronunciation hints only where a learner is likely to stumble, in a simple respelling or IPA — not for every word.',
    ],
    reasoning: [
      'Teach through use: vocabulary in a phrase or sentence first, then the grammar pattern behind it, then practice. Group vocabulary by theme (body parts, symptoms, history taking, instructions to the patient).',
      'Present grammar as patterns with a small table (case endings, conjugation, word order), contrasting with English where it helps.',
      `Doctor–patient dialogues are communication practice: model the phrases a doctor uses (greeting, asking about the complaint, history, instructions) in the register the course uses, in ${short}.`,
    ],
    answers: [
      'Exercise formats: gap-fill, matching (word ↔ meaning, question ↔ answer), translation in both directions, dialogue completion, and word or sentence ordering.',
      `When an answer is in ${short}, the reference answer is the exact ${short} string (diacritics, capitalisation${german ? ', article' : ''}); list any genuine variants the material accepts instead of loosening the spelling.`,
    ],
    pitfalls: [
      'missing or wrong diacritics',
      ...(german
        ? [
            'wrong article / gender or plural',
            'verb position (second in main clauses, last in subordinate clauses)',
          ]
        : []),
      ...(hungarian
        ? [
            'a suffix variant that breaks vowel harmony',
            'short vs long vowels',
            'the wrong case ending for location or direction (-ban / -ba / -ból)',
          ]
        : []),
      'false friends and word-for-word translation of English phrases',
      'informal instead of formal address with a patient',
    ],
    lesson: [
      `Build the lesson around one communicative task (e.g. introducing yourself, asking where it hurts): a vocabulary table (${short} | translation | notes${tableNotes}), a short model dialogue, the grammar point it uses, then a few practice items.`,
      "Use the course material's own wording and examples; never introduce a different spelling of a word the material uses.",
    ],
    boundaries: [
      `Dialogues and case scenarios are language practice. ${MEDICAL_BOUNDARIES[0]}`,
      MEDICAL_BOUNDARIES[1]!,
    ],
  }
}

function toContext(input: SubjectInput): SubjectContext | undefined {
  if (!input) return undefined
  return typeof input === 'string' ? { subject: input } : input
}

function profileFor(context: SubjectContext): SubjectProfile | undefined {
  const { subject } = context
  if (subject === 'other') return undefined
  if (subject === 'language') return languageProfile(context.targetLanguage)
  if (subject === 'medicine' && context.examStyle === 'international') return MEDICINE_INTERNATIONAL
  return PROFILES[subject]
}

export interface SubjectBlockOptions {
  /** A teaching lesson: also include the subject's lesson guidance. */
  forLesson?: boolean
}

/** The block appended to a system prompt, or '' for subject "other". */
export function buildSubjectBlock(
  subject: SubjectInput,
  options: SubjectBlockOptions = {},
): string {
  const context = toContext(subject)
  const profile = context && profileFor(context)
  if (!profile) return ''
  const list = (items: string[]) => items.map((item) => `  - ${item}`).join('\n')
  const lesson =
    options.forLesson && profile.lesson?.length ? ['In this lesson:', list(profile.lesson)] : []
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
    ...(profile.boundaries?.length ? ['Boundaries (always apply):', list(profile.boundaries)] : []),
    ...lesson,
  ].join('\n')
}

/** Append the subject block to a system prompt. */
export function withSubject(
  systemPrompt: string,
  subject: SubjectInput,
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
  // r4: significant-figure rules (incl. logarithms) and nomenclature / nuclides.
  chemistry: 4,
  // r2: university depth (strand polarity, sex-linkage, χ², pedigrees,
  //     biochemistry) and lesson data for enzyme / population figures.
  biology: 2,
  // r2: university depth (t / χ² / F, test conditions, estimation, regression).
  stats: 2,
  // r2: calculus-based university physics and lesson data for force, motion,
  //     optics, circuit and formula figures.
  // r3: significant-figure rules and vector answer conventions.
  physics: 3,
  // r2: lesson data for tangent, Riemann-sum and Taylor figures.
  calculus: 2,
  // r2: university depth (recurrences, invariants) and traceable inputs.
  cs: 2,
  // r1: new (foreign-language courses); the target language is part of the key.
  language: 1,
  // r1: new (introductory micro- and macroeconomics).
  economics: 1,
}

/**
 * The version string to store / compare for output generated with a subject
 * block: the base prompt version plus this profile version and the subject.
 */
export function subjectPromptVersion(baseVersion: string, subject: SubjectInput): string {
  const context = toContext(subject)
  const revision = context ? (PROFILE_REVISIONS[context.subject] ?? 1) : 1
  return `${baseVersion}+${VERSION}:${subjectVersionKey(context)}${revision > 1 ? `.r${revision}` : ''}`
}

/**
 * The subject part of a version key. Variants get their own key so switching
 * them invalidates exactly that course's output: `language-de` (the target
 * language) and `medicine-intl` (international exam style). Domestic medicine
 * keeps the plain `medicine` key, so its caches are untouched.
 */
function subjectVersionKey(context: SubjectContext | undefined): string {
  if (!context) return 'other'
  if (context.subject === 'language' && context.targetLanguage)
    return `language-${context.targetLanguage}`
  if (context.subject === 'medicine' && context.examStyle === 'international')
    return 'medicine-intl'
  return context.subject
}
