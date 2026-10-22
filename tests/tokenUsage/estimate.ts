/**
 * Offline token estimates for the token-usage harness (`tests/tokenUsage.test.ts`).
 *
 * No tokenizer is bundled, so prompt tokens are estimated per character class,
 * close to what BPE tokenizers of the OpenAI-compatible providers give (±20 %):
 *  - CJK ideographs and full-width punctuation: ~0.75 token each
 *  - Latin letters: ~4 per token (English words)
 *  - digits: ~2.5 per token
 *  - ASCII punctuation / LaTeX symbols (`\ { } ^ _ $ |` …): ~0.6 token each
 *  - other non-ASCII (Greek, arrows, accents …): ~1 token each
 *  - a newline ~0.3 token; other whitespace is absorbed into the next token.
 * Good enough to compare request shapes before / after a change; not a bill.
 */

const CJK = /[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]/

export function estimateTokens(text: string): number {
  let cjk = 0
  let letters = 0
  let digits = 0
  let symbols = 0
  let other = 0
  let newlines = 0
  for (const ch of text) {
    if (ch === '\n') newlines++
    else if (ch === ' ' || ch === '\t' || ch === '\r') continue
    else if ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z')) letters++
    else if (ch >= '0' && ch <= '9') digits++
    else if (ch.charCodeAt(0) < 128) symbols++
    else if (CJK.test(ch)) cjk++
    else other++
  }
  return Math.ceil(cjk * 0.75 + letters / 4 + digits / 2.5 + symbols * 0.6 + other + newlines * 0.3)
}

export interface RecordedMessage {
  role: string
  content: string
}

export interface RecordedRequest {
  /** Request kind, e.g. `quiz.batch`. */
  kind: string
  messages: RecordedMessage[]
  /** `max_tokens` sent (the configured cap when the call passed none). */
  maxTokens: number
}

/** What a request looks like to a provider: the messages in order. */
export function serialize(messages: RecordedMessage[]): string {
  return messages.map((m) => `<${m.role}>\n${m.content}`).join('\n')
}

/** Automatic prefix caches (DeepSeek, OpenAI) store prefixes in 64-token units. */
export const CACHE_UNIT = 64

function commonPrefix(a: string, b: string): number {
  const max = Math.min(a.length, b.length)
  let i = 0
  while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) i++
  return i
}

export interface RequestCost {
  input: number
  /** Input tokens an automatic prefix cache could serve (shared with an earlier request of the action). */
  cached: number
  maxTokens: number
}

/**
 * Per request: estimated input tokens and how many of them repeat the longest
 * prefix of an earlier request in the same action (a warm provider cache).
 */
export function costOf(requests: RecordedRequest[]): RequestCost[] {
  const seen: string[] = []
  return requests.map((request) => {
    const text = serialize(request.messages)
    const input = estimateTokens(text)
    let prefix = 0
    for (const earlier of seen) prefix = Math.max(prefix, commonPrefix(earlier, text))
    seen.push(text)
    const shared = estimateTokens(text.slice(0, prefix))
    const cached = Math.min(input, Math.floor(shared / CACHE_UNIT) * CACHE_UNIT)
    return { input, cached, maxTokens: request.maxTokens }
  })
}

export interface ActionSummary {
  action: string
  requests: number
  input: number
  cached: number
  /** Input billed at the full rate, plus cached input at a tenth (typical cache discount). */
  effective: number
  maxTokens: number
}

export function summarize(action: string, requests: RecordedRequest[]): ActionSummary {
  const costs = costOf(requests)
  const input = costs.reduce((sum, c) => sum + c.input, 0)
  const cached = costs.reduce((sum, c) => sum + c.cached, 0)
  return {
    action,
    requests: requests.length,
    input,
    cached,
    effective: Math.round(input - cached + cached / 10),
    maxTokens: costs.reduce((sum, c) => sum + c.maxTokens, 0),
  }
}

export function markdownTable(rows: ActionSummary[]): string {
  const header =
    '| 操作 | 请求数 | 输入 token | 其中可命中前缀缓存 | 折算输入（缓存按 1/10） | max_tokens 合计 |\n| --- | ---: | ---: | ---: | ---: | ---: |'
  const lines = rows.map(
    (r) =>
      `| ${r.action} | ${r.requests} | ${r.input} | ${r.cached} | ${r.effective} | ${r.maxTokens} |`,
  )
  return [header, ...lines].join('\n')
}
