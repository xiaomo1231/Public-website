import { describe, expect, it } from 'vitest'
import { extractJSON } from '@/infrastructure/ai/openaiCompatible'
import { InvalidJSONError } from '@/infrastructure/ai/errors'

/**
 * `[p1]`, `[p2]` … are page markers that the app itself puts into the document
 * text it sends to the model (see `collectText` in documentAnalysisService).
 * The model echoes them when citing sources, so they can legitimately appear
 * before, inside, or after the JSON payload.
 *
 * The extractor must never mistake a citation marker for the JSON document.
 */

describe('extractJSON', () => {
  it('A. skips a leading citation marker and finds the real object', () => {
    expect(extractJSON('[p1]\n{"ok":true}')).toEqual({ ok: true })
  })

  it('A2. skips citation markers embedded in leading prose', () => {
    const raw = 'Based on the material, see [p1] and [p2] for details.\n\n{"ok":true}'
    expect(extractJSON(raw)).toEqual({ ok: true })
  })

  it('B. keeps a citation marker inside a JSON string', () => {
    expect(extractJSON('{"text":"[p1]"}')).toEqual({ text: '[p1]' })
  })

  it('C. handles fenced JSON containing a citation marker', () => {
    expect(extractJSON('```json\n{"text":"[p1]"}\n```')).toEqual({ text: '[p1]' })
  })

  it('D. handles braces inside strings', () => {
    expect(extractJSON('{"text":"example { x }"}')).toEqual({ text: 'example { x }' })
  })

  it('E. parses nested arrays of objects', () => {
    expect(extractJSON('{"topics":[{"name":"Functions"}]}')).toEqual({
      topics: [{ name: 'Functions' }],
    })
  })

  it('F. still rejects genuinely truncated JSON', () => {
    expect(() => extractJSON('{"ok":')).toThrow(InvalidJSONError)
  })

  it('G. handles trailing prose after the object', () => {
    expect(extractJSON('{"ok":true}\n\nDone. Sources: [p1]')).toEqual({ ok: true })
  })

  it('H. still parses a top-level array', () => {
    expect(extractJSON('[{"a":1}]')).toEqual([{ a: 1 }])
  })

  it('I. parses a realistic analysis payload preceded by a citation', () => {
    const raw = [
      'Here is the structured analysis. Primary source: [p1].',
      '',
      '{',
      '  "language": "en",',
      '  "topics": [{"name":"Derivatives","description":"Rates of change","sourceRefs":[{"documentName":"Lecture 01.pdf","page":1,"quote":"see [p1]"}]}],',
      '  "concepts": [],',
      '  "formulas": [],',
      '  "symbols": [],',
      '  "examples": [],',
      '  "exercises": [],',
      '  "prerequisites": []',
      '}',
    ].join('\n')

    const parsed = extractJSON<{ topics: Array<{ name: string }> }>(raw)
    expect(parsed.topics[0]?.name).toBe('Derivatives')
  })

  it('J. reports the original JSON error when nothing parses', () => {
    expect(() => extractJSON('prefix [p1] suffix')).toThrow(InvalidJSONError)
  })
})
