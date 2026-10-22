/**
 * Cost bench: runs one homework through the app's real prompts against a
 * real OpenAI-compatible API and reports cache-hit / cache-miss / output
 * tokens and cost for every request.
 *
 *   node tools/cost-bench/server.mjs        → http://127.0.0.1:5199
 *
 * The API key only lives in the browser tab's memory and in the request to
 * this local server; it is never written to disk or logged. Results (without
 * the key) are saved to tools/cost-bench/results/.
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import { createServer as createVite } from 'vite'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../..')
const RESULTS = path.join(HERE, 'results')
const PORT = Number(process.env.PORT) || 5199

const vite = await createVite({
  root: ROOT,
  configFile: path.join(ROOT, 'vite.config.ts'),
  server: { middlewareMode: true, hmr: false },
  appType: 'custom',
  logLevel: 'error',
})
const scenario = await vite.ssrLoadModule('/tools/cost-bench/scenario.ts')

const require = createRequire(path.join(ROOT, 'package.json'))
const pdfjs = await import(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href)

async function pdfPages(bytes) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), useSystemFonts: true }).promise
  const pages = []
  for (let i = 1; i <= doc.numPages; i++) {
    const content = await (await doc.getPage(i)).getTextContent()
    pages.push(content.items.map((item) => item.str + (item.hasEOL ? '\n' : '')).join(''))
  }
  return pages
}

// --- One API request ---------------------------------------------------------

function readUsage(usage = {}) {
  const prompt = usage.prompt_tokens ?? 0
  const hit = usage.prompt_cache_hit_tokens ?? usage.prompt_tokens_details?.cached_tokens ?? 0
  const miss = usage.prompt_cache_miss_tokens ?? Math.max(0, prompt - hit)
  const out = usage.completion_tokens ?? 0
  const reasoning = usage.completion_tokens_details?.reasoning_tokens ?? 0
  return { hit, miss, out, reasoning }
}

/**
 * DeepSeek's peak hours: Monday–Friday 9:00–12:00 and 14:00–18:00 Beijing
 * time (Chinese public holidays are off-peak, which this does not know).
 */
export function isPeak(at) {
  const beijing = new Date(at + 8 * 3600_000)
  const day = beijing.getUTCDay()
  const minutes = beijing.getUTCHours() * 60 + beijing.getUTCMinutes()
  if (day === 0 || day === 6) return false
  return (minutes >= 540 && minutes < 720) || (minutes >= 840 && minutes < 1080)
}

async function chat(cfg, messages, { json, maxTokens }, signal) {
  const started = Date.now()
  const body = {
    model: cfg.model,
    messages,
    max_tokens: maxTokens,
    ...(json && cfg.jsonMode ? { response_format: { type: 'json_object' } } : {}),
    ...cfg.extraBody,
  }
  const res = await fetch(cfg.baseUrl.replace(/\/+$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
    body: JSON.stringify(body),
    signal: AbortSignal.any([signal, AbortSignal.timeout(cfg.timeoutMs)]),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 400)}`)
  const data = JSON.parse(text)
  const choice = data.choices?.[0] ?? {}
  return {
    content: choice.message?.content ?? '',
    finish: choice.finish_reason ?? '',
    usage: readUsage(data.usage),
    rawUsage: data.usage ?? null,
    startedAt: started,
    ms: Date.now() - started,
  }
}

function parseJSON(text) {
  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/, '')
  try {
    return JSON.parse(cleaned)
  } catch {
    const start = cleaned.indexOf('{')
    const end = cleaned.lastIndexOf('}')
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1))
      } catch {}
    }
    return null
  }
}

async function pool(items, limit, worker) {
  const results = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++
        results[index] = await worker(items[index], index)
      }
    }),
  )
  return results
}

// --- The homework flow --------------------------------------------------------

const ASK_QUESTIONS = [
  '这一步为什么要这样做？',
  '这里的数字是怎么得到的？能再写细一点吗？',
  '有没有别的方法可以做这一步？',
  '这个结论怎么检查对不对？',
  '这里用到的定义是什么意思？',
]

async function runFlow(cfg, doc, emit, signal) {
  const subject = cfg.subject
  const records = []
  const peakOf = (at) => (cfg.peakMode === 'auto' ? isPeak(at) : cfg.peakMode === 'on')
  const priceOf = (u, peak) =>
    ((u.hit * cfg.price.hit + u.miss * cfg.price.miss + u.out * cfg.price.out) / 1e6) *
    (peak ? 2 : 1)

  async function call(step, label, messages, opts) {
    if (signal.aborted) throw new Error('已停止')
    const promptChars = messages.reduce((sum, m) => sum + m.content.length, 0)
    try {
      const result = await chat(cfg, messages, opts, signal)
      const peak = peakOf(result.startedAt)
      const cost = priceOf(result.usage, peak)
      const record = {
        step,
        label,
        ...result.usage,
        peak,
        startedAt: new Date(result.startedAt).toISOString(),
        rawUsage: result.rawUsage,
        cost,
        ms: result.ms,
        finish: result.finish,
        promptChars,
        outputChars: result.content.length,
        output: result.content,
        ok: true,
      }
      records.push(record)
      emit({ type: 'request', record: { ...record, output: result.content.slice(0, 4000) } })
      return result.content
    } catch (err) {
      const record = { step, label, ok: false, error: String(err.message ?? err), promptChars }
      records.push(record)
      emit({ type: 'request', record })
      if (signal.aborted) throw err
      return null
    }
  }

  // ① Recognise questions.
  const recognised = await call('① 识别题目', doc.name, scenario.recognize(doc.name, doc.pages), {
    json: true,
    maxTokens: cfg.maxTokens,
  })
  const parsed = recognised ? parseJSON(recognised) : null
  const questions = (parsed?.questions ?? [])
    .filter((q) => q && typeof q.prompt === 'string' && q.prompt.trim())
    .map((q, i) => ({ label: String(q.number ?? i + 1).trim() || String(i + 1), prompt: q.prompt }))
  if (questions.length === 0)
    throw new Error('没有识别出题目，后面的步骤无法继续（看上面第一条请求的输出）')
  emit({ type: 'log', text: `识别出 ${questions.length} 道题` })

  // ② Walkthrough: one request per question, two at a time, then the frame.
  const sections = await pool(questions, cfg.concurrency, async (q) => {
    const out = await call(
      '② 完整讲解',
      `第 ${q.label} 题`,
      scenario.walkthroughQuestion(subject, q.label, q.prompt),
      { json: true, maxTokens: cfg.walkthroughMaxTokens },
    )
    const section = out ? scenario.normalizeQuestionSection(parseJSON(out)) : null
    return section?.status === 'ready' ? { ...q, ...section } : { ...q, conclusion: '', body: '' }
  })
  const ready = sections.filter((s) => s.body)
  if (ready.length > 0) {
    await call(
      '② 完整讲解',
      '开头与小结',
      scenario.walkthroughFrame(
        subject,
        doc.name,
        ready.map((s) => ({
          label: s.label,
          question: s.prompt,
          conclusion: s.conclusion,
          body: s.body,
        })),
      ),
      { json: true, maxTokens: cfg.maxTokens },
    )
  }

  // ③ Hints for the first few questions.
  await pool(questions.slice(0, cfg.hintCount), cfg.concurrency, (q) =>
    call('③ 做题提示', `第 ${q.label} 题`, scenario.hints(subject, q.prompt), {
      json: true,
      maxTokens: cfg.maxTokens,
    }),
  )

  // ④ Check answers: the student's answer is the walkthrough's conclusion,
  //    the reference is the walkthrough body (an unverified AI solution).
  await pool(ready.slice(0, cfg.checkCount), cfg.concurrency, (s) =>
    call(
      '④ 检查答案',
      `第 ${s.label} 题`,
      scenario.answerCheck(subject, s.prompt, s.conclusion, s.body),
      { json: true, maxTokens: cfg.maxTokens },
    ),
  )

  // ⑤ Selection questions inside the walkthrough; consecutive asks on the
  //    same section are follow-ups with history, like the floating window.
  const passages = ready.flatMap((s) =>
    s.body
      .split(/\n{2,}/)
      .filter((p) => p.trim().length > 60)
      .map((p) => ({ section: s, text: p.trim() })),
  )
  const history = new Map()
  for (let i = 0; i < Math.min(cfg.askCount, passages.length > 0 ? cfg.askCount : 0); i++) {
    const passage = passages[Math.floor((i * passages.length) / cfg.askCount) % passages.length]
    const key = passage.section.label
    const turns = history.get(key) ?? []
    const index = passage.section.body.indexOf(passage.text)
    const question = ASK_QUESTIONS[i % ASK_QUESTIONS.length]
    const answer = await call(
      '⑤ 划词提问',
      `第 ${key} 题 · 第 ${turns.length + 1} 轮`,
      scenario.ask(subject, {
        sectionHeading: `第 ${key} 题`,
        selectedText: passage.text.slice(0, 600),
        surroundingContext: passage.section.body.slice(Math.max(0, index - 700), index + 800),
        question,
        history: turns,
      }),
      { json: false, maxTokens: cfg.maxTokens },
    )
    if (answer) history.set(key, [...turns, { question, answer }])
  }

  return records
}

function summarise(records, cfg) {
  const steps = {}
  const total = {
    requests: 0,
    failed: 0,
    hit: 0,
    miss: 0,
    out: 0,
    reasoning: 0,
    cost: 0,
    ms: 0,
    peakRequests: 0,
  }
  for (const r of records) {
    if (r.ok && r.peak) total.peakRequests += 1
    const s = (steps[r.step] ??= {
      requests: 0,
      failed: 0,
      hit: 0,
      miss: 0,
      out: 0,
      reasoning: 0,
      cost: 0,
    })
    for (const t of [s, total]) {
      t.requests += 1
      if (!r.ok) {
        t.failed += 1
        continue
      }
      t.hit += r.hit
      t.miss += r.miss
      t.out += r.out
      t.reasoning += r.reasoning
      t.cost += r.cost
    }
    if (r.ok) total.ms += r.ms
  }
  return { steps, total, points: Math.round(total.cost / cfg.pointValue) }
}

// --- HTTP ---------------------------------------------------------------------

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type })
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body))
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
      return send(
        res,
        200,
        fs.readFileSync(path.join(HERE, 'index.html')),
        'text/html; charset=utf-8',
      )
    }
    if (req.method === 'GET' && req.url === '/api/results') {
      if (!fs.existsSync(RESULTS)) return send(res, 200, [])
      const list = fs
        .readdirSync(RESULTS)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .reverse()
        .map((f) => {
          const r = JSON.parse(fs.readFileSync(path.join(RESULTS, f), 'utf8'))
          return {
            file: f,
            at: r.at,
            model: r.config.model,
            thinking: r.config.extraBody?.thinking?.type === 'disabled' ? false : undefined,
            peakMode: r.config.peakMode ?? (r.config.peak ? 'on' : 'off'),
            doc: r.doc.name,
            summary: r.summary,
          }
        })
      return send(res, 200, list)
    }
    if (req.method === 'POST' && req.url === '/api/run') {
      const input = await readBody(req)
      const cfg = {
        baseUrl: String(input.baseUrl || '').trim(),
        apiKey: String(input.apiKey || '').trim(),
        model: String(input.model || '').trim(),
        jsonMode: input.jsonMode !== false,
        extraBody: input.extraBody && typeof input.extraBody === 'object' ? input.extraBody : {},
        price: {
          hit: +input.price?.hit || 0,
          miss: +input.price?.miss || 0,
          out: +input.price?.out || 0,
        },
        peakMode: ['auto', 'on', 'off'].includes(input.peakMode) ? input.peakMode : 'off',
        subject: input.subject || 'linear_algebra',
        concurrency: Math.max(1, Math.min(4, +input.concurrency || 2)),
        maxTokens: +input.maxTokens || 4096,
        walkthroughMaxTokens: +input.walkthroughMaxTokens || 8192,
        hintCount: Math.max(0, +input.hintCount || 0),
        checkCount: Math.max(0, +input.checkCount || 0),
        askCount: Math.max(0, +input.askCount || 0),
        pointValue: +input.pointValue || 0.005,
        timeoutMs: 300_000,
      }
      if (!cfg.baseUrl || !cfg.apiKey || !cfg.model)
        return send(res, 400, { error: '请填写 Base URL、API Key 和模型名' })

      let pages
      let name
      if (input.fileBase64) {
        pages = await pdfPages(Buffer.from(input.fileBase64, 'base64'))
        name = input.fileName || 'upload.pdf'
      } else {
        const file = String(input.filePath || '').trim()
        if (!fs.existsSync(file)) return send(res, 400, { error: `找不到文件：${file}` })
        pages = file.toLowerCase().endsWith('.pdf')
          ? await pdfPages(fs.readFileSync(file))
          : [fs.readFileSync(file, 'utf8')]
        name = path.basename(file)
      }

      res.writeHead(200, {
        'Content-Type': 'application/x-ndjson; charset=utf-8',
        'Cache-Control': 'no-cache',
      })
      const emit = (event) => res.write(JSON.stringify(event) + '\n')
      const controller = new AbortController()
      res.on('close', () => controller.abort())
      emit({
        type: 'log',
        text: `读取 ${name}：${pages.length} 页，约 ${pages.join('').length} 字符；作业讲解提示词 ${scenario.WALKTHROUGH_VERSION}`,
      })

      let records = []
      let error = null
      try {
        records = await runFlow(cfg, { name, pages }, emit, controller.signal)
      } catch (err) {
        error = String(err.message ?? err)
      }
      const summary = summarise(records, cfg)
      const { apiKey: _omit, ...savedConfig } = cfg
      const at = new Date().toISOString()
      fs.mkdirSync(RESULTS, { recursive: true })
      const file = `${at.replace(/[:.]/g, '-')}-${cfg.model.replace(/[^\w.-]+/g, '_')}.json`
      fs.writeFileSync(
        path.join(RESULTS, file),
        JSON.stringify(
          { at, config: savedConfig, doc: { name, pages: pages.length }, summary, error, records },
          null,
          2,
        ),
      )
      if (!res.writableEnded && !res.destroyed) {
        emit({ type: 'done', summary, error, file })
        res.end()
      }
      return
    }
    send(res, 404, { error: 'not found' })
  } catch (err) {
    if (!res.headersSent) send(res, 500, { error: String(err.message ?? err) })
    else res.end()
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`成本测试台：http://127.0.0.1:${PORT}`)
})
