# Answer-key alignment corpus

Synthetic fixtures (written for the tests, nothing copied from course material) for
`src/entities/homework/professorMap.ts` (小题 ⇄ 教授答案对应) and the problem-level
matching in `src/entities/homework/answerMatching.ts`.

`fixtures.ts` — one entry per layout, with the expected local result, the true
coverage, and (for some) a realistic AI reply and what must survive validation.
`alignment.test.ts` checks each fixture and computes precision / recall of
"sub-part covered by the key" over the corpus (local pass: precision must be 1,
it may abstain; validated replies: every sub-part right). `problemLevel.test.ts`
covers question number ↔ answer entry.

| Family        | Layout                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------- |
| misplaced     | A sub-part's solution written under another sub-part's heading (key restates the question).       |
| several-ways  | The same sub-part solved twice ("Method 1 / Method 2"; nested labels that are two ways).          |
| shared        | One block for several sub-parts ("(a) and (b):", "(b)–(d)").                                      |
| out-of-order  | Sub-parts answered in another order, no restated headings.                                        |
| indirect      | A sub-part established only by another sub-part's work.                                           |
| reference     | "Same as part (x)", a reference to a part that does not exist, a reference to an earlier set.     |
| numbering     | Key numbers / roman numerals / "Part A" for a lettered question.                                  |
| chinese       | （a） full-width brackets, 第(1)问, ① circled numbers.                                            |
| unlabelled    | Unlabelled answers in sequence (only the AI can place them).                                      |
| deferred      | "Left as an exercise", "see the textbook", "not graded", "the first two parts are left to you".   |
| final-only    | Final answers only, several on one line.                                                          |
| extra-missing | A sub-part in the key the question lacks, and one the key lacks.                                  |
| ai-errors     | An AI reply with invented excerpts, a wrong label and a wrong "none".                             |
| problem-level | "Problem 2 (continued)", running page headers, answers out of order, missing / duplicate numbers. |

Adding a layout: add a fixture with `local` and `truth` (and `reply` / `final` /
`confirm` when the AI step matters); the metrics test picks it up.
