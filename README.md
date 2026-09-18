# AI Learning Platform

A **local-first AI-assisted learning platform** for undergraduate STEM courses.

Upload your course materials, let an AI provider you control turn them into structured knowledge, then learn through question-driven tutoring, adaptive quizzes, and a mistake book that explains *where* things went wrong — without ever calling you careless.

> **Status: v1.0** — Phases 1–5 shipped, productization review and security hardening complete.
> 443 tests passing · strict TypeScript · ESLint clean · production build verified.

---

## Quick start

### Windows — one click

Double-click **`Start.bat`** in the project folder.

It checks Node.js, installs dependencies on first run, starts the dev server, and opens the browser. Keep the window open while you work; press `Ctrl+C` to stop.

### Any platform — manual

```bash
npm install
npm run dev          # opens http://localhost:5173
```

On first launch the app seeds two default invite codes into IndexedDB. Use one of these on the `/invite` screen:

| Code |
| --- |
| `WELCOME-LEARN` |
| `STUDENT-2026` |

Invite codes are checked **locally only**. They are an access gate for a local-first app — not authentication. There is no UI for managing codes; to change them, edit `SEED_INVITE_CODES` in `src/shared/config/config.ts` and clear the app's IndexedDB to reseed.

### First-run setup inside the app

1. Enter an invite code on `/invite`.
2. Open **Settings → AI Settings**, choose a provider, paste your API key, click **Test connection**, then **Save changes**.
3. Create a project, upload course material, wait for processing, then open the **Analysis** tab and click **Analyze Course**.

---

## Table of contents

1. [Tech stack](#1-tech-stack)
2. [Project structure](#2-project-structure)
3. [Data model](#3-data-model)
4. [AI provider support](#4-ai-provider-support)
5. [Local data storage](#5-local-data-storage)
6. [File processing](#6-file-processing)
7. [AI teaching architecture](#7-ai-teaching-architecture)
8. [Quiz architecture](#8-quiz-architecture)
9. [Mistake architecture](#9-mistake-architecture)
10. [Security model](#10-security-model)
11. [Known limitations](#11-known-limitations)
12. [Scripts](#12-scripts)
13. [Configuring AI](#13-configuring-ai)
14. [Production build](#14-production-build)

---

## 1. Tech stack

| Layer | Choice | Why |
| --- | --- | --- |
| Build | **Vite 5** | Fast dev server, native ESM, asset URL handling for the PDF worker |
| UI | **React 18 + TypeScript 5 (strict)** | `noUnusedLocals`, `noUncheckedSideEffectImports`, no `any` in app code |
| Routing | **React Router 6** (data router) | Nested routes, `RequireAuth` gate |
| Styling | **Tailwind CSS 3** + CSS variables | Light/dark via a single `dark` class |
| Primitives | **Radix UI** (Dialog, Dropdown, Tabs, Toast, Tooltip, Slider, Select, Progress, Label) | Accessible headless components |
| Icons | **Lucide React** | — |
| State | **Zustand** | Small stores per feature, no boilerplate |
| Database | **Dexie 4** (IndexedDB) | Versioned schema, transactions, typed tables |
| File parsing | **pdfjs-dist**, **mammoth**, **jszip**, **tesseract.js** | PDF / DOCX / PPTX / OCR |
| Math | **mathjs** | Symbolic + numeric expression equivalence |
| Testing | **Vitest + Testing Library + fake-indexeddb** | Unit + integration |
| Lint/format | **ESLint 9 (flat) + Prettier** | `consistent-type-imports`, hooks rules |

No first-party backend. AI calls go directly from the browser to the endpoint you configure.

---

## 2. Project structure

```
src/
├── app/                    # Router, providers, layout shell, error boundary
│   ├── router.tsx
│   ├── providers.tsx       # ErrorBoundary + TooltipProvider + Bootstrap
│   ├── ErrorBoundary.tsx
│   ├── RequireAuth.tsx
│   └── layout/             # AppShell, Sidebar, Header
├── pages/                  # Route-level views (thin)
│   ├── InvitePage / DashboardPage / ProjectsPage
│   ├── ProjectDetailPage / DocumentDetailPage
│   ├── TutorPage / ChatHistoryPage
│   ├── QuizLandingPage / QuizPage / QuizResultPage / MasteryPage
│   ├── MistakeBookPage / SettingsPage
├── widgets/                # Composite UI blocks
│   ├── documents/          # DocumentList, DocumentUploadDialog, ProjectDocumentsTab
│   ├── documentAnalysis/   # CourseAnalysisPanel
│   ├── tutor/              # TutorPanel
│   ├── formulaPanel/       # FormulaPanel
│   ├── quiz/               # QuizConfigDialog, QuestionCard, AnswerInput
│   ├── mistakes/           # MistakeCard, MistakeAnalysisView, PracticeMoreMenu,
│   │                       # AddMistakeDialog, WeaknessPanel
│   ├── translation/        # SelectionTranslator
│   └── dataManagement/     # DataManagementPanel
├── features/               # Vertical features: store + hooks
│   ├── auth/ project/ documents/ settings/ theme/ toast/
├── entities/               # Domain types + Dexie repositories
│   ├── project/ user/ settings/ invite/
│   ├── document/ chunk/ processingJob/
│   ├── courseAnalysis/ tutorSession/ translation/
│   ├── question/ questionAttempt/ quiz/ knowledgeMastery/
│   └── mistake/
├── services/               # Business logic (composes entities + AI)
│   ├── aiService.ts              # provider wrapper, JSON parsing, retry
│   ├── aiServices.ts             # composition root (bundle factory)
│   ├── documentService.ts / processingService.ts
│   ├── documentAnalysisService.ts
│   ├── tutorService.ts / translationService.ts
│   ├── quizService.ts / answerEvaluationService.ts
│   ├── adaptiveDifficulty.ts / masteryService.ts
│   ├── mistakeService.ts / mistakeAnalysisService.ts
│   ├── weaknessService.ts / reviewSessionService.ts
│   ├── dataManagementService.ts
│   ├── sourceContext.ts
│   └── projectService.ts / userService.ts / settingsService.ts / inviteService.ts
├── infrastructure/         # Cross-cutting concerns
│   ├── db/                 # Dexie schema (v1–v5 migrations)
│   ├── ai/                 # Provider interface, OpenAI-compatible impl, prompts/
│   ├── files/              # pdfExtractor, docxExtractor, pptxExtractor, ocrExtractor, chunking
│   ├── math/               # expressionEvaluator (mathjs)
│   ├── opfs/               # OPFS wrapper (best-effort)
│   ├── logger/ crypto/ errors/
└── shared/
    ├── ui/                 # 18 primitives (Button, Dialog, Card, …)
    ├── lib/                # utils, format, aiErrors
    ├── config/             # app constants, seed invite codes
    └── styles/globals.css
```

**Layering rule:** UI → feature hooks → services → repositories → IndexedDB.
Components never touch IndexedDB directly.

---

## 3. Data model

Dexie database `ai-learning-platform`, schema version **5**.

| Table | Key | Indexes | Purpose |
| --- | --- | --- | --- |
| `projects` | `id` | `name, subject, createdAt, updatedAt` | Study projects |
| `user` | `id` (`'singleton'`) | — | Local profile |
| `settings` | `id` (`'singleton'`) | `updatedAt` | AI configuration |
| `inviteKeys` | `code` | `usedAt` | Local invite whitelist |
| `documents` | `id` | `projectId, type, status, name, uploadedAt, processedAt, [projectId+status], [projectId+type]` | Uploaded materials |
| `documentBlobs` | `id` | `projectId` | Raw file bytes (`ArrayBuffer` + mime) |
| `chunks` | `id` | `documentId, projectId, order, [documentId+order], [projectId+documentId]` | Extracted content blocks |
| `processingJobs` | `id` | `documentId, projectId, stage, updatedAt, [projectId+updatedAt]` | Pipeline progress |
| `courseAnalyses` | `id` | `projectId, status, finishedAt` | Analysis run state |
| `topics` | `id` | `projectId, order` | Course topics |
| `concepts` | `id` | `projectId, name` | Concepts |
| `formulas` | `id` | `projectId, name` | LaTeX formulas |
| `symbols` | `id` | `projectId, symbol` | Symbols with context |
| `examples` | `id` | `projectId` | Worked examples |
| `courseExercises` | `id` | `projectId, difficulty` | Extracted exercises |
| `prerequisites` | `id` | `projectId` | Prerequisite knowledge |
| `tutorSessions` | `id` | `projectId, status, updatedAt, [projectId+updatedAt]` | Tutor conversations |
| `translations` | `id` | `projectId, createdAt, [projectId+createdAt]` | Selection translations |
| `questions` | `id` | `projectId, topicId, knowledgePoint, type, difficulty, createdAt, [projectId+topicId], [projectId+knowledgePoint]` | Quiz questions |
| `questionAttempts` | `id` | `projectId, questionId, quizId, topicId, knowledgePoint, createdAt, [projectId+createdAt], [quizId+createdAt]` | Answer history |
| `quizzes` | `id` | `projectId, status, startedAt, [projectId+startedAt]` | Quiz sessions |
| `knowledgeMastery` | `id` | `projectId, knowledgePoint, [projectId+knowledgePoint]` | Mastery estimates |
| `mistakes` | `id` | `projectId, questionId, quizId, knowledgePoint, mistakeType, status, source, createdAt, [projectId+status], [projectId+knowledgePoint]` | Mistake book |

Core types (abbreviated):

```ts
Project        { id, name, subject, description?, createdAt, updatedAt }

Document       { id, projectId, type: 'pdf'|'docx'|'pptx'|'image'|'text',
                 name, sizeBytes, mimeType?, hasBlob, status, errorMessage?,
                 warnings[], metadata, textLength?, chunkCount?, uploadedAt, processedAt? }

Chunk          { id, documentId, projectId, pageNumber?, section?, contentType,
                 text, sourceReference, order, createdAt }

Topic          { id, projectId, name, description, order, sourceRefs[], createdAt }
Concept        { id, projectId, name, definition, explanation?, topicIds[], sourceRefs[] }
Formula        { id, projectId, name, latex, description, variables[], topicIds[], sourceRefs[] }
CourseSymbol   { id, projectId, symbol, meaning, context, unit?, topicIds[], sourceRefs[] }

TutorSession   { id, projectId, topicId?, topicName, language, messages[], turns[],
                 pendingQuestion?, streakCorrect, streakWrong, currentDifficulty,
                 hintsRevealed, mastery, status, startedAt, updatedAt }

Question       { id, projectId, topicId?, knowledgePoint, type, difficulty, prompt,
                 options?, correctAnswer, solution?, hints[], sourceRefs[], promptVersion, createdAt }

QuestionAttempt{ id, projectId, questionId, quizId?, topicId?, knowledgePoint,
                 questionType, difficulty, userAnswer, evaluation, durationMs?, hintsUsed, createdAt }

QuestionEvaluation { isCorrect: boolean|null, method, confidence, expected?,
                     normalizedUser?, normalizedExpected?, explanation?, note? }

Quiz           { id, projectId, title, config, questionIds[], status, difficultyPlan[],
                 score?, startedAt, finishedAt?, promptVersion }

KnowledgeMastery { id, projectId, knowledgePoint, topicId?, mastery, attempts,
                   correct, observations[], lastUpdated }

Mistake        { id, projectId, questionId?, quizId?, topicId?, knowledgePoint,
                 difficulty, questionType, question, options?, studentAnswer,
                 correctAnswer, solution?, mistakeType, analysis?, analysisStatus,
                 status: 'active'|'understood'|'archived', source: 'auto'|'manual',
                 attemptIds[], attemptCount, createdAt, updatedAt, resolvedAt?, archivedAt? }
```

---

## 4. AI provider support

```
AITutor · DocumentAnalysis · Translation · Quiz · MistakeAnalysis
                          ↓
                      AIService          JSON extraction · retry · redaction
                          ↓
                      AIProvider         interface
                          ↓
              OpenAICompatibleProvider
                          ↓
   OpenAI · Qwen · DeepSeek · MiniMax · MiMo · Custom
```

One implementation serves all six presets. Presets differ only in `baseURL`, `defaultModel`, and whether the provider supports `response_format: json_object`.

| Preset | Default base URL | Default model | JSON mode |
| --- | --- | --- | --- |
| OpenAI | `https://api.openai.com/v1` | `gpt-4o-mini` | ✅ |
| Qwen | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` | ✅ |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` | — |
| MiniMax | `https://api.MiniMax.com/v1` | `MiniMax-Text-01` | ✅ |
| MiMo | configurable | `mimo-7b` | ✅ |
| Custom | your URL | your model | ✅ |

Typed errors: `MISSING_API_KEY`, `MISSING_BASE_URL`, `MISSING_MODEL`, `AUTH_FAILED`, `RATE_LIMITED`, `TIMEOUT`, `PROVIDER_UNAVAILABLE`, `INVALID_RESPONSE`, `INVALID_JSON`, `ABORTED`.

Every error is mapped to plain-language guidance by `shared/lib/aiErrors.ts` — the UI never shows "Something went wrong".

---

## 5. Local data storage

- **Structured data** → IndexedDB via Dexie (23 tables, versioned migrations v1→v5).
- **Raw files** → `documentBlobs` as `ArrayBuffer`, with best-effort mirroring to **OPFS** when the browser supports it.
- **API key** → IndexedDB only. Never logged, never in a URL, never in analytics or error reports.
- **Nothing is uploaded to a first-party server.** There is no first-party server.

Export: Settings → Data → **Export data** produces a single JSON file containing every table plus document bytes.

---

## 6. File processing

```
Upload
  → validate (size ≤ 100 MB, MIME + extension)
  → store bytes (IndexedDB + OPFS mirror)
  → extract
      PDF   → pdfjs-dist (per-page text, heading heuristic)
      DOCX  → mammoth → HTML → structured blocks
      PPTX  → jszip → slide XML (title, body, notes, tables)
      Image → tesseract.js OCR (confidence + math-symbol warning)
      Text  → direct
  → chunk (≈800 chars, sentence-aware, page/section anchored)
  → build sourceReference  ("Calculus.pdf · Page 12 · § Derivatives")
  → status: uploading → processing → ready | failed
```

Failures never lose the original file. Each document keeps `warnings[]` and `errorMessage`.

---

## 7. AI teaching architecture

**Document analysis** — one JSON call extracts topics, concepts, formulas, symbols, examples, exercises, and prerequisites. Symbols keep a `context` field so `μ` can mean *coefficient of friction* in one topic and *mean* in another.

**Tutor loop** — question-driven, not lecture-driven:

```
Choose topic → AI introduces (short) → AI asks → student answers
  → AI evaluates → feedback + grounded explanation → hint (progressive)
  → next question (adaptive difficulty)
```

**Source grounding** — the AI receives only the relevant chunks. Answers that go beyond the sources are labelled **Supplementary explanation**.

**Language** — detected from the material (`zh` / `en` / `mixed`); the tutor follows it and the user can switch (English / 中文 / Bilingual).

**Prompts** — every prompt lives in `infrastructure/ai/prompts/<family>/vN.ts`, exports `VERSION`, `buildSystemPrompt()`, `buildUserPrompt(input)`, and is registered in `prompts/index.ts` with `PROMPT_VERSIONS`.

**Prompt-injection defence** — all document content is wrapped with explicit `BEGIN/END (UNTRUSTED CONTENT)` delimiters, and every relevant system prompt carries a `securityFooter()` instructing the model to treat documents as data and ignore embedded instructions.

---

## 8. Quiz architecture

Five question types with deterministic grading:

| Type | Grading |
| --- | --- |
| Multiple choice | option id or label, case-insensitive |
| True / False | `true/false`, `t/f`, `yes/no`, `1/0` |
| Short answer | exact, `\|`-separated alternatives, or high keyword overlap (low confidence) |
| Numeric | 1% relative tolerance; parses `3/4`, `1,000`, `2e-3` |
| Math expression | mathjs symbolic + numeric equivalence |

**Math equivalence** — `x^2 / 2` ≡ `0.5x²`. The evaluator normalises Unicode, parses with mathjs, tries symbolic simplification, then numeric sampling at 16 random points, treats `+ C` as arbitrary, and handles equations. When it cannot decide it returns `null`, the UI shows **"Unable to verify automatically"**, and the answer is excluded from the score rather than guessed.

**Adaptive difficulty** — requires ≥ 2 graded answers before moving. Combines recent accuracy, difficulty-weighted accuracy, knowledge-point mastery, and streaks:

```
composite = 0.45·recentAccuracy + 0.25·weightedAccuracy
          + 0.20·mastery + 0.10·streakSignal
```

**Knowledge mastery** — a recency- and difficulty-weighted estimate, always framed as an estimate.

---

## 9. Mistake architecture

Wrong answers enter the book automatically. Repeat mistakes on the same question merge into one entry with an attempt count.

**AI analysis** returns where the working diverges, the first key error, why it fails, the correct approach, a **possible cause**, one of eight neutral categories, knowledge points to review, a similar example, and an invitation to continue.

Categories: Conceptual · Formula · Calculation · Sign · Unit · Misreading · Incomplete reasoning · Unknown. **There is no "careless" category**, and the prompt + a normaliser + the UI label all enforce that causes are stated as possibilities.

**Weakness detection**:

```
weaknessScore = 0.45·mistakeWeight + 0.20·activeWeight
              + 0.15·recencyWeight + 0.20·(1 − mastery)
```

Rendered as **"Areas that may need review"** with neutral reasons.

**Review sessions** — "Review my recent mistakes" builds an adaptive quiz focused on the weakest knowledge points. Per-mistake practice offers Same concept · Similar · Easier · Harder · Weakness training.

---

## 10. Security model

| Concern | Measure |
| --- | --- |
| API key at rest | **AES-GCM encrypted** with a non-extractable device key (`cryptoKeys` table). Plaintext never reaches IndexedDB. |
| API key logging | Recursive redactor scrubs `apikey\|api_key\|password\|secret\|token\|authorization\|bearer` at any nesting depth; circular refs become `[CIRCULAR]` |
| API key in URLs | Sent only in the `Authorization` header; never in a URL or query string (asserted by test) |
| API key in analytics / error reports | No analytics, no remote error reporting |
| API key in Git | `.gitignore` covers `.env*`; no key is ever written to a source file |
| Course material upload | Never uploaded to a first-party server; there is none |
| What leaves the device | Only the chunks / selection / answer needed for the current AI task, sent to the endpoint you configured |
| Prompt injection | Document content, student answers, and selections are wrapped in explicit `UNTRUSTED CONTENT` delimiters; every affected system prompt carries a security footer |
| AI output trust | Every structured response is parsed, validated, and sanitised before it reaches the database |
| XSS | No `dangerouslySetInnerHTML`; Markdown/LaTeX rendered as text |
| Project isolation | Every repository query is scoped by `projectId`; unknown project ids fail as `NotFoundError` |
| Invite codes | Local admission gate, explicitly not a security boundary |

### Key management and its boundary

The device key is a **non-extractable** AES-GCM `CryptoKey` generated per origin and
stored in IndexedDB. Its raw bytes never exist as a JavaScript value, so they cannot
be logged, serialised, placed in a URL, or copied out of the browser.

**Protects against:** plaintext secrets in IndexedDB, a disk image, a browser profile
backup, or an export; secrets leaking into logs, errors, or telemetry; another
application reading the origin's storage.

**Does not protect against:** script executing on this same origin (XSS or a
compromised dependency) — such script can call `crypto.subtle.decrypt`. That is an
inherent limit of a purely client-side app. Stronger protection requires an
independent user secret (a passphrase-derived key), which is **not implemented**.

---

## 11. Known limitations

1. **No independent user secret.** The device key protects the API key at rest but is
   usable by any script on this origin. A passphrase-derived key would be a real
   upgrade; it is deliberately not implemented (it would add an unlock step and make
   a forgotten passphrase unrecoverable).
2. **Prompt injection is reduced, not eliminated.** Content is isolated in delimiters
   and the model is instructed to treat it as data, but no client-side prompt can
   guarantee model behaviour.
3. **Short-answer grading is conservative** — a paraphrase with no keyword overlap returns "unverified" rather than "wrong". Optional AI fallback is off by default to avoid extra cost.
4. **Equation equivalence is structural**, not solved: `2x = 4` vs `x = 2` returns "unverified" by design — the three-state verdict (`correct` / `incorrect` / `unverified`) is intentional and will not be replaced by an unreliable solver.
5. **Numeric tolerance is fixed at 1%**, not per-question.
6. **PDF tables are not extracted** — pdfjs text content has no table structure.
7. **OCR is slow on first use** (multi-MB WASM) and struggles with handwritten math.
8. **No vector retrieval yet.** `sourceContext` picks chunks by document order with a keyword preference. Phase 6 replaces this with a real index.
9. **Formula rendering is monospace**, not KaTeX (planned).
10. **Bundle size**: `vendor-math` is 665 KB (192 KB gzip) and `vendor-pdf` 436 KB (130 KB gzip). Split into separate chunks for caching, but not lazy-loaded.

---

## 12. Scripts

| Command | Purpose |
| --- | --- |
| `Start.bat` | Windows one-click launcher: checks Node, installs deps if needed, runs the dev server, opens the browser |
| `npm run dev` | Vite dev server on :5173 |
| `npm run build` | `tsc -b && vite build` → `dist/` |
| `npm run preview` | Serve the production build |
| `npm run typecheck` | `tsc -b --noEmit` |
| `npm run lint` | ESLint over `.` |
| `npm run format` | Prettier write |
| `npm test` | Vitest run |
| `npm run test:watch` | Vitest watch |
| `npm run test:coverage` | Vitest with coverage |

---

## 13. Configuring AI

1. Open **Settings** (sidebar) → **AI Settings**.
2. Pick a **Provider** preset (or Custom).
3. Enter **API Base URL**, **API Key**, **Model**.
4. Adjust **Temperature** and **Max Tokens** if desired.
5. Click **Test connection** — you get latency, model, or a plain-language error.
6. Click **Save changes**.

Then: create a project → upload material → wait for processing → **Analysis** tab → **Analyze Course** → open **Tutor** or **Quiz**.

---

## 14. Production build

```bash
npm run build      # type-check + bundle
npm run preview    # verify locally
```

Output in `dist/` — static assets, deployable to any static host. Set a SPA fallback so all routes serve `index.html`.

Chunk layout:

```
index.html                     0.9 kB
assets/index-*.css            28 kB   (6 kB gzip)
assets/index-*.js            894 kB   (248 kB gzip)   app shell
assets/vendor-react-*.js     207 kB   (67 kB gzip)
assets/vendor-math-*.js      665 kB   (192 kB gzip)   mathjs
assets/vendor-pdf-*.js       436 kB   (130 kB gzip)   pdfjs
assets/vendor-db-*.js         96 kB   (32 kB gzip)    dexie
assets/pdf.worker.min-*.mjs 1265 kB                  pdfjs worker
```

---

## Testing

304 tests across 32 files:

| Area | Files |
| --- | --- |
| Foundation | `errors`, `utils`, `format`, `projectService`, `inviteService`, `settingsService` |
| UI | `dialogs`, `progressiveList`, `useDebouncedValue`, `mistakeBookSearch` |
| Content | `pdfExtractor`, `docxExtractor`, `pptxExtractor`, `ocrExtractor`, `chunking`, `documents` |
| AI | `errorsAndParse`, `openaiCompatible`, `aiService`, `failureModes`, `prompts`, `services`, `friendlyErrors`, `promptInjection` |
| Quiz | `mathEvaluator`, `answerEvaluation`, `adaptiveDifficulty`, `scoring`, `masteryService`, `quizService` |
| Mistakes | `mistakeService`, `mistakeAnalysis`, `weakness`, `reviewSession`, `dataManagement` |
| End-to-end | `integration/userFlow` |

---

## Roadmap

| Phase | Theme | Status |
| --- | --- | --- |
| 1 | Foundation | ✅ |
| 2 | Local-first Content Library | ✅ |
| 3 | AI Provider · Course Analysis · Tutor · Translation | ✅ |
| 4 | Quiz · Adaptive Difficulty · Knowledge Mastery | ✅ |
| 5 | AI Mistake Book · Weakness Detection · Review Sessions | ✅ |
| 6 | Knowledge index + retrieval (RAG) | ⏳ |
| 7 | KaTeX rendering + formula polish | ⏳ |
| 8 | Dashboard polish | ⏳ |
| 9 | PWA, offline shell, import/export UI | ⏳ |

---

## Phase tags

- `v0.1-init` — Phase 1
- `v0.2-content-library` — Phase 2
- `v0.3-ai-tutor` — Phase 3
- `v0.4-quiz` — Phase 4
- `v0.5-mistakes` — Phase 5

```bash
git checkout v0.4-quiz     # inspect a phase
git checkout master        # back to latest
```
