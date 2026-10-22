/**
 * v8 of the homework walkthrough prompts: an unambiguous `linearSystems`
 * payload.
 *
 * v1–v7 asked for "the full augmented matrix" of every system. For a linear
 * independence test (α₁v₁ + α₂v₃ = 0, "only the trivial solution") models
 * often sent the coefficient matrix [v₁ v₃] instead, which the local check read
 * as [A | b] with b = v₃ — an inconsistent system — and reported 「无解」 for a
 * correct 「唯一解」. v8 asks for `coefficients` A and `rhs` b separately, with
 * `"homogeneous"` for A x = 0 and symbolic right-hand sides written as
 * expressions (not checked). The old shape is still read
 * (`entities/homework/walkthroughChecks.ts`).
 *
 * Only the linear-system lines of the question, sub-part and 详细版 system
 * prompts change; every other prompt is v7's, word for word. `CACHE_VERSION`
 * stays `'v1'`: section hashes do not include the prompt text, so no ready
 * section is offered for an update.
 */
import * as V7 from './v7'

export * from './v7'
export const VERSION = 'v8' as const

/** The v8 `linearSystems` item, as shown in the JSON shape line. */
export function linearSystemExample(label: string): string {
  return `{"label":"${label}","coefficients":[["1","2"],["0","1"]],"rhs":["3","4"],"rref":[["1","0","-5"],["0","1","4"]],"solution":"none|unique|infinite"}`
}

/**
 * The v8 `linearSystems` rule. `who` names whose work it is ("you" or "the
 * author"), `scope` adds e.g. " in this sub-part", `tail` is the closing
 * sentence(s) of the version it replaces.
 */
export function linearSystemRule(options: { verb: string; scope?: string; tail: string }): string {
  return [
    `"linearSystems": for every linear system ${options.verb}${options.scope ?? ''}, give "coefficients" — the coefficient matrix only, one row per equation and one column per unknown (in a question about vectors each vector is a COLUMN) — and "rhs": the right-hand side, one entry per equation, or the string "homogeneous" for a system A x = 0 (a linear independence test c1 v1 + … + ck vk = 0, a null space or kernel).`,
    'Entries are strings (integers or fractions such as "-19/5"); a symbolic right-hand side (a general vector such as (x, y, z) in a spanning question) is written as expressions and is not re-checked.',
    '"rref": the final RREF of [coefficients | rhs] (of the coefficients alone for "homogeneous"). "solution": how many solutions that system has — no, a unique or infinitely many; for a homogeneous system "unique" means only the trivial solution.',
    options.tail,
  ].join(' ')
}

const OLD_EXAMPLE =
  /\{"label":"(\([a-z]\))","augmented":\[\["1","2","3"\]\],"rref":\[\["1","0","-19\/5"\]\],"solution":"none\|unique\|infinite"\}/g
const OLD_RULE =
  /"linearSystems": for every linear system you row-reduce( in this sub-part)?, give the full augmented matrix you start from and the final RREF you reached, as arrays of rows of strings \(integers or fractions such as "-19\/5"\), and whether it has no, a unique or infinitely many solutions\. (Use an empty array when [^.]*\.) (These are checked against your body, so they must match it exactly\.)/

/** Replace v7's linear-system example and rule with v8's. */
export function withV8LinearSystems(prompt: string): string {
  return prompt
    .replace(OLD_EXAMPLE, (_, label: string) => linearSystemExample(label))
    .replace(OLD_RULE, (_, scope: string | undefined, empty: string, match: string) =>
      linearSystemRule({
        verb: 'you row-reduce',
        ...(scope ? { scope } : {}),
        tail: `${empty} ${match}`,
      }),
    )
}

export function buildQuestionSystemPrompt(
  options: Parameters<typeof V7.buildQuestionSystemPrompt>[0],
): string {
  return withV8LinearSystems(V7.buildQuestionSystemPrompt(options))
}

export function buildPartSystemPrompt(
  options: Parameters<typeof V7.buildPartSystemPrompt>[0],
): string {
  return withV8LinearSystems(V7.buildPartSystemPrompt(options))
}

export function buildVariantSystemPrompt(
  options: Parameters<typeof V7.buildVariantSystemPrompt>[0],
): string {
  return withV8LinearSystems(V7.buildVariantSystemPrompt(options))
}
