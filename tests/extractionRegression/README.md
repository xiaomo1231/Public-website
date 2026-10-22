# Extraction regression suite

Permanent checks for the text-extraction error patterns found on real course
PDFs (physics and chemistry slide decks, an answer key, photographed exams).
Every fixture here is **synthetic**: the real files are copyrighted and are
never copied into the repository. Each case is named after the pattern it
guards, so a future change to `pdfLayout.ts`, `fontGlyphs.ts`,
`structureDetection.ts`, `answerMatching.ts` or `ocrExtractor.ts` is checked
against all of them (`npx vitest run tests/extractionRegression`).

| File                     | Case                          | Pattern                                                                                               |
| ------------------------ | ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| `mathLayout.test.ts`     | superscript-after-blank       | a zero-height space item moved the baseline, so `21.5` + raised `2` became `21.52`                    |
|                          | superscript-not-a-new-line    | a raised `2` of `m/s²` started its own line (`2)(20 s) = …`)                                          |
|                          | degree-ring                   | a raised `◦` after `cos 60` landed on a line of its own                                               |
|                          | subscript-letters             | `v` + lowered `fy` read as `vfy` → `v_{fy}`                                                           |
|                          | subscript-digits              | `H` + lowered `2` keeps `H₂O`                                                                         |
|                          | stacked-scripts               | an index set under an exponent (`v²` over `fs`) must not become a fraction → `v_{fs}²`                |
|                          | times-ten-exponent            | `5.75 x10` + raised `-1` → `5.75 ×10⁻¹`; without geometry `x10-1` is left alone                       |
|                          | radical-sign                  | a raised `√` split the line                                                                           |
|                          | same-size-digits              | digits on the baseline are never scripts                                                              |
|                          | display-fraction(-groups)     | numerator line above, denominator below → `1/2`, `(x + 1)/(2 m/s)`                                    |
|                          | inline-half                   | a small raised `1` over a small lowered `2` read as `¹2` → `1/2`                                      |
|                          | ambiguous-stack               | stacked but asymmetric runs: text kept, line flagged `fraction`                                       |
| `fontGlyphs.test.ts`     | font-names                    | subset prefixes; Symbol vs Wingdings / Wingdings 2 / 3 / Webdings                                     |
|                          | pua-per-font                  | U+F06C is `λ` in SymbolMT but a bullet in Wingdings, on the same page                                 |
|                          | dingbats                      | `➢`, `✓`, `✗`; a lone unknown dingbat is a bullet                                                     |
|                          | pua-without-font              | no font information → nothing rewritten                                                               |
|                          | math-alphanumerics            | `𝟐𝟎. 𝟗`, `𝒌𝒈`, `𝑥`, `𝜶` fold to plain characters (that Unicode block only)                            |
|                          | math-decimal-space            | `𝟕. 𝟒𝟐` → `7.42`; an ordinary `7. 42` stays                                                           |
|                          | bold-math-exponent            | `× 𝟏𝟎` + raised `𝟐𝟑` → `× 10²³`                                                                       |
|                          | minus-sign                    | `−` (U+2212) and raised `−3` survive (`10⁻³`)                                                         |
|                          | doubled-italic                | PowerPoint's `𝑣𝑣` for `𝑣`, collapsed only with geometric evidence                                     |
|                          | charges-and-isotopes          | OCR text like `40Ca2+` is never rewritten                                                             |
| `tablesAndFlags.test.ts` | aligned-table                 | rows of short cells in clear columns → Markdown table                                                 |
|                          | two-column-prose              | long aligned columns are not a table                                                                  |
|                          | numeric-grid / big-delimiters | probable matrix: text kept, flagged `matrix`                                                          |
|                          | table-chunks                  | table lines become one `table` chunk; `layoutWarnings` reach the chunk                                |
|                          | misaligned-flags              | line flags that do not match the text are ignored                                                     |
|                          | warning-helpers               | `layoutWarningsOf` / `needsVisualProofread` / `mergeLayoutWarnings`                                   |
| `answerLabels.test.ts`   | stray-exponent-line           | `(0.75 m/s` / `2)(10 s) = …` split answer 2 in two                                                    |
|                          | operator-continuation         | a bare number after a line ending in an operator continues it                                         |
|                          | out-of-sequence-repeat        | an earlier number repeated later is body text; a repeat of the latest is still a reviewable duplicate |
|                          | advanced-problem-labels       | `Advanced Problem 2.1`, `Problem 2.2:`, `(Cont.)` continuation                                        |
|                          | question-side-labels          | `Advanced Problem 2.1`, `Q3`, `第3题`, `02.1` normalise like the answer side                          |
|                          | dotted-bare-labels            | `2.1)` is a label, `1.5416 Å` is not                                                                  |
| `structure.test.ts`      | file-name-chapter / patterns  | `Ch03.pdf` deck without headings → one low-confidence "Chapter 3"                                     |
|                          | ch-abbreviation               | `Ch. 4 – Motion in a Plane`                                                                           |
|                          | multi-line-unit-title         | `Unit 3: Reaction` / `Rates and` / `Equilibria` → one title                                           |
|                          | lettered-dividers             | `A/ …`, `B/ …` divider slides → sections                                                              |
| `ocrHandwriting.test.ts` | clean-print / pencil-working  | per-word OCR confidence separates print from hand-writing                                             |
|                          | red-ink / too-little-text     | red ink lowers the bar; too few words never decides                                                   |
|                          | extractor                     | the flag comes from tesseract blocks; isotope notation unchanged                                      |
| `pdfjsRuntime.test.ts`   | runtime-apis                  | the shipped pdf.js build brings the very new JS APIs it calls                                         |
|                          | no-dropped-glyphs             | `° Δ π −` and an exponent survive a real pdf.js parse (they vanished when an API was missing)         |
|                          | table-and-titles              | real pdf.js: a table chunk, a joined unit title and lettered divider sections                         |

When you find a new extraction error, add a synthetic case here first, named
after the pattern, then fix it.
