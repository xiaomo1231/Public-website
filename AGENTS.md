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

当前版本：**V0.2.7（0.2.7）**。

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

### 存储两层 + 内存

```text
┌─ IndexedDB (Dexie) ─────────────┐  结构化元数据 + 学习数据 + 原始文件字节
│                                 │  33 张表，schema v11
├─ localStorage ──────────────────┤  仅 UI 语言镜像（避免首帧语言闪烁）
├─ 浏览器内存 ────────────────────┤  仅当前任务文本 → 用户配置的 AI API
└─────────────────────────────────┘
```

- 原始文件字节存在 **IndexedDB 的 `documentBlobs` 表**（`bytes: ArrayBuffer`），不在 OPFS。
- `src/infrastructure/opfs/opfs.ts` 是一个**未被接线的可选快速路径**（全项目无 import）；`Document.hasBlob` 的注释也写明「OPFS migration can come later」。不要以为文件已落 OPFS。
- localStorage 只保存 UI 语言（`ai-learning:ui-language`）；外观偏好（明暗模式 + 配色主题）存在 `UserProfile`（IndexedDB）。

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
Dexie (infrastructure/*)
```

`infrastructure` 不含业务规则；跨表操作只走 Service。

**课程内容的统一入口**：`CourseContentRepository`（`entities/courseContent/`）是课程分析实体的**只读聚合 + freshness + manifest** 逻辑层，不拥有任何表、不复制数据。它**不是**万能 repository —— TutorLesson / Practice / Notes / Transcript / Quiz 作答 / 学习进度 / Class Progress / VisualSource 各自保留原有 repository 与 service。

```text
UI / Feature
    ↓
CourseContentRepository / CourseContentService
    ↓
existing repositories (courseAnalysis / courseStructure / document / chunk)
    ↓
Dexie
```

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
| 教材结构 | `CourseStructure` `CourseStructureNode`（章节唯一真相，扁平 + `parentId`） |
| 教学 | `TutorLesson`（缓存课时）`TutorSession`（交互会话）`TranslationEntry` |
| 上下文 | `CourseContext`（教授教学风格、班级进度、note/lecture 关联） |
| 视觉 | `VisualSource` `VisualSourceImage` |
| 教授练习 | `PracticeSet` `PracticeQuestion` `PracticeAttempt` |
| 练习 | `Question` `QuestionAttempt` `Quiz` `KnowledgeMastery` |
| 错误 | `Mistake` |

关键约定：

- 所有业务表带 `projectId` 与 `[projectId+...]` 复合索引；未知 projectId 抛 `NotFoundError`。
- `TutorLesson.contentHash` 是主题指纹（含 `chapterId`/`sectionId`/`promptVersion`/notes+transcript `contextHash`），课程重析后自动失效重生成。
- `SourceReference` 必带 `chunkId`，引用必须来自**真实分块**，杜绝 AI 编造出处。
- 章节层级**只有** `CourseStructure`/`CourseStructureNode` 一处；Topic / chunk / NoteLink / LectureChunkLink / PracticeQuestion 只保存 `chapterId`/`sectionId` 引用，不复制章节树。

### 外观（Appearance）——两个独立维度

```text
mode:       light | dark | system      （themeStore 解析 → <html>.dark + color-scheme）
colorTheme: default | pinkAqua | warmOrange | academic
                                       （<html data-color-theme=…> → globals.css 变量块）
```

- 两者都存在 `UserProfile`（`theme` / `colorTheme`），经 `useThemePreference()` / `useColorTheme()` 即时应用 + 持久化；**不是**第二套 localStorage key。
- 颜色定义集中在 `features/theme/colorThemes.ts`（原始 hex，仅供预览）+ `shared/styles/globals.css`（每套主题 light/dark 各一块，共 21 个变量）。**组件不得硬编码颜色。**
- 填色且承载文字的表面（Button default / Badge default / Tooltip / 品牌标记）用 `--primary-strong`；`--primary` 留给 icon、链接、进度条、柔和状态、focus ring。
- 主题切换是纯 presentation：**不触发 AI、不使 CourseAnalysis / TutorLesson / CourseContext 失效**。
- 对比度由 `tests/themeContrast.test.ts` 从真实 CSS 计算并断言（正文 ≥4.5:1，填色按钮 ≥3:1）。

---

## 5. 内容处理流水线

```text
Upload → validation → (blob 落 IndexedDB `documentBlobs`) → processingJob
      → 提取 (pdf / docx / pptx / ocr / text)
      → textEncoding 异常检测（保留原字符，绝不猜测替换）
      → 分块 (chunking)
      → 教材结构识别 + 持久化（`CourseStructure`/`CourseStructureNode`；chunk 绑定 chapterId/sectionId）
      → 视觉来源保留（`VisualSource`/`VisualSourceImage`）
      → chunk 落库 → Ready for AI
```

- Chunk 字段：`documentId projectId materialType pageNumber section contentType text sourceReference order chapterId sectionId chapterNumber sectionNumber chapterTitle sectionTitle createdAt`。
- `contentType ∈ {heading, paragraph, table, list, formula, caption, note, ocr, other}`。
- 图片走**本地 OCR**（tesseract.js），不联网。
- 批处理并发 2，单文件错误隔离。
- 结构识别只在 `materialType === 'textbook'` 时执行；无信号时退化为单个 `General Course Material`（`confidence: 'low'`），**不发明章节**。

### 课程内容持久化与 freshness（`CourseContent`）

**没有 `content/` 目录、没有 JSON 内容文件、没有第二套数据库。** 课程分析结果本来就持久化在 Dexie（`courseAnalyses` + `topics/concepts/formulas/symbols/examples/courseExercises/prerequisites`），`CourseContentRepository` 只是其上的逻辑聚合层。

四个版本概念**不可合并**：

| 概念 | 含义 | 存放 |
| --- | --- | --- |
| Dexie `verno` | 数据库结构 | `infrastructure/db/database.ts` |
| `CourseAnalysis.promptVersion` | 产出该结果的 prompt 版本 | 分析行 |
| `CourseAnalysis.schemaVersion` | 分析结果的**数据形状**版本（`COURSE_ANALYSIS_SCHEMA_VERSION`） | 分析行 |
| `CourseStructure.version` | 教材结构修订号（粗粒度） | 结构行 |
| `CourseAnalysis.derivedFromStructureVersion/Hash` | 该结果派生自哪个结构修订 | 分析行 |
| `CourseAnalysis.sourceHash` | 分析**输入内容**指纹 | 分析行 |

- `sourceHash` 是**内容指纹**（chunk 文本 + order + 页码 + chapterId/sectionId + document id/name/size），**不含 `processedAt`、不含 chunk id**。因此「原样重处理」不会误判为内容变化。
- freshness 判定（`evaluateFreshness`，纯函数）只看：`sourceHash` / `promptVersion` / `schemaVersion` / 结构（优先 `structureHash`，旧行回退 `structureVersion`）/ `status`。**明暗模式、配色主题、UI 语言、Class Progress、练习记录都不参与。**
- `staleReason` / `staleAt` **只是注释**，不是 freshness 输入；`markStale()` 不会单独把结果变成 stale。
- `reseedProject` 是**单事务原子替换**：AI 失败时旧分析原样保留。
- **`DocumentAnalysisService.analyzeProject()` 仍是项目级**（全量路径不变）。
- **章节级增量更新已实现**（见 §5.1）：`analyzeScope({type:'chapter'|'section'})` 走**局部**路径，不调用 `analyzeProject`，不调用 `deleteByProject`。
- 只有 **upload / processing 流程**会调用 `CourseContentService.ensureAnalyzed()`（带 module 级 in-flight 去重）；**打开任何页面都不会触发课程分析**。未配置 API Key 时是 `no-provider`，**不**标记为 failed。

### 5.1 章节级增量更新

**依赖模型（权威来源）**

- `Topic.sourceChunkIds` 是增量依赖的**唯一权威**；`chapterId`/`sectionId` 只是展示与主归属。
- 依赖由 AI 从**闭集候选**中选择：分析输入给每个 chunk 加 `[c:<chunkId> · 章节 · 页码]` 前缀（`buildCandidateChunkLabel`），AI 只能从这些 id 里选；本地 `validateTopicSourceChunks` 校验（存在性 / 去重 / 稳定排序 / 至少一条），不合法 ⇒ `needsFullReanalysis`，**绝不猜测**。
- 同时派生 `sourceSectionIds` / `sourceChapterIds` / `dependencyHash` / `sourceChunkFingerprints`（本地计算，不来自 AI）。
- 分析器提示词已升到 **`document-analyzer/v2`**（旧分析因 `prompt-changed` 自动变 stale）。

**稳定 Topic 身份（`entities/courseAnalysis/topicIdentity.ts`）**

- 全量重析不再重发所有 topic UUID。一对一匹配顺序：`sectionId+归一化name` → `chapterId+归一化name` → **双方都有可信 `sourceChunkIds` 时按来源重叠**；同名但位置与依赖都不明确 ⇒ `ambiguous`，**不复用 id**（新建 topic，旧 topic 保留）；一个旧 id 只被消费一次。
- 名称**只作匹配键**，不是主键。每次决策都带 machine-readable `reason`。

**分级计划（`IncrementalOp`）**

```text
unchanged | relinkOnly | regenerateSection | regenerateChapter
| regenerateTopic | preserveTopic | needsFullReanalysis
```

- `regenerateSection` / `regenerateChapter` 说明**变化落在哪里**（供 UI/诊断）；实际执行单元是 `regenerateTopic`。
- 内容证据优先于结构启发式：chunk 按 `sourceChunkFingerprints` **按内容重连**——重处理导致 id 变化但文本相同时只 `relinkOnly`（**不调用 AI**）；重连失败（文本真的变了）才 `regenerateTopic`。
- 跨章节 Topic 只更新其中一章时**绝不删除**：`inputChunkIds` = 仍有效的声明来源 ∪ 其来源章节/小节的**当前** chunks。
- 来源章节消失 ⇒ `preserveTopic`；依赖缺失/无有效来源 ⇒ `needsFullReanalysis`。

**执行与原子性**

- `executeIncrementalScope`：内存 staging（逐 topic 调 `topic-analyzer/v1`）→ **预提交重校验**（`sourceHash`/`structureHash` 变了就抛 `CONCURRENT_MODIFICATION`，可重试）→ **单个 Dexie rw 事务**一次性提交。
- **该事务覆盖 10 张表**：`courseAnalyses` `topics` `concepts` `formulas` `symbols` `examples` `courseExercises` `prerequisites` `practiceQuestions` `courseContexts`。
- **关联重连也在这个事务里**：PracticeQuestion、NoteLink、LectureChunkLink 的重连先**只读 staging**（`PracticeService.planChunkRelink()` / `CourseContextService.stageDerived()`），再作为 `AtomicSideWrites` 随同一个事务提交。**没有任何 best-effort 的提前写入。**
- **不调用 `deleteByProject`，不做全量 reseed。** 失败/取消/空响应/并发变化/事务异常 ⇒ 所有表保持提交前状态。
- 派生行共享时不删：只从 `topicIds` 摘掉被重建的 topic；新行同名合并而非重复插入。
- `analyzeScope` 只在「所有受影响 topic 都有经本地校验的 `sourceChunkIds` 且结构映射明确」时执行；否则抛 `ANALYSIS_SCOPE_UNSUPPORTED` + `reason ∈ {dependencies-missing, structure-ambiguous, topic-spans-missing-chapter, scope-not-implemented}`，**绝不静默降级为全项目**。

**关联数据**

- 统一的重连原语在 `entities/chunk/relink.ts`：`relinkChunkReference()` 按**内容指纹**把失效的 chunk 引用重指到替代 chunk；无匹配则保留原引用 + `needsRelink` + machine-readable `relinkReason`。原 id 记在 `previousChunkId` / `previousTextbookChunkId`。
- note/lecture 链接：`CourseContext.sourceHash` **包含教材 chunk id**，并新增 `linkFingerprint`（链接目标指纹，不看数量）。`stageDerived()` 计算 → 增量事务提交；`syncDerived()` 复用它并在导师页打开时持久化（幂等、无 AI）。
- 教授练习题：`PracticeService.planChunkRelink()` 纯计算，增量事务提交；全量分析路径把它作为 `sideWrites` 传入 `reseedProject` 的同一事务。
- TutorLesson 只在 topic 行变化时因 `contentHash` 自然失效，**不清空整门课缓存**。
- Dexie **未升版**；所有新字段都是可选行属性。

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
- **缓存失效输入只有**：主题本身（name/description/`chapterId`/`sectionId`/`sourceRefs`）、`promptVersion`、notes/transcript `contextHash`。换主题配色、明暗模式、UI 语言、Class Progress、练习记录**都不会**让课时失效。`TutorLessonService` 与 `CourseContentService` 都有 in-flight 去重（同一 key 并发只发一次请求）。

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
  widgets/        功能区块（documents/tutor/quiz/mistakes/formulaPanel/source/theme/…）
  features/       状态与业务 hooks（auth/documents/project/settings/tutor/theme/toast）
  services/       业务编排（analysis/tutor/tutorLesson/quiz/mistake/mastery/adaptive/weakness/courseContent/…）
  entities/       领域模型 + repository（含 courseContent：聚合 + freshness）
  infrastructure/ ai(provider+prompts) db files crypto logger math opfs(未接线) errors
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
| 7 | 课时化导师 + 公式符号 + KaTeX 打磨 | 已交付（v0.2.4） |
| 7b | 教材章节结构 + 课程内容持久化 / freshness | 已交付（v0.2.5） |
| 7c | 配色主题（Color Themes，4 套）+ 可访问性 | 已交付（v0.2.5） |
| 7d | 章节级增量内容生成（依赖模型 + 稳定 Topic 身份 + 局部提交） | 已交付（v0.2.6） |
| 7e | 课时级数学可视化（线性/非线性 + 向量/图 + 线性变换/维恩图/特征值 + 教学区块放置） | 已交付（v0.2.6） |
| 7f | 划词浮层定位修复（真实尺寸 flip/clamp + ResizeObserver/visualViewport） | 已交付（v0.2.6） |
| 8 | Dashboard 强化 | 未开始 |
| 9 | PWA · a11y · 导入导出打磨 | 未开始 |

**V0.2.6 已提交并发布**（tag `v0.2.6`，两个远程仓库各一份 Release + 源码压缩包）。本版包含：Phase 7d 章节级增量分析、导师数学可视化 Phase 1 / 1.1 / 2 / 3.0 / 3.1 / 3.2（含 `eigen_2d`）、Markdown 表格渲染、划词浮层定位修复，以及课程分析 JSON 提取加固。v0.2.5 已发布（tag `v0.2.5`）。

### 待用户拍板的决策点

1. **简答题**：原始需求要求支持，当前已移除。选项：保持移除 / AI 判分并标注低置信 / 仅作不计分练习。
2. **作答时间**：需求提到「回答时间（如果可获得）」，当前**未采集**。是否加 `QuestionAttempt.durationMs` 并纳入难度模型。
3. **检索策略**：Phase 6 RAG 是否现在做？当前是「按主题 sourceRefs 取块 + 长上下文」，资料量大时才需要向量检索。
4. **增量分析**：**章节级增量生成已实现**（§5.1）。边界：只支持「按章节/小节」的局部更新，且要求受影响 topic 都已有经本地校验的 `sourceChunkIds`；旧数据缺依赖时返回 `ANALYSIS_SCOPE_UNSUPPORTED`（`dependencies-missing`）而非降级。跨章节 Topic 的**多来源扩展**仍是保守策略（只在其自身来源被证明变化时才重建）。
5. **`#4C1A2`**：Warm Orange 主题的 `deep` 色按用户原文保留，但它不是合法 hex，无法用作 CSS 颜色。当前处理：保留在 palette metadata 里，**不写入任何 CSS 变量**；主题选择器把它渲染成「不可用」虚线 `?` 色块，不伪造颜色。等待正确色值。
6. **对比度**：浅色主按钮已改用 `--primary-strong`（Pink Aqua `#1E8F9C` = 3.84:1，Warm Orange `#8C3332` = 7.79:1；Default 15.55:1，Academic 4.82:1）。**Pink Aqua 仍为 AA-large，未达 AA-normal（4.5:1）**——因为 `#1E8F9C` 是用户指定值，达标需要改色。暗色模式主按钮 6.67–14.22:1 全部达标。
7. **数学可视化 Phase 3.3 进行中**：在 v0.2.6 已发布的 `visualization-generator/v4`、schema v4 类型上，工作区新增 Hasse 图 `hasse_2d`：模型提供明确有限偏序元素与比较关系，本地校验环、计算传递约简并确定分层位置；使用确定性 SVG 和双语无障碍描述。注册表现已切换到 visualization prompt v5，schema 升至 v5；未新增 Dexie 表/索引，也未改 Tutor Lesson 缓存版本。其余考虑项：关系/笛卡尔图、真值表、矩阵步骤；状态机可用已有 `graph_2d` 表示，暂不重复实现。

8. **Markdown 表格渲染（Phase 3.1.1 已实现并验证，随 v0.2.6 发布）**：共享 `RichText` 新增 GFM pipe table block（`shared/lib/markdownTable.ts` 纯解析 + `markdownText.ts` block + `RichText` 语义化渲染）；cell 复用现有 inline 文本/code/LaTeX；宽表仅在容器内横向滚动；普通 `|x|` 不误判；code fence / block math 内不解析表格。Tutor Lesson Prompt 升 **v3**（保留 v1/v2）规范表格输出。旧缓存中的多行 Markdown 表格**无需重新调用 AI 即可正确显示**；Prompt v3 经 `contentHash` 使旧课时自然重生成一次。未改 `TUTOR_LESSON_VERSION` / Visualization schema / Dexie。

9. **划词浮层定位修复（Phase 3.2 已实现并验证，随 v0.2.6 发布）**：`SelectionTranslator` 不再一次性写入 `top: rect.top - 8` + `translate(-50%,-100%)`，改为纯函数 `computeSelectionPopupPosition`（`shared/lib/popupPosition.ts`）按**真实浮层尺寸**优先上方、空间不足翻转下方、上下都不足取较大侧并给出 `maxHeight`，左右 clamp 到视口；用 `ResizeObserver` + `useLayoutEffect` + `window.resize` + 捕获阶段 `scroll` + `visualViewport`（resize/scroll）在内容/视口/滚动变化后重新定位，监听器与 observer 在卸载时清理；滚动使选区完全离开视口时关闭浮层。移动端仍为底部浮层但以 `visualViewport` 为界。未引入新依赖、未改 Portal、未改动全站其它浮层。

### 已知限制

- 需自备 AI API；不配置时仅上传与本地处理可用（状态是 `no-provider`，不是 failed）。
- 数据绑定浏览器 origin；换地址/清站点数据会看不到数据，需用「数据管理 → 导出数据」备份。
- 数学等价判断有边界，极复杂表达式返回「无法自动判定」，不计入成绩。
- OCR 质量取决于图片清晰度；手写内容提取效果有限。
- 课程分析为项目级（覆盖该项目全部已处理文档），非逐文档结果，也非章节级。
- 数学可视化范围受控：`eigen_2d` 只支持 2×2 实矩阵的**实**特征值/特征向量；复特征值、3×3、Jordan 形、动画、拖拽均不支持，会安全回退为普通 LaTeX，不绘制误导性的实特征方向。
- 冷启动时外观偏好（明暗 / 配色）要等 `UserProfile` 读出后才应用，可能有一帧默认配色。
