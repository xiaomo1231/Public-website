# AGENTS.md — 项目记忆

面向 opencode 的项目上下文。开始任何任务前先读本文件，再读 `README.md` 与 `docs/architecture.md`。

---

## 1. 项目是什么

**Local-first AI Learning Platform**，面向理工科本科生（微积分 / 线代 / 物理 / 化学 / CS / 统计）。

纯前端 PWA，**无第一方后端**。用户上传课程资料（PDF / DOCX / PPTX / 图片 / 文本），由**用户自己配置的 AI** 把资料转成结构化知识，再通过**提问驱动式导师**、自适应测验和错题本来学习。

核心闭环：

```text
课程资料 → AI 理解 → 知识结构 → 题目驱动教学 → 学生作答
→ 自适应难度 → Quiz → 错题本 → 错误分析 → 针对性再练
```

**这不是"AI PDF 总结工具"。** 教学以题目为主要载体，而不是长篇总结。

当前版本：**V0.2.4（0.2.4）**。

---

## 2. 不可违反的工程原则

1. 不一次性生成整个项目；分阶段开发，每阶段跑测试。
2. 不为赶进度破坏既有架构；**不重复实现已有功能**（先搜代码）。
3. 优先清晰的类型系统；所有 AI Provider 走统一接口。
4. 所有 Project 数据必须隔离（`projectId` 贯穿全表）。
5. 所有文件处理必须有错误处理；单个文件失败不影响批次。
6. AI 失败必须有明确、可操作的错误提示（禁止"出错了"）。
7. **API Key 绝不写死源码、绝不提交 Git、绝不进日志/URL/导出。**
8. 不默认上传用户文件到第三方；只发当前任务所需文本。
9. 所有 AI 生成内容必须保存来源与关联项目。
10. 重大架构修改前先解释原因；需求歧义时优先简单、可维护、Local-first。

### 产品语气约束（硬性）

- 错题分析**永不断言"粗心"**。字段叫「可能的错误原因」，措辞以 "This may indicate…" 开头。
- 薄弱点表述为「可能需要复习的部分」，绝不写「你就是不擅长 X」。
- 掌握度是**基于练习记录的估计值**，不是对能力的绝对测量。

---

## 3. 架构总览

### 存储三层

```text
┌─ OPFS ──────────────────────────┐  原始文件字节（大二进制、流式）
├─ IndexedDB (Dexie) ─────────────┤  结构化元数据 + 学习数据（24 张表，schema v7）
├─ 浏览器内存 ────────────────────┤  仅当前任务文本 → 用户配置的 AI API
└─────────────────────────────────┘
```

### 分层（铁律：UI 不直接碰 IndexedDB）

```text
UI (pages / widgets / shared.ui)
  ↓  只读 hooks、发命令
Feature hooks (features/*)
  ↓
Services (services/*)          业务编排、跨实体事务
  ↓
Repositories (entities/*/repository)
  ↓
Dexie / OPFS (infrastructure/*)
```

`infrastructure` 不含业务规则；跨表操作只走 Service。

### AI Provider

```text
业务服务 → AIService(JSON 提取 / 重试 / 脱敏)
        → AIProvider(接口)
        → OpenAICompatibleProvider
        → fetch /chat/completions
```

- **不为每家厂商写独立业务逻辑**。6 个预设（OpenAI / Qwen / DeepSeek / MiniMax / MiMo / 自定义）全部复用 `OpenAICompatibleProvider`，差异只在 `presets.ts`（baseURL、`supportsJsonMode`、默认模型）。
- 能力声明：`ProviderCapabilities { jsonMode, streaming, tools }`。
- 流式走 SSE；超时语义是**静默超时**而非总时长（长课程分析不被误杀）。
- 类型化错误：`MISSING_API_KEY / MISSING_BASE_URL / MISSING_MODEL / AUTH_FAILED / RATE_LIMITED / TIMEOUT / PROVIDER_UNAVAILABLE / INVALID_RESPONSE / INVALID_JSON / ABORTED`，再由 `shared/lib/aiErrors.ts` 映射为可操作提示。

### Prompts

- 每个 prompt 在 `src/infrastructure/ai/prompts/<family>/v1.ts`，导出 `VERSION` / `buildSystemPrompt()` / `buildUserPrompt()`。
- `prompts/index.ts` 是唯一注册表。升级 = 加 `v2/` 并切换 import，**调用点不变**。

### 安全模型

- API Key：**AES-GCM 加密存储**，密钥为不可导出设备密钥（`cryptoKeys` 表）。兼容旧明文并自动迁移（schema v6）。
- 日志：`logger` 递归脱敏 `apikey|api_key|password|secret|token|authorization|bearer`；循环引用标记 `[CIRCULAR]`。
- Prompt 注入：所有嵌入文档/作答的 prompt 用 `untrustedContentWrapper` 包裹 + `securityFooter`（覆盖 `document-analyzer`、`quiz-generator`、`mistake-analyzer`、`tutor/*`）。
- AI 输出：`parse → validate/normalize → 业务逻辑 → 落库`；不可用则抛错，**不落库**。
- 渲染：无 `dangerouslySetInnerHTML`；Markdown / LaTeX 按文本渲染；CSP 友好（无 eval、无远程脚本）。
- 明确边界：邀请码是**本地访问门，不是安全边界**；设备密钥**不能**防御同源脚本。

---

## 4. 数据模型（按域）

| 域 | 实体 |
| --- | --- |
| 身份/配置 | `UserProfile` `AISettingsRow` `InviteKeyRecord` `CryptoKeyRow` |
| 项目 | `Project` |
| 内容 | `Document` `DocumentBlobRow` `DocumentChunk` `ProcessingJob` |
| 知识结构 | `CourseAnalysis` `Topic` `Concept` `Formula` `CourseSymbol` `Example` `CourseExercise` `Prerequisite` |
| 教学 | `TutorLesson`（缓存课时）`TutorSession`（交互会话）`TranslationEntry` |
| 练习 | `Question` `QuestionAttempt` `Quiz` `KnowledgeMastery` |
| 错误 | `Mistake` |

关键约定：

- 所有业务表带 `projectId` 与 `[projectId+...]` 复合索引；未知 projectId 抛 `NotFoundError`。
- `TutorLesson.contentHash` 是主题指纹，课程重析后自动失效重生成。
- `SourceReference` 必带 `chunkId`，引用必须来自**真实分块**，杜绝 AI 编造出处。

---

## 5. 内容处理流水线

```text
Upload → validation → (blob 落 OPFS) → processingJob
      → 提取 (pdf / docx / pptx / ocr / text)
      → textEncoding 异常检测（保留原字符，绝不猜测替换）
      → 结构识别 (headings / paragraphs / tables / equations)
      → 分块 (chunking) → 元数据 → chunk 落库 → Ready for AI
```

- Chunk 字段：`documentId projectId pageNumber section content contentType sourceReference(chunkId)`。
- `contentType ∈ {definition, theorem, formula, example, exercise, explanation, table, note}`。
- 图片走**本地 OCR**（tesseract.js），不联网。
- 批处理并发 2，单文件错误隔离。

---

## 6. 教学 / Quiz / 错题系统

### 导师：阅读与交互分离（核心设计）

```text
Topic
  ├── TutorLesson   一次生成、本地缓存、按语言分版；Markdown 标题 → TeachingBlock
  └── TutorSession  交互循环：讲解 → 提问 → 等待作答 → 判分 → 反馈 → 渐进提示 → 下一题 → 难度调整
```

- **讲解与出题完全解耦**：出题失败不丢已生成的讲解；`TutorService` 不引用 QuizService。
- 取材料优先级：主题 `sourceRefs` 精确分块 → 引用匹配 → 页码 → 文档开头 → 项目回退。
- 内容三态标注：Document Content / AI Supplementary / AI Generated Exercise。
- 导师难度：轻量规则（2 连对升，2 连错或补充说明降）。

### Quiz

- 题型：单选、判断、数值（容差）、数学表达式。
- **简答题已移除**（无法可靠自动判分，避免误判）——与原始需求文档冲突，见第 9 节待决项。
- 判分 `infrastructure/math/expressionEvaluator.ts`：Unicode 归一 → mathjs 解析 → 符号化简 `simplify(lhs-rhs)===0` → 16 点数值采样 → 去 `+C` → 返回 `true|false|null`。`null` 显示「无法自动判定」且**不计入成绩**。判分不依赖 AI，可复现。
- 自适应：`composite = 0.45·近期正确率 + 0.25·难度加权正确率 + 0.20·知识点掌握度 + 0.10·连对连错`；≥2 题才调整；5 档（beginner→challenge）单步移动。
- 掌握度：`Σ(recencyWeight × difficultyWeight × correct) / Σ(recencyWeight × difficultyWeight)`，`recencyWeight = 0.9^距最新`，难度权重 0.6→1.4，未验证作答不计入。

### 错题本

- `Mistake`：`question / studentAnswer / correctAnswer / knowledgePoint / difficulty / mistakeType / aiAnalysis / timestamp`；同题多次错合并。
- 类型：`Conceptual / Calculation / Formula / Sign / Unit / Misreading / Incomplete / Careless / Unknown`。
- `mistake-analyzer/v2` + `normalizeAnalysis()` 三层兜底（prompt → normalizer → UI）。
- 练习选项：不练 / 练本知识点 / 练相似题 / 薄弱点训练。
- 薄弱点：`0.45·错题占比 + 0.20·未掌握占比 + 0.15·近期错题 + 0.20·(1−掌握度)`。

---

## 7. 路由与目录

| 路由 | 页面 |
| --- | --- |
| `/login` `/invite` | 邀请码门（本地校验） |
| `/dashboard` | 总览 |
| `/projects` `/projects/:id` | 项目列表 / 详情 |
| `/projects/:id/tutor/:topicId` | **课时页**（阅读，缓存） |
| `/projects/:id/tutor/:topicId/interactive` | **交互导师**（提问/作答/提示） |
| `/projects/:id/history` | 对话记录 |
| `/projects/:id/quiz` `/quiz/:quizId` `/result` | 测验 |
| `/projects/:id/mastery` `/mistakes` | 掌握度 / 错题本 |
| `/projects/:id/documents/:did` | 文档详情 |
| `/settings` | AI 设置 / 数据管理 |

响应式：`≥lg` 三栏（主题 | 导师 | 公式符号）；`<lg` 主题+导师堆叠，公式面板走底部 Sheet。

```text
src/
  app/            外壳、路由、Bootstrap、RequireAuth、providers
  pages/          页面（含 InteractiveTutorPage）
  widgets/        功能区块（documents/tutor/quiz/mistakes/formulaPanel/source/…）
  features/       状态与业务 hooks（auth/documents/project/settings/tutor/theme/toast）
  services/       业务编排（analysis/tutor/tutorLesson/quiz/mistake/mastery/adaptive/weakness/…）
  entities/       领域模型 + repository
  infrastructure/ ai(provider+prompts) db files crypto logger math opfs errors
  i18n/           en / zh-CN
  shared/         ui 组件 + lib 工具
tests/            ai / ui / unit
launcher/         windows.ps1 / unix.sh
docs/             architecture.md
```

---

## 8. 常用命令

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 开发服务器（**固定端口 5173**，IndexedDB 按 origin 隔离，勿换地址） |
| `npm run build` | 类型检查 + 生产构建 |
| `npm run typecheck` | `tsc -b --noEmit` |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |
| `npm test` | Vitest（`vitest run`） |
| `npm run test:coverage` | 覆盖率 |

完成任务后**必须**跑：`npm run lint` + `npm run typecheck` + `npm test`。

---

## 9. 当前状态与待决项

### 阶段进度

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 1 | 基础骨架 | 已交付 |
| 2 | 内容库（PDF/DOCX/PPTX/OCR/文本 + 分块） | 已交付 |
| 3 | AI Provider · 课程分析 · 导师 · 翻译 | 已交付 |
| 4 | Quiz · 自适应难度 · 掌握度 | 已交付 |
| 5 | 错题本 · 薄弱点 · 复习 | 已交付 |
| 6 | 知识索引 + 检索（RAG） | 未开始 |
| 7 | 课时化导师 + 公式符号 + KaTeX 打磨 | **进行中（工作区未提交）** |
| 8 | Dashboard 强化 | 未开始 |
| 9 | PWA · a11y · 导入导出打磨 | 未开始 |

**工作区有未提交的 Phase 7 改动**（`entities/tutorLesson`、`features/tutor`、`InteractiveTutorPage`、`TutorLessonView`、`TutorSymbolsPanel`、`Math.tsx`、`TeachingBlock.tsx`、`latexSymbols`、`lessonDocument`、`markdownText`、`teachingBlocks`、`tutorLessonService`、`topicSources` 等）。继续新阶段前，先确认这批改动通过 lint/typecheck/test 并提交。

### 待用户拍板的决策点

1. **简答题**：原始需求要求支持，当前已移除。选项：保持移除 / AI 判分并标注低置信 / 仅作不计分练习。
2. **作答时间**：需求提到「回答时间（如果可获得）」，当前**未采集**。是否加 `QuestionAttempt.durationMs` 并纳入难度模型。
3. **检索策略**：Phase 6 RAG 是否现在做？当前是「按主题 sourceRefs 取块 + 长上下文」，资料量大时才需要向量检索。
4. **下一阶段目标**：先收尾并提交 Phase 7，还是先补 RAG / Dashboard。

### 已知限制

- 需自备 AI API；不配置时仅上传与本地处理可用。
- 数据绑定浏览器 origin；换地址/清站点数据会看不到数据，需用「数据管理 → 导出数据」备份。
- 数学等价判断有边界，极复杂表达式返回「无法自动判定」，不计入成绩。
- OCR 质量取决于图片清晰度；手写内容提取效果有限。
- 课程分析为项目级（覆盖该项目全部已处理文档），非逐文档结果。
