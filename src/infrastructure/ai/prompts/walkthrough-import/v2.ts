/**
 * v2 of the walkthrough import prompt: the `linearSystems` items use the
 * unambiguous `coefficients` + `rhs` shape of `homework-walkthrough/v8` (a
 * coefficient matrix sent as an "augmented" one made the local check report
 * 「无解」 for an independence test). Everything else is v1's, word for word;
 * the old shape is still read.
 */
import { linearSystemExample, linearSystemRule } from '../homework-walkthrough/v8'
import * as V1 from './v1'

export * from './v1'
export const VERSION = 'v2' as const

const OLD_EXAMPLE =
  '"linearSystems":[{"label":"(a)","augmented":[["1","2","3"]],"rref":[["1","0","-19/5"]],"solution":"none|unique|infinite"}]'
const OLD_RULE =
  '"linearSystems": for every linear system the author row-reduces, the full augmented matrix the author starts from and the final RREF the author reached, as arrays of rows of strings (integers or fractions such as "-19/5"), and whether the author concludes no, a unique or infinitely many solutions. Copy the author’s matrices, do not compute your own. Use an empty array when there is none.'

export function buildSystemPrompt(options: V1.ImportSystemOptions): string {
  return V1.buildSystemPrompt(options)
    .replace(OLD_EXAMPLE, `"linearSystems":[${linearSystemExample('(a)')}]`)
    .replace(
      OLD_RULE,
      linearSystemRule({
        verb: 'the author row-reduces',
        tail: 'Copy the author’s matrices and conclusion ("solution" is what the author concludes), do not compute your own. Use an empty array when there is none.',
      }),
    )
}
