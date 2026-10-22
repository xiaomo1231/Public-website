// Prints the offline token-usage table (AGENTS §9 2i, docs/token-usage.md):
// runs `tests/tokenUsage.test.ts`, which records the requests each user action
// sends with fake providers (no network, no API key) and estimates their tokens.
//
//   node scripts/token-usage.mjs [output.md]
//
// Without an argument the table is written to .cache/token-usage.md and printed.

import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(process.argv[2] ?? join(ROOT, '.cache', 'token-usage.md'))
mkdirSync(dirname(out), { recursive: true })

const vitest = join(ROOT, 'node_modules', 'vitest', 'vitest.mjs')
const result = spawnSync(process.execPath, [vitest, 'run', 'tests/tokenUsage.test.ts'], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, TOKEN_USAGE_REPORT: out },
})
if (result.status !== 0) process.exit(result.status ?? 1)
process.stdout.write(`\n${readFileSync(out, 'utf8')}`)
