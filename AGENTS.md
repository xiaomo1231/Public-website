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

当前版本：**V0.4.0（0.4.0）**。

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
- **科目画像 `subject-profile/v1`**：按项目科目（`calculus / linear_algebra / discrete_math / physics / chemistry / biology / cs / stats / other`）给出记号、推理方式、答案格式与常见错误；由 `withSubject()` 追加到教学/判分/分析类 system prompt（课程分析、增量主题分析、导师课时、交互导师、划词提问、测验、错题分析、作业提示/解法/复习讲解/检查答案/逐题问答、幻灯片学习）。`other` 不追加。科目一律由服务端从项目读取（`services/projectSubject.ts`），**不由 UI 传入**。化学记号用 mhchem `$\ce{...}$`（`Math.tsx` 已加载 `katex/contrib/mhchem`）。
- 画像可带**仅课时用**的 `lesson` 指引，只有 `withSubject(..., { forLesson: true })`（导师课时）才追加：化学/生物要求把可画成图的事实写明（分子名+分子式、各状态能量、滴定浓度/体积/Kₐ、亲本基因型、家系、DNA 序列），并在课程资料有图时引导学生看原图。
- 带缓存/可比对的产物把科目画像折进版本：`subjectPromptVersion(base, subject)` = `<base>+subject-profile/v1:<subject>`，某科画像修改时在 `PROFILE_REVISIONS` 里给**该科**加修订号（追加 `.rN`；当前化学 `.r3`、生物 `.r2`、概率统计 `.r2`、物理 `.r2`、微积分 `.r2`、计算机 `.r2`——均已按大学深度改写或补充课时指引），只让该科的缓存失效（CourseAnalysis、增量 Topic、TutorLesson、SlideLesson、作业复习讲解与检查答案），不会让其它科目全部重生成。

### 安全模型

- API Key：**AES-GCM 加密存储**，密钥为不可导出设备密钥（`cryptoKeys` 表）。兼容旧明文并自动迁移（schema v6）。
- 日志：`logger` 递归脱敏 `apikey|api_key|password|secret|token|authorization|bearer`；循环引用标记 `[CIRCULAR]`。
- Prompt 注入：所有嵌入文档/作答的 prompt 用 `untrustedContentWrapper` 包裹 + `securityFooter`（覆盖 `document-analyzer`、`quiz-generator`、`mistake-analyzer`、`tutor/*`）。
- AI 输出：`parse → validate/normalize → 业务逻辑 → 落库`；不可用则抛错，**不落库**。
- 渲染：无 `dangerouslySetInnerHTML`；Markdown / LaTeX 按文本渲染；CSP 友好（无 eval、无远程脚本）。
- 明确边界：邀请码是**本地访问门，不是安全边界**；设备密钥**不能**防御同源脚本。
- **联网参考图片（默认关闭）**：唯一会联系 AI 服务商以外主机的功能。只访问 `pubchem.ncbi.nlm.nih.gov` / `commons.wikimedia.org` / `upload.wikimedia.org`（白名单，仅 https），只发出搜索词；图片只收 PNG/JPEG/GIF/WebP（不收 SVG）、≤3 MB；Commons 只收公有领域 / CC0 / CC BY / CC BY-SA；外链 `rel="noopener noreferrer"`。

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
| 视觉 | `VisualSource` `VisualSourceImage` `ReferenceImage` `ReferenceImageBlobRow`（联网参考图片缓存，Dexie v14） |
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
- freshness 判定（`evaluateFreshness`，纯函数）只看：`sourceHash` / `promptVersion` / `schemaVersion` / 结构（优先 `structureHash`，旧行回退 `structureVersion`）/ `status`。期望的 `promptVersion` 按项目科目计算（见 Prompts「科目画像」），所以**改科目 ⇒ `prompt-changed`**。**明暗模式、配色主题、UI 语言、Class Progress、练习记录都不参与。**
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
- **缓存失效输入只有**：主题本身（name/description/`chapterId`/`sectionId`/`sourceRefs`）、`promptVersion`（含项目科目画像）、notes/transcript `contextHash`。换主题配色、明暗模式、UI 语言、Class Progress、练习记录**都不会**让课时失效。`TutorLessonService` 与 `CourseContentService` 都有 in-flight 去重（同一 key 并发只发一次请求）。

### Quiz

- 题型：单选、判断、数值（容差）、数学表达式、**代码输出**（`code_output`，仅计算机科目提供：题干含带语言标记的代码块，答案为程序的确切输出，按行尾空白/换行规范化后**精确匹配**）。
- 数值题可带 `unit`（mathjs 单位语法，如 `m/s^2`）：学生须带单位作答，任意同量纲单位先换算再按 1% **相对**容差比较；缺单位 / 量纲不对给出明确提示，单位无法识别则不判分（`infrastructure/math/quantityAnswer.ts`）。出题 prompt 为 `quiz-generator/v4`。
- **化学方程式题（`chem_equation`，仅化学科目）**：`infrastructure/chemistry/equation.ts` 本地解析（`->`/`<=>`/`→`/`⇌`/`=`、`[条件]`、电荷 `Fe^3+`、按 mhchem 约定 `NH4+` 为 +1、水合物 `·`、状态符号忽略）。判分：物种一致（顺序无关）+ 原子与电荷守恒 + 系数成比例（整倍数也算对）；缺/多物种、不守恒、系数错误分别给出提示；读不懂则不判分。出题时参考答案本身必须能解析且配平，否则丢弃该题。**有机结构式**：物种内可写键（`CH2=CH2`、`HC#CH`/`HC≡CH`、`CH3-CH3`）；没有其它箭头时裸 `=` 才可能是反应箭头，取能配平的那个 `=`。物种按分子式匹配；参考答案写了 ≥2 个碳的结构式而作答结构写法不同（如乙醇 vs 二甲醚）时，判定为 `isomers`：不计分并提示可能是同分异构体（简单基团 `(CH2)3` 展开、键符号忽略后再比较）。
- 单位（`quantityAnswer.ts` 使用独立 mathjs 实例，不影响表达式判分）额外支持 `M/mM/µM/nM`（mol/L）、`Da/kDa`、`cal/kcal`、`ppm/ppb`、`Å`。
- **排序题（`ordering`，全科可选，默认不勾选）**：`orderItems` 3–8 个互不相同的单行项，参考答案由其重建（换行连接）。作答 `widgets/quiz/OrderingInput`（拖拽 + 上/下按钮，从按题目 id 固定的打乱顺序开始，且绝不是正确顺序）。得分 = 最长保序子序列长度 / 总项数（`infrastructure/math/orderingAnswer.ts`），部分得分走与简答题相同的 `score` 通道。
- **教授练习题与交互导师的简答题**（第二期）复用同一判分器：练习题从教授参考答案经 `rubric-extractor/v1` 拆出得分点（按 答案+prompt 版本 哈希缓存在题目上），作答写入错题本 / 掌握度并支持异议（`PracticeService.disputeAttempt`）；导师出题 `tutor/v2-question` 可出带得分点的简答题，覆盖率 60–99% 或无法核对时难度不调整。
- **简答题（`short_answer`）按得分点计分**：出题时生成参考答案 + 2–6 条得分点（`Question.rubric`）。判分 `services/shortAnswerGrader.ts` + `short-answer-check/v1`：AI 逐条判断是否答到（同义、等价表述都算），答到必须**逐字摘出学生原话**作为证据，本地校验证据确实出现在答案里，否则该点不算；得分 = 答到点数 / 总点数（3/5 → 60%），由本地计算，从不采用 AI 的整体结论。空答案不调用 AI；未配置 AI 或核对失败 ⇒ 不计分（展示得分点与参考答案）。
- 简答题计分：测验百分比 = Σ得分 / 已判题数（简答题按 `earned/total` 计入，`QuizScore.points`）；只有全部答到才算“正确”，其余进入错题本；掌握度按得分比例、**半权重**计入（`observationFromAttempt`）。学生可点“我不同意这个判定”（`QuizService.disputeAttempt`）：该次作答保留展示但不再计分，同时移出错题本、重建该知识点掌握度、已完成测验重新算分。
- 表达式判分 `infrastructure/math/expressionEvaluator.ts`：Unicode 归一 → mathjs 解析 → 符号化简 `simplify(lhs-rhs)===0` → 16 点数值采样 → 去 `+C` → 返回 `true|false|null`。`null` 显示「无法自动判定」且**不计入成绩**。判分不依赖 AI，可复现。
- 自适应：`composite = 0.45·近期正确率 + 0.25·难度加权正确率 + 0.20·知识点掌握度 + 0.10·连对连错`；≥2 题才调整；5 档（beginner→challenge）单步移动。
- 掌握度：`Σ(recencyWeight × difficultyWeight × correct) / Σ(recencyWeight × difficultyWeight)`，`recencyWeight = 0.9^距最新`，难度权重 0.6→1.4，未验证作答不计入。

### 答题输入（符号键盘）

- 所有作答框统一用 `widgets/mathInput/MathField`：符号键盘 + 实时“系统识别为”预览，插入在光标处，模板（√、a/b、xⁿ、sin…）把光标放进括号、有选区时直接包裹选区。
- 按判分方式选模式（`shared/lib/mathInput.ts`）：`expression`（测验/练习的表达式题，插 mathjs 语法，预览为判分器实际解析结果）、`number`（数值题）、`quantity`（带单位数值题，插单位符号）、`chemistry`（方程式题：箭头/电荷/状态/条件，预览用 mhchem 渲染解析结果）、`text`（作业草稿、导师作答、提问：插 Unicode 符号，分组按项目科目排序，生物有专属分组）。
- 单行框 Enter 提交，多行框 Ctrl/⌘+Enter 提交；键盘开合状态按模式存 localStorage（仅本机偏好）。预览经 `services/answerPreview.ts` 复用判分器的解析函数，不另立规则。

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
| 7g | 学习流程导航与连续性 + 无障碍 / 错误态 | 已交付（v0.2.8） |
| 7h | Precision Lab 视觉方向（蓝图网格 + 仪表细节，四套配色） | 已交付（v0.2.8） |
| 7i | 首页滚动修复 + 可交互函数图像（一次/二次/三次/正弦） | 已交付（v0.2.8） |
| 7j | 作业讲解（题目 / 提示 / 解法 / 问答 + 归档 / 恢复） | 已交付（v0.2.9） |
| 7k | 作业讲解加固（识别可靠性 / 来源校验 / 进度 / 阅读原图）+ 项目文件管理 | 已交付（v0.3.1） |
| 7l | 按幻灯片学习（PPT/PPTX 逐页导师，Dexie v13） | 已交付（v0.3.1） |
| 7m | 作业作答双栏布局 + 桌面侧栏可收起 + 提示/回复公式渲染 | 已交付（v0.3.1） |
| 7n | 作业讲解关联教授答案并用于复习 / 做题 | 已交付（v0.3.1） |
| 7o | 教授答案对应修复（编号解析 / 手动划分 / 一对一校验）+ PDF 数学排版 + 讲解生成可靠性 +「留给学生」识别 | 已交付（v0.3.4） |
| 7p | 作业复习完整教学讲解 + 「检查答案」+ 最后检查排版 + 逐题问答常驻 + 浏览器语音输入 | 已交付（v0.3.4） |
| 7q | 线性代数作业逐题六步学习引导试点 + 题面向量箭头 / 上标显示修复 | 已交付（v0.3.4） |
| 7r | 界面动效 + 首页重设计 + 风格统一（圆角尺度） | 已交付（v0.3.9） |
| 7s | 学科适配：科目画像（9 科，含生物）、科目推断、物理单位判分、代码输出题、概率分布图、化学 mhchem | 已交付（v0.3.9） |
| 7t | 符号键盘 + 实时识别预览；简答题按得分点计分（测验 / 教授练习 / 导师）；化学方程式题、排序题 | 已交付（v0.3.9） |
| 7u | 化学 / 生物配图三层：课程原图优先、本地计算的六种图（schema v7）、联网参考图片（Dexie v14，默认关闭） | 已交付（v0.3.9） |
| 7v | 大学深度：转录方向与起始密码子、有机方程式与同分异构体、大学单位；t / χ² / F 与卡方检验、伴性与复等位遗传、系谱遗传方式分析、多元酸与弱碱滴定（schema v8） | 已交付（v0.4.0） |
| 7w | 其它理科可交互图：公式探索器、微积分（切线 / 黎曼和 / 泰勒）、物理（受力 / 运动 / 光路 / 电路）、统计（回归 / 置信区间）、化学动力学、酶动力学、种群增长、排序与 BST（schema v9） | 已交付（v0.4.0） |
| 8 | Dashboard 强化 | 部分交付（v0.2.8：视觉与交互函数图；v0.3.1：构图与动效打磨；指标类未做） |
| 9 | PWA · a11y · 导入导出打磨 | 未开始 |

**V0.4.0 已提交并发布**（tag `v0.4.0`，两个远程仓库各一份 Release + 源码压缩包）。本版包含：**化学 / 生物正确性修复**（转录方向与起始密码子、有机结构式与同分异构体提示、大学单位）；**化学 / 生物 / 统计科目画像按大学深度改写**，物理 / 微积分 / 计算机画像同步升级；**更深入的图**（t / χ² / F 分布、卡方拟合优度检验、伴性与复等位遗传、系谱遗传方式分析、多元酸与弱碱滴定，schema v8）；**其它理科可交互图**（公式探索器、微积分、物理、统计、化学动力学、酶动力学、种群增长、排序与 BST，schema v9，`visualization-generator/v9`）。未新增 Dexie 表 / 索引。

**V0.3.9 已提交并发布**（tag `v0.3.9`，两个远程仓库各一份 Release + 源码压缩包）。本版包含：**界面动效 / 首页重设计 / 风格统一**；**学科适配**（科目画像 9 科含生物、按科目单独失效缓存、科目推断、物理单位判分、代码输出题、概率分布图 `distribution_2d`、化学 mhchem）；**符号键盘与实时识别预览**；**简答题按得分点计分**（测验 / 教授练习 / 导师）；**化学方程式题、排序题**；**化学 / 生物配图三层**（课程原图优先、六种本地计算图、默认关闭的联网参考图片）。新增 Dexie **v14** `referenceImages` / `referenceImageBlobs` 两表；可视化 schema v7；新增依赖 `smiles-drawer`。

**V0.3.4 已提交并发布**（tag `v0.3.4`，两个远程仓库各一份 Release + 源码压缩包）。本版包含：**教授答案对应修复**（编号解析支持 `Problem/Solution/Answer/Q/Sol/Ex` 与裸编号、编号与正文分行；只识别到未分题段落时提供手动划分；Service 层严格一对一校验）；**教授答案 PDF 数学排版还原**（上下标基线分组，可重新读取原 PDF）；**讲解生成可靠性**（最多 2 题并发 / 题目级进度 / 单题 120s 时限 / 输出截断分阶段 / 已完成跳过 / 失败单题重试）；**「留给学生」答案识别**（不发无依据请求）；**作业复习完整教学讲解**；**「检查答案」**（本地核对 + AI 语义估计，百分比为估计值）；**最后检查排版修复**；**逐题问答常驻**；**浏览器语音输入**；**线性代数六步学习引导试点**；**题面向量箭头与上标显示修复**。均未新增 Dexie 表 / 索引。

**V0.3.1 已提交并发布**（tag `v0.3.1`，两个远程仓库各一份 Release + 源码压缩包）。本版包含：**按幻灯片学习**（PPT/PPTX 逐页导师，新增 Dexie **v13** `slideLessons` 表）；**作业讲解关联教授答案**（新资料角色 `homework_answer`，一对一题号核对、依据教授答案生成提示/解法、做题/复习切换）；作业作答双栏布局 + 桌面侧栏可收起；作业提示与 AI 回复的 KaTeX 公式渲染修复；作业识别加固（分批识别 / 失败阶段分类 / 每题进度 / 受控 Token 预算与错误分类 / 来源 ID 校验与准确出处 / 原图与原文阅读 / 输出截断分次生成）；项目文件总览与安全删除；首页与工作台视觉打磨。

**V0.2.9 已提交并发布**（tag `v0.2.9`，两个远程仓库各一份 Release + 源码压缩包）。本版新增**作业讲解**：从作业文档提取题目、渐进提示与完整解法，逐题保存草稿 / 提示进度 / 答案展开 / 提问对话；支持**整份重新识别**与**单题重生成**，未匹配题目**归档而非删除**，已归档题目再次出现且匹配可靠唯一时**复用原题 ID 恢复全部记录**（有歧义时不猜测），全部在单个事务内提交。新增 Dexie **v12** 的 `homeworkSets` / `homeworkQuestions` 两表，并纳入导出与项目删除清理。

**V0.2.8 已提交并发布**（tag `v0.2.8`，两个远程仓库各一份 Release + 源码压缩包）。本版包含：课程级导航与学习流程连续性、无障碍与错误态、Precision Lab 视觉方向、首页滚动修复、首页可交互函数图像（一次/二次/三次/正弦），并修复 3 个源码文件的 UTF-8 损坏字符。v0.2.7 已发布（tag `v0.2.7`）。

**V0.2.6 已提交并发布**（tag `v0.2.6`，两个远程仓库各一份 Release + 源码压缩包）。本版包含：Phase 7d 章节级增量分析、导师数学可视化 Phase 1 / 1.1 / 2 / 3.0 / 3.1 / 3.2（含 `eigen_2d`）、Markdown 表格渲染、划词浮层定位修复，以及课程分析 JSON 提取加固。v0.2.5 已发布（tag `v0.2.5`）。

### 待用户拍板的决策点

1. **简答题**：已决定并实现——按得分点覆盖率计分（见 §6 Quiz）；第二期（教授练习题、交互导师）已实现。
2. **作答时间**：需求提到「回答时间（如果可获得）」，当前**未采集**。是否加 `QuestionAttempt.durationMs` 并纳入难度模型。
3. **检索策略**：Phase 6 RAG 是否现在做？当前是「按主题 sourceRefs 取块 + 长上下文」，资料量大时才需要向量检索。
4. **增量分析**：**章节级增量生成已实现**（§5.1）。边界：只支持「按章节/小节」的局部更新，且要求受影响 topic 都已有经本地校验的 `sourceChunkIds`；旧数据缺依赖时返回 `ANALYSIS_SCOPE_UNSUPPORTED`（`dependencies-missing`）而非降级。跨章节 Topic 的**多来源扩展**仍是保守策略（只在其自身来源被证明变化时才重建）。
5. **`#4C1A2`**：Warm Orange 主题的 `deep` 色按用户原文保留，但它不是合法 hex，无法用作 CSS 颜色。当前处理：保留在 palette metadata 里，**不写入任何 CSS 变量**；主题选择器把它渲染成「不可用」虚线 `?` 色块，不伪造颜色。等待正确色值。
6. **对比度**：浅色主按钮已改用 `--primary-strong`（Pink Aqua `#1E8F9C` = 3.84:1，Warm Orange `#8C3332` = 7.79:1；Default 15.55:1，Academic 4.82:1）。**Pink Aqua 仍为 AA-large，未达 AA-normal（4.5:1）**——因为 `#1E8F9C` 是用户指定值，达标需要改色。暗色模式主按钮 6.67–14.22:1 全部达标。
7. **数学可视化 Phase 3.3 进行中**：在 v0.2.6 已发布的 `visualization-generator/v4`、schema v4 类型上，工作区新增 Hasse 图 `hasse_2d`：模型提供明确有限偏序元素与比较关系，本地校验环、计算传递约简并确定分层位置；使用确定性 SVG 和双语无障碍描述。注册表现已切换到 visualization prompt v5，schema 升至 v5；未新增 Dexie 表/索引，也未改 Tutor Lesson 缓存版本。其余考虑项：关系/笛卡尔图、真值表、矩阵步骤；状态机可用已有 `graph_2d` 表示，暂不重复实现。
8. **概率分布图 `distribution_2d`**：正态 / 二项 / 泊松 / 均匀 / 指数分布，可带阴影区间。模型只给分布族、参数和区间（`visualization-generator/v6`），密度、区间概率、均值、方差全部本地计算（`entities/tutorVisualization/distribution.ts`）；离散分布画柱、连续分布画曲线。schema 升至 v6；导师课时 prompt 升至 `tutor/v5-lesson`（新增“概率分布”示例族），已缓存课时会重新生成一次。
9. **化学 / 生物图（三层，随 v0.3.9 发布）**：
   - **第 1 层 课程原图优先**：课时页先显示课程资料里的原图，再显示 AI 生成的图；化学/生物课时的 prompt 附上本主题原图清单（页码 + 说明），讲解按页码引用原图。
   - **第 2 层 本地计算的图**（schema **v7**，`visualization-generator/v7`；化学/生物规则只对相应科目及 `other`/未设科目追加，数学课不多花 token）。模型只给课时里的事实，其余全部本地计算：`molecule_2d`（SMILES + 课时写明的分子式；smiles-drawer 本地算分子式，不一致就丢弃，按主题色单色绘制）、`energy_2d`（各状态能量 → ΔH、Eₐ；过渡态必须是峰）、`titration_2d`（一元酸被强碱滴定，按电荷守恒二分法逐点解 pH；标出计量点与半计量点 pH = pKₐ）、`punnett_2d`（≤2 对基因，配子 / 基因型 / 表现型比例）、`pedigree_2d`（≤16 人；校验父母存在、性别与环，自动分代，外来配偶排在同胞组外侧）、`translation_2d`（编码链 / 模板链 → mRNA → 标准密码子表翻译，遇终止密码子停止）。计算在 `entities/tutorVisualization/chemistry.ts` / `biology.ts`，校验在 `normalizeScience.ts`，渲染在 `widgets/tutor/TutorChemistryFigure.tsx` / `TutorBiologyFigure.tsx`。是否发第二次请求由 `hasGraphableMath` 加上化学/生物关键词门控决定。细胞周期时间轴价值较低，未做。
   - **大学深度（schema v8，`visualization-generator/v8`，随 v0.4.0 发布）**：
     - **分布**：`distribution_2d` 增加 t / χ² / F（`logGamma`、正则化不完全 Γ / B 函数，`quantile` 二分求临界值；不存在的矩显示“不存在”，在 0 处无界的密度用 clipPath 裁切）。
     - **χ² 拟合优度检验** `chisquare_test_2d`（`chiSquare.ts`，统计 / 生物 / other 科目提供）：类别 + 观测数 + 期望比例或期望数；本地算 χ²、df、p、临界值与结论，期望数 < 5 时提示。
     - **滴定**：多元酸（Kₐ 数组 ≤3，须递减）或弱碱（K_b，用强酸滴定），按电荷平衡解 pH，每个质子一个计量点；只有 pH 与 pKₐ 相差 ≤0.15 时才标“pH ≈ pKₐ”，否则标“半计量点”。v7 存量行 `LegacyTitrationSetup` 由 `asTitrationSetup` 兼容。
     - **遗传**：`genetics.ts` 支持 X 连锁（`X^AX^a × X^AY`，子代按性别分列比例）、复等位（`I^AI^B`、`c^{ch}`，两个不同显性等位基因共显性）、`codominant`、常染色体 + X 连锁双基因；仅当基因型中有 `X^` 时 `Y` 才是 Y 染色体（`YyRr` 仍是孟德尔字母）；`traits[].alleles` 给等位基因命名（ABO → A/B/AB/O）。
     - **系谱遗传方式分析** `inheritanceAnalysis`：对 AD / AR / XD / XR / Y 连锁做穷举基因型回溯（完全外显、无新突变），给出“可能 / 排除”及经典判据和涉及成员（I-1 等）。
     - **转录翻译**：`direction`（书写方向，默认 5′→3′；序列自带 5′/3′ 标注时以标注为准）+ `start`（默认从第一个 AUG），模板链 5′→3′ 书写时先反向对齐；显示 5′ 非翻译区与 N–…–C 多肽。v7 存量行沿用旧读法。
   - **其它理科（schema v9，`visualization-generator/v9`，随 v0.4.0 发布）**：按科目只发送对应规则（`scienceFiguresFor` 返回各图族开关）。
     - **公式探索器** `formula_2d`（全科）：1–4 条曲线 + ≤6 个滑块参数；`entities/tutorVisualization/formula.ts` 用 mathjs 解析 + 白名单校验（只允许声明的变量 / 参数、常量与函数）后编译为闭包，无 eval；KaTeX 显示由 mathjs `toTex` 生成；改动参数时虚线保留原曲线，可一键还原。
     - **微积分**：`tangent_2d`（mathjs 符号求导，失败回退中心差分；可拖动切点，割线 h 滑块）、`riemann_2d`（左/右/中点/梯形，n 滑块，复合辛普森数值积分对比误差）、`taylor_2d`（逐阶符号求导得系数，阶数滑块 0–10；不可微的函数拒绝）。
     - **物理**：`forces_2d`（合力 / 平衡 / a = F/m，可画斜面并给出沿斜面与垂直分量）、`motion_2d`（分段匀变速 → x-t / v-t / a-t 三图，v-t 面积为位移，时间游标；路程按速度变号分段计算）、`optics_2d`（薄透镜 / 球面镜，实正虚负约定，三条特征光线经过或反向延长到像点，物距滑块）、`circuit_2d`（≤8 个电阻的串并联树，递归布局，等效电阻与各电阻 U / I / P）。
     - **统计**：`regression_2d`（最小二乘、r、R²、残差标准误、斜率 t 检验，置信带 / 预测带）、`confidence_interval_2d`（σ 已知用 z，否则 t(n−1)，置信水平滑块）。
     - **化学**：`kinetics_2d`（0 / 1 / 2 级积分速率方程 + 线性化图，标出逐个半衰期）、`arrhenius_2d`（由 (T, k) 数据拟合 Eₐ 与 A，或直接给 Eₐ、A）。
     - **生物**：`enzyme_2d`（米氏曲线 + 双倒数图，竞争 / 非竞争 / 反竞争 / 混合抑制的表观常数）、`population_2d`（指数 / 逻辑斯谛，拐点 t*、最大速率 rK/4、dN/dt–N 图）。
     - **计算机**：`sorting_2d`（冒泡 / 插入 / 选择 / 归并 / 快排逐步回放，比较与写入计数）、`bst_2d`（按插入顺序建树，插入数滑块，中 / 前 / 后 / 层序遍历与高度）。
     - 计算在 `formula.ts` / `physics.ts` / `models.ts` / `algorithms.ts`，校验在 `normalizeSubjects.ts`，渲染在 `TutorFormulaFigure` / `TutorPhysicsFigure` / `TutorModelFigure` / `TutorAlgorithmFigure`（共用 `PlotFrame` + `plotUtils`）。门控：各图族关键词 + 理科科目讲解中出现带 `=` 的公式（`looksLikeFormulaText`）。科目画像：物理 / 微积分 / 计算机升至 r2，并为各理科补充“讲解中写明可画图数据”的课时指引。
   - **第 3 层 联网参考图片（默认关闭，设置页开启）**：只在化学/生物课时、且本主题没有课程原图时，提供“查找参考图片”按钮（学生点击才联网）。`reference-image-query/v1` 只让模型给搜索词（PubChem 需附分子式，与 PubChem 返回值核对）；`infrastructure/referenceImages/sources.ts` 检索并下载；可选 `reference-image-check/v1` 视觉核对（`ChatMessage.images` 以 OpenAI content 数组发送；模型不支持图片时自动降级为“未核对”）。图片与来源 / 许可 / 作者存入 Dexie **v14** `referenceImages` / `referenceImageBlobs`（每主题缓存，可逐张移除，随项目删除；不纳入导出，可重新获取）。

8. **Markdown 表格渲染（Phase 3.1.1 已实现并验证，随 v0.2.6 发布）**：共享 `RichText` 新增 GFM pipe table block（`shared/lib/markdownTable.ts` 纯解析 + `markdownText.ts` block + `RichText` 语义化渲染）；cell 复用现有 inline 文本/code/LaTeX；宽表仅在容器内横向滚动；普通 `|x|` 不误判；code fence / block math 内不解析表格。Tutor Lesson Prompt 升 **v3**（保留 v1/v2）规范表格输出。旧缓存中的多行 Markdown 表格**无需重新调用 AI 即可正确显示**；Prompt v3 经 `contentHash` 使旧课时自然重生成一次。未改 `TUTOR_LESSON_VERSION` / Visualization schema / Dexie。

9. **划词浮层定位修复（Phase 3.2 已实现并验证，随 v0.2.6 发布）**：`SelectionTranslator` 不再一次性写入 `top: rect.top - 8` + `translate(-50%,-100%)`，改为纯函数 `computeSelectionPopupPosition`（`shared/lib/popupPosition.ts`）按**真实浮层尺寸**优先上方、空间不足翻转下方、上下都不足取较大侧并给出 `maxHeight`，左右 clamp 到视口；用 `ResizeObserver` + `useLayoutEffect` + `window.resize` + 捕获阶段 `scroll` + `visualViewport`（resize/scroll）在内容/视口/滚动变化后重新定位，监听器与 observer 在卸载时清理；滚动使选区完全离开视口时关闭浮层。移动端仍为底部浮层但以 `visualViewport` 为界。未引入新依赖、未改 Portal、未改动全站其它浮层。

### 已知限制

- 需自备 AI API；不配置时仅上传与本地处理可用（状态是 `no-provider`，不是 failed）。
- 数据绑定浏览器 origin；换地址/清站点数据会看不到数据，需用「数据管理 → 导出数据」备份。
- 数学等价判断有边界，极复杂表达式返回「无法自动判定」，不计入成绩。
- OCR 质量取决于图片清晰度；手写内容提取效果有限。
- 课程分析为项目级（覆盖该项目全部已处理文档），非逐文档结果，也非章节级。
- 数学可视化范围受控：`eigen_2d` 只支持 2×2 实矩阵的**实**特征值/特征向量；复特征值、3×3、Jordan 形、动画、拖拽均不支持，会安全回退为普通 LaTeX，不绘制误导性的实特征方向。
- 化学 / 生物图范围受控：滴定只支持 ≤三元酸 + 强碱、一元弱碱 + 强酸（不含活度校正）；棋盘格最多两对基因、至多一个 X 连锁基因，不含连锁交换 / 上位效应；遗传方式分析假设完全外显；同分异构体无法自动区分（不计分并提示）；不画 3D 结构、反应机理、细胞 / 器官示意图（这类交给课程原图或联网参考图片）。
- 冷启动时外观偏好（明暗 / 配色）要等 `UserProfile` 读出后才应用，可能有一帧默认配色。
