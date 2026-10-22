/**
 * Token-usage harness (AGENTS §9 2i). Records the requests each user action
 * sends, offline, and estimates their tokens. `npm run token-usage` prints the
 * table used in `docs/token-usage.md`; the assertions keep the harness itself
 * honest (deterministic, every action measured).
 */
import 'fake-indexeddb/auto'
import { writeFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AppDatabase, setDbForTesting } from '@/infrastructure/db/database'
import {
  CACHE_UNIT,
  costOf,
  estimateTokens,
  markdownTable,
  summarize,
  type ActionSummary,
  type RecordedRequest,
} from './tokenUsage/estimate'
import { PROMPT_SCENARIOS } from './tokenUsage/scenarios'
import { QUIZ_SCENARIOS, runQuizScenario } from './tokenUsage/quizScenario'

let db: AppDatabase

beforeEach(() => {
  db = new AppDatabase()
  setDbForTesting(db)
})

afterEach(() => {
  db.close()
})

async function measureAll(): Promise<ActionSummary[]> {
  const rows = PROMPT_SCENARIOS.map(({ action, run }) => summarize(action, run()))
  for (const { action, config } of QUIZ_SCENARIOS) {
    const fresh = new AppDatabase()
    setDbForTesting(fresh)
    try {
      rows.push(summarize(action, await runQuizScenario(fresh, config)))
    } finally {
      fresh.close()
      setDbForTesting(db)
    }
  }
  return rows
}

describe('token estimate', () => {
  it('counts by character class', () => {
    expect(estimateTokens('')).toBe(0)
    // ~4 Latin letters per token
    expect(estimateTokens('abcdefgh')).toBe(2)
    // CJK ~0.75 per character
    expect(estimateTokens('线性代数')).toBe(3)
    // LaTeX punctuation costs more than prose
    expect(estimateTokens('\\frac{a}{b}')).toBeGreaterThan(estimateTokens('frac a b'))
  })

  it('credits only a prefix shared with an earlier request, in cache units', () => {
    const system = 'x'.repeat(4 * 1000)
    const requests: RecordedRequest[] = [
      { kind: 'a', messages: [{ role: 'system', content: system }], maxTokens: 10 },
      {
        kind: 'a',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: 'different' },
        ],
        maxTokens: 10,
      },
    ]
    const [first, second] = costOf(requests)
    expect(first!.cached).toBe(0)
    expect(second!.cached % CACHE_UNIT).toBe(0)
    expect(second!.cached).toBeGreaterThan(900)
    expect(second!.cached).toBeLessThanOrEqual(second!.input)
  })
})

describe('token-usage harness', () => {
  it('measures every action deterministically', async () => {
    const first = await measureAll()
    const second = await measureAll()
    expect(second).toEqual(first)
    expect(first.length).toBe(PROMPT_SCENARIOS.length + QUIZ_SCENARIOS.length)
    for (const row of first) {
      expect(row.requests, row.action).toBeGreaterThan(0)
      expect(row.input, row.action).toBeGreaterThan(0)
    }
    const out = process.env.TOKEN_USAGE_REPORT
    if (out) writeFileSync(out, `${markdownTable(first)}\n`, 'utf8')
  })
})
