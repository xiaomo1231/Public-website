# AGENTS.md — 项目记忆

面向 opencode 的项目上下文。开始任何任务前先读本文件，再读 `README.md` 与 `docs/architecture.md`。

---

## 1. 项目是什么

**Local-first AI Learning Platform**，面向理工科与医学本科生（微积分 / 线代 / 物理 / 化学 / 生物 / CS / 统计；医学以临床与口腔的大一大二基础课为主）。

纯前端 PWA，**无第一方后端**。用户上传课程资料（PDF / DOCX / PPTX / 图片 / 文本），由**用户自己配置的 AI** 把资料转成结构化知识，再通过**提问驱动式导师**、自适应测验和错题本来学习。

核心闭环：

```text
课程资料 → AI 理解 → 知识结构 → 题目驱动教学 → 学生作答
→ 自适应难度 → Quiz → 错题本 → 错误分析 → 针对性再练
```

**这不是"AI PDF 总结工具"。** 教学以题目为主要载体，而不是长篇总结。

当前版本：**V0.8.1（0.8.1）**。

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
│                                 │  47 张表，Dexie v19
├─ localStorage ──────────────────┤  UI 语言镜像（避免首帧语言闪烁）+ 符号键盘开合状态
├─ 浏览器内存 ────────────────────┤  仅当前任务文本 → 用户配置的 AI API
└─────────────────────────────────┘
```

- 原始文件字节存在 **IndexedDB 的 `documentBlobs` 表**（`bytes: ArrayBuffer`），不在 OPFS。
- `src/infrastructure/opfs/opfs.ts` 是一个**未被接线的可选快速路径**（全项目无 import）；`Document.hasBlob` 的注释也写明「OPFS migration can come later」。不要以为文件已落 OPFS。
- localStorage 只保存 UI 语言（`ai-learning:ui-language`）与符号键盘按模式的开合状态（`ai-learning:symbol-bar:<mode>`，仅本机偏好）；外观偏好（界面风格 + 明暗模式 + 配色主题）存在 `UserProfile`（IndexedDB）。

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
- **输出上限（最大 Token 数）**：设置有两种模式（`AISettingsRow.maxTokensMode`）：「使用模型允许的最大值」（`model`，**新安装默认**，`DEFAULT_AI_SETTINGS.maxTokens` = 8192 作后备）与手动（`manual`，范围 64–128000；**旧行没有该字段 ⇒ 视为 manual，保留原数字**）。模型上限 `infrastructure/ai/outputLimit.ts` 的 `resolveOutputLimit`：优先 `/models` 元数据里的输出字段（`max_output_tokens` / `max_completion_tokens` / `output_token_limit` / `top_provider.max_completion_tokens`，**不用 `context_length` 推测**，`parseModelOutputLimits`，按 Base URL 存在 `modelOutputLimits`），其次 `presets.ts` 的 `KNOWN_MODEL_OUTPUT_LIMITS`（只收官方文档写明的：gpt-4o / gpt-4o-mini 16384、gpt-4-turbo / gpt-3.5-turbo 4096、deepseek-v4-pro 384000；MiniMax-M3、当前 Qwen、deepseek-flash 文档未写，**故意不收**），都没有则用手动数字。`AIService` 构造时 `resolveProviderConfig` 得出 `maxOutputTokens`（实际上限）与 `modelMaxOutputTokens`；任何请求的 `max_tokens` 都不超过模型上限（`AIService.cap` + provider 请求体再夹一次）。**始终发送 `max_tokens`**（不发时部分服务商用很小的默认值，如 DeepSeek 4096）。
- 流式走 SSE；超时语义是**静默超时**而非总时长（长课程分析不被误杀）。非流式 `chat()` 无法观测进度，给连接超时 + 300 s 总时长（`nonStreamingTimeoutMs`）。流结束时冲洗解码器并解析残留缓冲，多行 `data:` 以换行拼接；流中断网包装为 `PROVIDER_UNAVAILABLE`。日志中的端点只记 origin + path（`redactUrl`）。
- 类型化错误：`MISSING_API_KEY / MISSING_BASE_URL / MISSING_MODEL / AUTH_FAILED / RATE_LIMITED / TIMEOUT / PROVIDER_UNAVAILABLE / INVALID_RESPONSE / INVALID_JSON / ABORTED`，再由 `shared/lib/aiErrors.ts` 映射为可操作提示。

### 生成控制：暂停 / 继续 / 停止

- 共享控制器 `shared/lib/generationControl.ts`：`createGenerationRun()` → `{ signal, shouldContinue(), requestPause(), stopNow(), finish(), onStateChange }`，状态 `running → pausing → paused | stopped | done`。服务只接收只读的 `GenerationControl { signal, shouldContinue() }`（可选参数；旧的 `signal` 选项经 `resolveControl` 仍可用），**每部分开始前**查 `shouldContinue()`，`signal` 透传到 AIService → fetch（类型化 `ABORTED`）。`GenerationPausedError`（code `GENERATION_PAUSED`）= 被暂停、无结果可返回，不是失败。React 用 `useGenerationRun()`；按钮统一用 `shared/ui/GenerationControls.tsx`（放在进度条右侧）。
- **多部分生成 → 暂停 / 立即停止 / 继续**：暂停 = 不再调度新部分，进行中的部分完成并保存（显示「正在完成当前部分…」→「已暂停（已完成 x / y）」）；立即停止 = 中断进行中的请求。**被中断的部分绝不写成 failed、不计入失败**；继续只做剩下的部分。覆盖：作业完整讲解（`resume`；暂停的「全部重新生成」记住 `forceSince`，继续不重写已重写的部分）、作业识别（分批结果按 文档 + 批次哈希 存内存，`resumeSet` 只请求剩余批次）与提示 / 解法、教授答案生成、课程词汇释义（每批即存）、课本词表导入与短语卡（已读部分存内存）、大纲 AI 匹配（每批即存）、模拟问诊情景提取（按段落哈希存内存）、测验分批出题与口试（见 §6 Quiz）、课程分析（见 §5）。
- **单次请求 → 停止**：导师课时生成 / 重新生成（保留旧课时；被停止的共享 in-flight 请求不会传给其他等待者）、按幻灯片学习、交互导师回合、划词问答（含浮动窗口，问题放回输入框）、错题分析（恢复原 `analysisStatus`）、简答 / 填空 AI 核对（取消这次提交，不记作答）、作业单题提示 / 解法 / 复习讲解 / 检查答案 / 逐题问答、参考图片检索、问诊病人回合与总结评分、得分点提取、大纲 AI 摘抄。停止后原有内容不变、不弹错误。
- **状态不卡住**：作业新增 `HomeworkStatus 'paused'`（首次识别或生成提示时暂停；重新识别已有题目的作业暂停时恢复原状态）；测验新增 `QuizStatus 'paused'`；课程分析暂停时恢复原行（无旧行则删除 `analyzing` 行），`recoverInterruptedAnalyses` 不会把它标为失败。只存在内存的进度（识别批次、课程分析部分、词表 / 短语 / 情景部分）刷新页面后丢失，界面已提示。

### Prompts

- 每个 prompt 在 `src/infrastructure/ai/prompts/<family>/v1.ts`，导出 `VERSION` / `buildSystemPrompt()` / `buildUserPrompt()`。
- `prompts/index.ts` 是唯一注册表。升级 = 加 `v2/` 并切换 import，**调用点不变**。
- **划词问答 `contextual-tutor/v3`**：在 v2 上新增 `walkthrough` 语境与可选的 `history`（最近 6 轮）；lesson / homework 语境且无历史时与 v2 逐字相同。不缓存，故直接切换。
- **科目画像 `subject-profile/v1`**：按项目科目（`calculus / linear_algebra / discrete_math / physics / chemistry / biology / medicine / cs / stats / other`）给出记号、推理方式、答案格式与常见错误；由 `withSubject()` 追加到教学/判分/分析类 system prompt（课程分析、增量主题分析、导师课时、交互导师、划词提问、测验、错题分析、作业提示/解法/复习讲解/检查答案/逐题问答、幻灯片学习）。`other` 不追加。科目一律由服务端从项目读取（`services/projectSubject.ts`），**不由 UI 传入**。化学记号用 mhchem `$\ce{...}$`（`Math.tsx` 已加载 `katex/contrib/mhchem`）。
- **外语课 `language` + 目标语言**（`Project.targetLanguage`，小写 BCP-47 主标签 `de` / `hu` / …，只在 `subject === 'language'` 时生效）：用于国际学生的医学德语 / 医学匈牙利语等语言课。画像要求：讲解用用户选择的「讲解与题目语言」（`UserProfile.questionLanguage`），目标语言的词与例句原样且拼写精确（重音、大小写），德语名词带冠词与复数，匈牙利语按词根 + 后缀切分并标元音和谐；医患对话只是沟通练习，沿用医学安全边界；不出科学图。科目推断 `inferCourse(name)` 先判语言课再判医学（German / Deutsch / 德语 → `de`，Hungarian / magyar / 匈牙利语 → `hu`；单独的 "Medical Terminology" 仍归医学）。缓存版本后缀 `:language-<lang>`。
- **医学考试体系**（`Project.examStyle: 'domestic' | 'international'`，每门课单独设，新建 / 编辑课程时只对医学显示）：未设置时按课程已处理资料的主要语言自动判断（以非中文为主 → `international`，中文或尚无资料 → `domestic`），手动选择优先。`international`：英文 + 拉丁解剖学名（Terminologia Anatomica），人名命名映射到解剖学名，题型为结构辨认、口试式完整描述（组成 / 毗邻 / 神经 / 血供 / 淋巴 / 发育）与英文选择题，不出名词解释 / 简答 / 论述；版本后缀 `:medicine-intl`。`domestic` 与以前逐字相同（已有缓存不失效）。科目上下文统一由 `services/projectSubject.ts` 的 `loadProjectSubjectContext()`（`{ subject, targetLanguage?, examStyle? }`）读取，`withSubject` / `subjectPromptVersion` 接受该上下文。
- **外语课练习提示词**：`quiz-generator/v7` 在 v6 上只对外语课（`withSubject` 前由 `buildSystemPrompt({ languageDrills: { targetLanguage } })` 追加）描述 `article_gender`（仅德语）与 `paradigm_table`，其它科目的 system / user 提示与 v6 逐字相同（v6 保留）。`vocab-list-split/v1`（课本词表拆分为 term / gloss / article / plural / lesson）、`phrase-extract/v1`（对话短语 prompt / phrase / kind / sourceChunkId），均用 `untrustedContentWrapper` + `securityFooter`，输出都经本地校验后才展示、确认后才落库。
- **模拟问诊提示词**（仅外语课）：`interview-scenario/v1`（`extract` 从课本摘抄情景卡 / `generate` 根据课程对话写一个 A1/A2 练习情景）、`interview-patient/v1`（AI 扮演病人只按情景卡回答，同一次调用对学生这句做必问问题分类 + 可选语言提示）、`interview-summary-check/v1`（英语总结逐条信息核对 + 交流估计）。三者都用 `untrustedContentWrapper` + `securityFooter`，并附医学安全边界（`subject-profile/v1` 导出 `MEDICAL_BOUNDARIES`）；不缓存，无版本折叠。
- 画像可带 `boundaries`（渲染为 `Boundaries (always apply):`，每次都追加）：目前只有**医学**使用——这是教育不是医疗，不对真实个人做诊断、不给治疗或剂量建议，遇到个人健康问题建议就医；例题中的参考值与剂量仅为示意。医学画像中英（拉丁）术语并列、解剖学姿势、FDI 牙位、名词解释 / 简答 / 论述的答题格式。科目推断：解剖 / 组织胚胎 / 生理学 / 病理 / 药理 / 口腔 / 牙等归为医学（在生物之前判断；“医用化学 / 医用物理 / 医用高数”仍归化学 / 物理 / 微积分，“植物生理学”仍归生物）。
- 画像可带**仅课时用**的 `lesson` 指引，只有 `withSubject(..., { forLesson: true })`（导师课时）才追加：化学/生物要求把可画成图的事实写明（分子名+分子式、各状态能量、滴定浓度/体积/Kₐ、亲本基因型、家系、DNA 序列），并在课程资料有图时引导学生看原图。
- 带缓存/可比对的产物把科目画像折进版本：`subjectPromptVersion(base, subject)` = `<base>+subject-profile/v1:<subject>`，某科画像修改时在 `PROFILE_REVISIONS` 里给**该科**加修订号（追加 `.rN`；当前化学 `.r3`、生物 `.r2`、概率统计 `.r2`、物理 `.r2`、微积分 `.r2`、计算机 `.r2`——均已按大学深度改写或补充课时指引），只让该科的缓存失效（CourseAnalysis、增量 Topic、TutorLesson、SlideLesson、作业复习讲解与检查答案），不会让其它科目全部重生成。
- **课程大纲提示词**：`syllabus-topics/v1`（本地解析到的考点 < 5 时由学生手动触发；只许逐字摘抄文档里的考点，`readAiSyllabus` 把每条与文档文本（合并空白后）做子串核对，找不到的丢弃，绝不改写或补全）；`exam-topic-match/v1`（闭集匹配：课程主题以短 id `t1…` 给出，`readAiMatches` 只保留列表内的 id、每个考点 ≤3 个，空结果保留本地匹配）。两者都用 `untrustedContentWrapper` + `securityFooter`，不缓存、不加科目画像。
- **教授出题习惯 `question-style/v1`**：输入 = 本批题目单元（闭集标签 `U1…`，每单元 ≤600 字，注明来源类型 / 文件 / 题号）+ 当前档案（短 id `h1…`，学生条目标 `[locked]`）；输出 `{items:[{id|null, category, statement, evidence:[{unit, quote}]}], remove:[]}`（≤12 条）。带科目画像，题目与当前档案都用 `untrustedContentWrapper` + `securityFooter`；不缓存。同文件导出 `professorStyleSection(habits)`：`quiz-generator/v7`（插在末行 `Respond with the JSON object only.` 之前）、`practice-generate/v1`（附在末尾）与 `oral-exam/v1`（插在末行之前）新增可选字段 `professorHabits`，**不传时提示与以前逐字相同**（不缓存，故未升版本，有测试）。
- **口试提示词 `oral-exam/v1`**：为一个抽到的题目写考官提问、Markdown 参考提纲、6–10 条得分点（按该类题目完整描述应有的结构：解剖为 组成 / 毗邻 / 运动或功能 / 作用肌 / 神经 / 血供 / 静脉与淋巴 / 发育 / 临床，不适用的跳过；每条以类别加冒号开头）与 2 个追问（各带简短参考答案与 1–3 条得分点），`sources` 只能引用 `[chunk:…]` 标签中的 id。带科目画像（含 `medicine-intl`）；考点文本、课程主题与资料均用 `untrustedContentWrapper` + `securityFooter`；不缓存。

### 安全模型

- API Key：**AES-GCM 加密存储**，密钥为不可导出设备密钥（`cryptoKeys` 表）。兼容旧明文并自动迁移（schema v6）。
- 日志：`logger` 递归脱敏 `apikey|api_key|password|secret|token|authorization|bearer`；循环引用标记 `[CIRCULAR]`。
- Prompt 注入：所有嵌入文档/作答的 prompt 用 `untrustedContentWrapper` 包裹 + `securityFooter`（覆盖 `document-analyzer`、`quiz-generator`、`mistake-analyzer`、`tutor/*`）。
- AI 输出：`parse → validate/normalize → 业务逻辑 → 落库`；不可用则抛错，**不落库**。
- 渲染：无 `dangerouslySetInnerHTML`；Markdown / LaTeX 按文本渲染；CSP 友好（无 eval、无远程脚本）。
- 明确边界：邀请码是**本地访问门，不是安全边界**；设备密钥**不能**防御同源脚本。
- **AI 用量 / 余额 / 模型列表**：余额与模型列表请求只发往用户配置的 Base URL（DeepSeek 余额为其 origin 下的 `/user/balance`）；OpenAI 管理员密钥（`sk-admin-…`，加密存储，导出剥离）只发往固定的 `api.openai.com` Costs 接口，绝不发往自定义 Base URL。用量统计只存 token 计数，不存内容。
- **联网参考图片（默认关闭）**：唯一会联系 AI 服务商以外主机的功能。只访问 `pubchem.ncbi.nlm.nih.gov` / `commons.wikimedia.org` / `upload.wikimedia.org`（白名单，仅 https），只发出搜索词；图片只收 PNG/JPEG/GIF/WebP（不收 SVG）、≤3 MB；Commons 只收公有领域 / CC0 / CC BY / CC BY-SA；外链 `rel="noopener noreferrer"`。

---

## 4. 数据模型（按域）

| 域           | 实体                                                                                                                                                                                                                                   |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 身份/配置    | `UserProfile` `AISettingsRow` `InviteKeyRecord` `CryptoKeyRow`                                                                                                                                                                         |
| 项目         | `Project`                                                                                                                                                                                                                              |
| 内容         | `Document` `DocumentBlobRow` `DocumentChunk` `ProcessingJob`                                                                                                                                                                           |
| 知识结构     | `CourseAnalysis` `Topic` `Concept` `Formula` `CourseSymbol` `Example` `CourseExercise` `Prerequisite`                                                                                                                                  |
| 教材结构     | `CourseStructure` `CourseStructureNode`（章节唯一真相，扁平 + `parentId`）                                                                                                                                                             |
| 教学         | `TutorLesson`（缓存课时）`TutorSession`（交互会话）`TranslationEntry`                                                                                                                                                                  |
| 上下文       | `CourseContext`（教授教学风格、班级进度、note/lecture 关联、`questionHabits` 教授出题习惯档案）                                                                                                                                        |
| 视觉         | `VisualSource` `VisualSourceImage` `ReferenceImage` `ReferenceImageBlobRow`（联网参考图片缓存，Dexie v14）                                                                                                                             |
| 教授练习     | `PracticeSet` `PracticeQuestion` `PracticeAttempt`                                                                                                                                                                                     |
| 练习         | `Question` `QuestionAttempt` `Quiz` `KnowledgeMastery`                                                                                                                                                                                 |
| 复习         | `ReviewCard`（复习卡片 / 间隔重复，Dexie v15）                                                                                                                                                                                         |
| 单词         | `VocabCard` `VocabBook` `VocabEntry` `VocabReview`（背单词，Dexie v16；**进度全局、不带 projectId**，课程词书带 `projectId`）                                                                                                          |
| 作业完整讲解 | `HomeworkWalkthrough`（每份作业 × 语言一行，分部分缓存）`WalkthroughNote`（保存的划词问答，Dexie v17）；练习作业 = `HomeworkSet.kind: 'practice'` + `parentSetId`，题目带 `HomeworkQuestion.practice`（见 §6「做练习题」，未升 Dexie） |
| 模拟问诊     | `InterviewSession`（外语课口试问诊：情景卡 + 对话 + 英语总结 + 结果，Dexie v18 `interviewSessions`）                                                                                                                                   |
| 作答图片     | `HomeworkAnswerImage`（作业作答的手写照片 / 手写板页面，Dexie v19 `homeworkAnswerImages`）                                                                                                                                             |
| 错误         | `Mistake`                                                                                                                                                                                                                              |

关键约定：

- 所有业务表带 `projectId` 与 `[projectId+...]` 复合索引；未知 projectId 抛 `NotFoundError`。
- `TutorLesson.contentHash` 是主题指纹（含 `chapterId`/`sectionId`/`promptVersion`/notes+transcript `contextHash`），课程重析后自动失效重生成。
- `SourceReference` 必带 `chunkId`，引用必须来自**真实分块**，杜绝 AI 编造出处。
- `Document.syllabus?: SyllabusData`（仅 `materialType: 'syllabus'`，**未升 Dexie**，随文档导出 / 恢复）：`{ scopes: { id, label, kind: midterm|final|other, topics: { id, text, order, group?, sourceChunkId?, page?, source: local|ai|manual, topicIds?, matchedBy?: local|ai }[] }[], extractedAt, method: local|ai, editedAt?, matchedAgainst?, matchedAt? }`。
- 章节层级**只有** `CourseStructure`/`CourseStructureNode` 一处；Topic / chunk / NoteLink / LectureChunkLink / PracticeQuestion 只保存 `chapterId`/`sectionId` 引用，不复制章节树。

### 外观（Appearance）——三个独立维度

```text
uiStyle:    lecture（默认）| lab        （<html data-ui-style=…> → 结构 / 中性色 / 字体 / 圆角 / 阴影）
mode:       light | dark | system      （themeStore 解析 → <html>.dark + color-scheme）
colorTheme: default | pinkAqua | warmOrange | academic
                                       （<html data-color-theme=…> → 只决定强调色）
```

- 三者都存在 `UserProfile`（`uiStyle` / `theme` / `colorTheme`），经 `useUiStyle()` / `useThemePreference()` / `useColorTheme()` 即时应用 + 持久化；**不是**第二套 localStorage key。`index.html` 预置 `data-ui-style="lecture"` 避免首帧闪烁。
- **界面风格**：`lecture`（讲义：暖纸色、衬线标题 `font-heading`、顶部导航 `TopNav` + 课程二级导航条、整页滚动、规则线代替卡片）；`lab`（精密实验室：冷色细线、毫米网格背景、方角、无阴影、左侧编号导航 `Sidebar`、等宽读数）。旧的"圆角卡片 + 侧栏"外观已移除。
- **Token 分层**：`globals.css` 的 `[data-ui-style]` 块定义中性色（background / foreground / card / muted / border / input…）、圆角刻度、阴影、`--font-heading`、lab 的 `--grid-*`；配色块只定义强调色族（primary / primary-strong / secondary / accent / ring / destructive）。因此任意风格 × 配色 × 明暗都成立。
- Tailwind 变体 `lecture:` / `lab:`（`tailwind.config.ts` 插件）用于两种风格结构不同之处；页面只用变体 + token，**不另写两套组件**。
- 颜色定义集中在 `features/theme/colorThemes.ts`（原始 hex，仅供预览）+ `shared/styles/globals.css`。**组件不得硬编码颜色**（状态色 emerald / amber 沿用 Tailwind 调色板，不进主题 token）。
- 填色且承载文字的表面（Button default / Badge default / Tooltip / 品牌标记）用 `--primary-strong`；`--primary` 留给 icon、链接、进度条、柔和状态、focus ring。
- 主题切换是纯 presentation：**不触发 AI、不使 CourseAnalysis / TutorLesson / CourseContext 失效**。
- 对比度由 `tests/themeContrast.test.ts` 从真实 CSS 计算并断言（风格 × 明暗 × 配色共 16 组；正文 ≥4.5:1，填色按钮 ≥3:1）。
- 测验单选 / 多选支持键盘：A–F 或 1–6 选择；焦点在未选中的选项上按 Enter / 空格是选择该项；焦点在已选中的选项上、或焦点不在按钮上时按 Enter 提交（焦点在输入框、按住修饰键、菜单或对话框内时不生效；`widgets/quiz/quizKeyboard.ts`）。

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
- **文件大小**：无固定产品上限。`MAX_FILE_BYTES` = 2 GB 只是浏览器单次读入 ArrayBuffer 的技术上限；保存前 `ensureStorageFor`（`infrastructure/files/storageSpace.ts`）用 `navigator.storage.estimate()` 检查剩余配额（文件 × 1.2 余量，浏览器无法估算时放行），保存事务遇 `QuotaExceededError` 转为“存储空间已满”提示（事务回滚，不留半成品）。数据管理的存储统计按 `documents.sizeBytes` 累加，不再把所有原文件读进内存；导出用 `exportFile()` 逐个文件拼接 Blob（内容与 `JSON.stringify(exportAll())` 相同），避免超大字符串。
- **从备份恢复（完整替换）**：设置 → 数据管理「从备份恢复」。`DataManagementService.inspectBackup(file)` 只读检查并返回摘要（备份时间、数据版本、项目 / 文档 / 文件与字节数 / 测验 / 错题 / 单词 / 复习卡片、被忽略的表、缺主键而丢弃的行、无法恢复的文件）；`restoreFromFile(file, { onProgress })` 先检查，再用 `ensureStorageFor(文件字节 + 表数据)` 查配额，然后在**一个 rw 事务**里清空除 `cryptoKeys` 外的全部表并写入备份：任何失败（截断 / 坏 base64 / 写入错误 / 配额满）整体回滚，原数据不变。文件用 `infrastructure/backup/backupReader.ts` 流式读取（按切片 + 流式 `TextDecoder`，逐行 `JSON.parse`，每个文件的 base64 分段校验 / 解码），不会整份读成字符串；读文件经事务对象的 `waitFor`（Dexie.waitFor 的机制）保持事务存活，写入经 `tx.table()`（扫描中大量原生 await 后 Dexie 的隐式事务 zone 不可靠）。数据版本高于当前 `db.verno` 拒绝（`BACKUP_NEWER_VERSION`）；未知表忽略并报告；`user` / `settings` 只收 `singleton`。**API 密钥不在备份里**，恢复后为空（界面提示重新填写，完成后整页重新加载）；`referenceImages` / `referenceImageBlobs`（联网参考图片缓存，不导出）恢复时清空。导出的文件条目从本版起带 `projectId`（旧键不变）；旧备份缺 `projectId` 时按 `documents` / `visualSources` 行补回，补不回的文件跳过并计数。导出覆盖的表在 `EXPORTED_TABLES`，有意不导出的在 `NOT_EXPORTED_TABLES`（`cryptoKeys` / `referenceImages` / `referenceImageBlobs`），测试保证每张表都在其中之一。没有大小上限（单个文件仍受浏览器 ArrayBuffer 上限约束）。
- 标题规则集中在 `infrastructure/files/headingHeuristics.ts`（`pdfExtractor` 与 `structureDetection` 共用）：任意文字的全大写标题（`BEMUTATKOZÁS`）、`N. lecke – …`、罗马数字单元 `III. …`、`Lektion / Lesson / Unit / Kapitel N`；去掉在 ≥50% 页面重复的页眉页脚、目录引导点行与答案页标签；已出现过的编号无标题重复时并入当前章。
- 结构识别只在 `materialType === 'textbook'` 时执行；无信号时退化为单个 `General Course Material`（`confidence: 'low'`），**不发明章节**。

### 课程内容持久化与 freshness（`CourseContent`）

**没有 `content/` 目录、没有 JSON 内容文件、没有第二套数据库。** 课程分析结果本来就持久化在 Dexie（`courseAnalyses` + `topics/concepts/formulas/symbols/examples/courseExercises/prerequisites`），`CourseContentRepository` 只是其上的逻辑聚合层。

四个版本概念**不可合并**：

| 概念                                              | 含义                                                           | 存放                            |
| ------------------------------------------------- | -------------------------------------------------------------- | ------------------------------- |
| Dexie `verno`                                     | 数据库结构                                                     | `infrastructure/db/database.ts` |
| `CourseAnalysis.promptVersion`                    | 产出该结果的 prompt 版本                                       | 分析行                          |
| `CourseAnalysis.schemaVersion`                    | 分析结果的**数据形状**版本（`COURSE_ANALYSIS_SCHEMA_VERSION`） | 分析行                          |
| `CourseStructure.version`                         | 教材结构修订号（粗粒度）                                       | 结构行                          |
| `CourseAnalysis.derivedFromStructureVersion/Hash` | 该结果派生自哪个结构修订                                       | 分析行                          |
| `CourseAnalysis.sourceHash`                       | 分析**输入内容**指纹                                           | 分析行                          |

- `sourceHash` 是**内容指纹**（chunk 文本 + order + 页码 + chapterId/sectionId + document id/name/size），**不含 `processedAt`、不含 chunk id**。因此「原样重处理」不会误判为内容变化。
- freshness 判定（`evaluateFreshness`，纯函数）只看：`sourceHash` / `promptVersion` / `schemaVersion` / 结构（优先 `structureHash`，旧行回退 `structureVersion`）/ `status`。期望的 `promptVersion` 按项目科目计算（见 Prompts「科目画像」），所以**改科目 ⇒ `prompt-changed`**。**明暗模式、配色主题、UI 语言、Class Progress、练习记录都不参与。**
- `staleReason` / `staleAt` **只是注释**，不是 freshness 输入；`markStale()` 不会单独把结果变成 stale。
- `reseedProject` 是**单事务原子替换**：AI 失败时旧分析原样保留。
- **`DocumentAnalysisService.analyzeProject()` 仍是项目级**（全量路径不变），但**读完全部分块**：`entities/courseContent/analysisInput.ts` 把输入按章节切成每份 ≤ `ANALYSIS_SEGMENT_CHARS = 40_000` 字符的部分（章节放不下按小节，再按分块），一份放得下时只发一次请求、提示与以前逐字相同；多份时每份在 `document-analyzer/v2` 的用户提示里加一段“第 i/n 部分，只分析这一部分”（单份提示不变，故未升版本），并发 2 请求，`entities/courseAnalysis/mergeAnalyses.ts` 合并：概念 / 公式 / 符号 / 例题 / 习题 / 先修按名称或内容去重并合并出处；同名主题若两部分同属一章（长章被切开）则合并来源，否则后者改名为「名称 · 部分标签」并同步该部分的 `topicNames`。任一部分失败 ⇒ 整次失败、恢复旧分析。主题的章节位置优先取其最早的已校验来源分块，无有效来源才回退到文字重叠（每个分块只分词一次）。分析行写入 `inputCoverage: 'complete'` 与 `inputParts`；旧行没有该标记且旧限制（每份前 200 块、合计 5 万字）确实会截断当前材料时，freshness 报 `input-truncated`（分析面板提示“只读到了教材开头”），短课程不受影响、不会重跑。
- **暂停课程分析**：结果只能整体提交。暂停 = 不再请求新部分（并发 2 的进行中部分完成），立即停止 = 中断；抛 `GenerationPausedError`，旧分析不动。已完成部分按 提示词版本 + system/user 提示 存在模块内存（≤64 条，全量成功后清空），「继续」（`ensureAnalyzed` 沿用暂停时的 force）只请求剩余部分；刷新后丢失（分析面板提示）。运行控制按 projectId 登记（`courseAnalysisRun` / `pausedCourseAnalysis`），上传流程启动的分析也能在分析面板暂停。增量 `executeIncrementalScope` 每个主题前检查，暂停时不提交。
- **章节级增量更新已实现**（见 §5.1）：`analyzeScope({type:'chapter'|'section'})` 走**局部**路径，不调用 `analyzeProject`，不调用 `deleteByProject`。
- 只有 **upload / processing 流程**与分析面板的手动「重新分析」（`ensureAnalyzed(projectId, { force: true })`）会调用 `CourseContentService.ensureAnalyzed()`（带 module 级 in-flight 去重，手动重析同样提交练习题重连）；**打开任何页面都不会触发课程分析**。已有 ready 分析时重析过程中不改动该行（进度只走回调）；启动时 `recoverInterruptedAnalyses()` 把超过 5 分钟、本页无进行中请求的 `analyzing/pending` 行标为 failed（「上次分析被中断」）。增量提交只有在所有计划内主题都成功且范围外无待办时才推进 `sourceHash`；同名主题在全量分析中按章节合并或改名，主题 id 按位置传递。未配置 API Key 时是 `no-provider`，**不**标记为 failed。

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

### 5.2 课程大纲 / 考点清单（`materialType: 'syllabus'`）

- **资料角色** `syllabus`（「课程大纲 / 考试题目」）：照常提取 + 分块，但和 `homework_answer` 一样是**只作参考的资料**（`isReferenceOnlyMaterial()`）：不进课程分析输入与 `sourceHash`（`selectAnalysisDocuments` / `analyzeProject`）、不作测验片段（`loadQuizCandidates` / `collectSourceSnippetsDetailed` 按分块的 `materialType` 跳过）、不作导师兜底来源（`collectTopicSources`）、不进课程词汇（走 `selectAnalysisDocuments`）、不进幻灯片学习列表、不计入首页资料数。不做教材结构识别。
- **资料角色** `walkthrough_import`（「导入的讲解」，作业完整讲解「导入讲解」上传的文件）：同样是只作参考的资料（`isReferenceOnlyMaterial()` 返回真，排除规则与 `syllabus` 相同），保存原文件供「查看原文件」，见 §6「作业完整讲解」。
- **角色建议**：上传对话框按文件名（syllabus / handbook / announcements / topics of the examination / 考试大纲 / 教学大纲…，`looksLikeSyllabus`）提示「标为课程大纲」，由学生确认（`useBatchUpload.setMaterial`）；考点清单页再按文件名或**第一页**文字列出已处理的教材 / 笔记 / 文字稿供确认，`SyllabusService.markAsSyllabus` 单事务改角色（文档 + 分块）、删除该文件的教材结构、清掉分块的章节字段并解析考点。
- **本地解析**（`entities/syllabus/parse.ts`，处理流水线中对 syllabus 文档自动执行；学生编辑过（`editedAt`）则重处理时保留）：考点标题（含 topic(s) / theses / 题目 / 考点 / 复习提纲…）下，编号 / 项目符号行与逐行条目都是考点；普通考试标题（exam / midterm / final / 期末…，须是标题分块或大写行）下只认编号 / 项目符号行，读起来像规章（students / must / should / 必须…）的丢弃。小写开头、括号未闭合、以逗号等结尾的续行（含跨分块）并入上一条；`Musculoskeletal Anatomy` 式标题行与含 topics 的短行是组名（`group`，仅显示），连续 ≥3 行标题式则当作考点。考点保留原文、起始分块 id 与页码；scope 的 `kind` 由标题判断（semifinal 归 final），少于 2 条的 scope 丢弃。
- **AI 提取**：本地考点 < 5（`MIN_LOCAL_TOPICS`）时提供，见 Prompts。没有考点保留下来则报错、不覆盖原列表。
- **编辑**：重命名 / 新增 / 删除 scope，删除 / 合并（文本以 “ / ” 连接，`source: 'manual'`）/ 手动添加考点（`manual`，立即本地匹配）；都在 `documents` 单表事务内读改写并记 `editedAt`。「重新识别」会替换编辑（先确认）。
- **匹配**（`entities/syllabus/match.ts`）：本地 = 折叠大小写 / 重音 → 分词（中文按字二元组）→ 去功能词与考点套话（general / gross anatomy / structure…）→ 粗词干（复数、-al/-ar/-ae/-us、thorax→thorac）→ 名称双向覆盖率均值（描述占 25%），≥0.45 匹配、保留与最高分差 20% 内的 ≤3 个。打开考点清单时若课程主题指纹（`matchedAgainst`）变了就重新本地匹配（AI 匹配且主题仍在则保留）。
- **覆盖与掌握度**（`coverage.ts`）：匹配到的课程主题（仍存在的）→ 覆盖；练习数与掌握度取这些主题的 `KnowledgeMastery`（`topicId` 命中，或知识点 = 主题概念名 / 主题名 / 考点原文），掌握度按作答次数加权平均，是**估计值**；无练习显示 “—”。
- **界面**：课程主页第三个标签「考点清单」（`?tab=exams`，`widgets/syllabus/ExamTopicsPanel.tsx`）：scope 切换、讲义风格为标题 + 规则线列表，精密实验室为细线表格 + 等宽编号；每行 原文 / 出处页 / 教材覆盖（链接到课时，或「教材中未找到」）/ 练习数 / 估计掌握度 / 学习（第一个匹配主题的课时）/ 出题（`/quiz?examDoc&examScope&examTopic`）。有大纲但没有教材 / 笔记 / 文字稿时提示大纲本身没有内容。
- **按考试范围出题**：`QuizConfig.examScope = { documentId, scopeId, examTopicId?, includeUnmatched }`（测验配置里的 `ExamScopePicker`，选中后主题选择停用；`includeUnmatched` 默认只对医学 `international` 勾选）。`QuizService.planGroups` → `planExamGroups`：`planExamScopeEntries` 选出考点（多于题数时均匀抽取），已匹配的考点 = 一个按其课程主题（来源分块 + 概念）组成的组，未匹配的考点只在勾选时 = 无来源片段的组（`aiOnly`），其题目 `sourceRefs: []` 且 `Question.origin = 'ai_without_source'`，题卡与出处区标注「AI 出题 · 无教材出处」。一个都选不出时报 `EXAM_SCOPE_EMPTY`。出题的其它流程不变。

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
- 数值题可带 `unit`（mathjs 单位语法，如 `m/s^2`）：学生须带单位作答，任意同量纲单位先换算再按 1% **相对**容差比较；缺单位 / 量纲不对给出明确提示，单位无法识别则不判分（`infrastructure/math/quantityAnswer.ts`）。出题 prompt 为 `quiz-generator/v7`（外语课练习题型，其余与 v6 逐字相同；v6 及更早保留）：v6 新增 `language: 'zh_terms'`（简体中文、关键术语首次出现附英文），干扰项规则（同一材料里真实易混的概念、各选项长短与句式相近、正确项不能是最长 / 最具体的、禁止荒谬或离题选项），以及题干不得以“根据讲义提纲 / 课件 / 教材”开头。
- **化学方程式题（`chem_equation`，仅化学科目）**：`infrastructure/chemistry/equation.ts` 本地解析（`->`/`<=>`/`→`/`⇌`/`=`、`[条件]`、电荷 `Fe^3+`、按 mhchem 约定 `NH4+` 为 +1、水合物 `·`、状态符号忽略）。判分：物种一致（顺序无关）+ 原子与电荷守恒 + 系数成比例（整倍数也算对）；缺/多物种、不守恒、系数错误分别给出提示；读不懂则不判分。出题时参考答案本身必须能解析且配平，否则丢弃该题。**有机结构式**：物种内可写键（`CH2=CH2`、`HC#CH`/`HC≡CH`、`CH3-CH3`）；没有其它箭头时裸 `=` 才可能是反应箭头，取能配平的那个 `=`。物种按分子式匹配；参考答案写了 ≥2 个碳的结构式而作答结构写法不同（如乙醇 vs 二甲醚）时，判定为 `isomers`：不计分并提示可能是同分异构体（简单基团 `(CH2)3` 展开、键符号忽略后再比较）。
- 单位（`quantityAnswer.ts` 使用独立 mathjs 实例，不影响表达式判分）额外支持 `M/mM/µM/nM`（mol/L）、`Da/kDa`、`cal/kcal`、`ppm/ppb`、`Å`，以及医学的 `bpm`（1/min）、`Osm/mOsm`（独立量纲，与 mol 不互换）、`Eq/mEq`（独立量纲）；`mmHg` 为 mathjs 自带。
- **医学考试题型（`quiz-generator/v5`，全科可选，医学默认可用）**：
  - **X 型多选（`multiple_select`）**：4–6 个选项、至少 2 个正确；作答为选项 id（按选项顺序逗号连接）。**部分得分** = max(0, 选对数 − 选错数) / 正确数，只有全对才算“正确”。
  - **B 型配伍（`matching`）**：共用 3–6 个备选答案 + 2–5 个题干，`matchAnswers` 为每个题干对应的选项下标（同一选项可重复使用）；参考答案由下标重建；逐题干计分。
  - **填空（`fill_blank`）**：题干中每个 `____` 对应一组可接受答案（1–4 空，每空 ≤6 个）；本地按 NFKC + 小写 + 去空白标点比较，`乙酰胆碱（ACh）` 这类“术语（缩写）”两部分都须可接受；仍不匹配且已配置 AI 时，`fill-blank-check/v1` 只对未匹配的空判断是否**完全等价**（同义词 / 英文 / 缩写），计分仍在本地（`services/fillBlankChecker.ts`），AI 不可用则保持本地结果。
  - A2 型病例题只作为基础课的情境题：题干不要求诊断或治疗方案。三种题型的参考答案均由结构重建，`correctAnswer` 缺失不会导致丢题。作答组件在 `widgets/quiz/ExamFormatInputs.tsx`；结果页 / 错题本用 `displayAnswer` 把 id 显示为字母（`1→B`、`(1) …`）。
- **排序题（`ordering`，全科可选，默认不勾选）**：`orderItems` 3–8 个互不相同的单行项，参考答案由其重建（换行连接）。作答 `widgets/quiz/OrderingInput`（拖拽 + 上/下按钮，从按题目 id 固定的打乱顺序开始，且绝不是正确顺序）。得分 = 最长保序子序列长度 / 总项数（`infrastructure/math/orderingAnswer.ts`），部分得分走与简答题相同的 `score` 通道。
- **外语课练习题型**（`quiz-generator/v7`；`questionTypesForSubject(subject, targetLanguage)` 只对 `language` 课提供，`article_gender` 只对 `targetLanguage === 'de'`；服务端 `offeredQuizTypes` 再过滤一次；外语课测验配置默认勾选 冠词 / 变位表 / 填空 / 配伍 / 单选，`defaultQuestionTypes`）。数据与工具在 `entities/question/languageDrills.ts`，生成校验 `services/languageDrillValidation.ts`（名词 / 词形须按整词出现在本批来源片段中：NFC + 小写 + 合并空白，重音必须一致；没有来源文本时一律丢弃）：
  - **冠词题 `article_gender`**：`Question.gender = { noun, gloss?, article: der|die|das, plural? }`，`correctAnswer` = “der Kopf, die Köpfe”。丢弃：冠词不是 der/die/das、名词不大写或不在原文、复数不在原文、`correctAnswer` 与字段矛盾、原文词表把该名词写成别的冠词（“die Hand, …”）。作答 `<article>\n<plural>`；冠词 1 分 + 复数 1 分（`compareTargetText`：exact 1、accent/case/variant 0.5；前缀 “die ” 可写可不写），走 `score` 通道，全对才算正确；`evaluation.blanks` 带 `label` 逐项反馈。作答组件 `widgets/quiz/LanguageDrillInputs.tsx`（der/die/das 固定顺序不打乱，键盘 1–3 选冠词，`quizKeyboard.ts` 的 `articleForKey`；复数框带德语 `LetterBar`，Enter 提交）。
  - **变位 / 变格表 `paradigm_table`**：`Question.paradigm = { title, rows(2–10), columns(1–3), cells }`，格子为给定 `{ text }` 或空格 `{ accepted: 1–3 }`，空格 1–12 个；行列数不一致、同一格既给定又留空、行名重复、空格词形不在原文 ⇒ 丢弃。作答为空格按阅读顺序换行连接；逐格 `compareTargetText`（exact 1、accent/case/variant 0.5、wrong 0），得分 = 合计 / 空格数，全部 exact 才算正确，提交时传项目目标语言。组件是真正的 `<table>`（`th scope`），输入框可访问名“行 × 列”，Enter 跳下一格、Ctrl/⌘+Enter 提交，判分后逐格标出 exact / 接近 / 错并给出应填词形。
- **教授练习题与交互导师的简答题**（第二期）复用同一判分器：练习题从教授参考答案经 `rubric-extractor/v1` 拆出得分点（按 答案+prompt 版本 哈希缓存在题目上），作答写入错题本 / 掌握度并支持异议（`PracticeService.disputeAttempt`）；导师出题 `tutor/v2-question` 可出带得分点的简答题，覆盖率 60–99% 或无法核对时难度不调整。
- **简答题（`short_answer`）按得分点计分**：出题时生成参考答案 + 2–6 条得分点（`Question.rubric`）。判分 `services/shortAnswerGrader.ts` + `short-answer-check/v1`：AI 逐条判断是否答到（同义、等价表述都算），答到必须**逐字摘出学生原话**作为证据，本地校验证据确实出现在答案里，否则该点不算；得分 = 答到点数 / 总点数（3/5 → 60%），由本地计算，从不采用 AI 的整体结论。空答案不调用 AI；未配置 AI 或核对失败 ⇒ 不计分（展示得分点与参考答案）。
- 简答题计分：测验百分比 = Σ得分 / 已判题数（简答题按 `earned/total` 计入，`QuizScore.points`）；只有全部答到才算“正确”，其余进入错题本；掌握度按得分比例、**半权重**计入（`observationFromAttempt`）。学生可点“我不同意这个判定”（`QuizService.disputeAttempt`）：该次作答保留展示但不再计分，同时移出错题本、重建该知识点掌握度、已完成测验重新算分。
- **口试练习（`QuizConfig.mode === 'oral'`，`services/oralExamService.ts`）**：`QuizService.generateQuiz` 遇到 oral 模式转交 `OralExamService`。`count` = 抽取题目数（1–5，`ORAL_MAX_TOPICS`）：有 `examScope` 时从 `planExamScopeEntries`（全部条目）随机抽取（单个考点则只有它；未匹配考点仍只在 `includeUnmatched` 时入选），否则为所选课程主题，再否则从全部课程主题随机抽取。每个题目一次 `oral-exam/v1` 请求（来源 = 匹配主题的已校验来源分块 + 概念关键词，每题 ≤6 段，不用全书填充；未匹配考点不给资料），失败或不合格重试 1 次，仍失败则跳过该题目，全部失败才报错。校验 `validateOralItem`：主问题 4–10 条互不相同的得分点（多于 10 条截断，少于 4 条丢弃），追问须有题目 + 参考答案 + 1–3 条得分点（多于 3 条截断）、不得重复主问题，最多 2 个；`sources` 经 `resolveSourceReferences` 只保留本次提供的分块，未匹配考点一律 `sourceRefs: []` + `origin: 'ai_without_source'`。**存储方式（最小侵入）**：主问题与追问都是普通 `short_answer` 题（`correctAnswer` = 参考提纲 / 参考答案，`rubric` = 得分点），用可选的 `Question.oral = { group, role: 'main' | 'follow_up', topic }` 关联（未升 Dexie），因此作答、判分（`ShortAnswerGrader`）、错题本、半权重掌握度、异议、结果页全部沿用。主题与知识点：匹配到的课程主题 → `topicId` + 主题名；未匹配 → 考点原文（考点清单的练习数 / 掌握度据此自动统计）。语言：医学 `international` 一律英文（`oralLanguage`），否则同测验题目语言。`QuizConfig.oral.timerSeconds`（默认 180，可不设）。界面：考点清单每行与清单标题的「口试练习」链接带 `oral=1` 预选测验设置中的口试选项（医学课或有大纲的课程显示，选中后隐藏题数与题型）；测验页 `widgets/quiz/OralExamSession.tsx` 只显示考官提问、可关闭的倒计时、大输入框 + 浏览器语音输入（国际医学课 `en-US`，否则按界面语言）；主问题 → 逐个追问 → 本题反馈（得分点答到 / 未答到、参考提纲、作答原文中用 `<mark>` 标出得分证据 `shared/lib/evidenceHighlight.ts`、异议按钮）。结果页 `OralTopicScores` 按题目显示 得分点合计 / 总数（含追问，未判 / 已异议的不计）；纯函数在 `entities/question/oral.ts`（`oralGroups` / `oralTopicScores` / `oralResumePoint` / `oralNextStep`）。
- **暂停出题**：出题与口试每批 / 每个考点前检查暂停；暂停或停止时已出的题即存，测验标为 `paused`（0 题也保留），行上记录续出所需（剩余计划位、分组的主题 / 知识点 / 来源 chunk id、语言与教授风格、口试待写考点）。测验首页列出「未完成」并提供「继续出题」（只补剩余计划位，沿用补题规则，完成后 `ready`）；`paused` 测验不能作答。`recoverInterruptedQuizzes` 把本页无进行中、超过 10 分钟的 `generating` 测验改为 `paused`（有计划）或 `failed`。
- **出题分批与补题**（`QuizService.generateInBatches`）：每批最多 5 道，输出上限 = max(用户设置, 1024 + 900 × 题数)，封顶 8192；后续批次附“避免重复”。题目按**自身题型**对应计划位（不再按位置套用计划题型，丢题不会让后面的题型错位）；未选的题型丢弃；成功请求中缺少的题最多再补 2 轮（整批失败只在 `generateWithRetry` 内重试 2 次）；测验标题按实际题数。取材：`loadQuizCandidates` 一次读出全部候选段落，`pickQuizSnippets` 选取（主题的已校验来源分块优先，再每个知识点一段，其余在全书均匀抽取）。主题测验为单组，片段数 = clamp(题数 + 3, 8, 24)，题多时各批分到不同片段。**混合复习按主题分组**（`planGroups`）：主题数 ≤ 题数时全部主题，否则随机抽题数个主题；题目轮流分到各组，每批只拿到本批题目所属主题的知识点（每主题 ≤3）与来源段落（每主题 ≤3，不用全书填充），题目记录各自的 `topicId`。
- **选项随机顺序**：保存前在本地打乱 `multiple_choice` / `multiple_select` / `matching` 的选项（`shared/lib/shuffle.ts`，判分按选项文字，不受影响）；AI 导师单选同样打乱。单选题若正确项长度 > 1.6 × 最长干扰项且多 ≥12 字，或选项重复，丢弃并补题。旧题不变。
- **题目语言**（`UserProfile.questionLanguage`：`zh_terms` 默认 / `source` 跟随教材 / `en`）：测验配置里选择并保存，`QuizConfig.questionLanguage` 可覆盖；服务端缺省读用户偏好（`quizLanguage()`）。错题分析与交互导师（`InteractiveTutorPage`）用 `resolveContentLanguage()` 换算为 zh / en / 教材语言；课时阅读页仍保留自己的语言切换，不受影响。
- 题目卡片与结果页的难度显示为本地化名称（`difficultyLabelKey`），取题目自身记录的难度。设置页底部显示版本号（`APP_VERSION` 取自 `package.json`）。
- 题目出处没有摘录时（`fillMissingExcerpts`，仅显示时补，不写回）：有 `chunkId` 显示该分块原文，否则显示该页原文并注明“未记录具体原句”。
- 表达式判分 `infrastructure/math/expressionEvaluator.ts`：Unicode 归一 → mathjs 解析 → 符号化简 `simplify(lhs-rhs)===0` → 16 点数值采样 → 去 `+C` → 返回 `true|false|null`。`null` 显示「无法自动判定」且**不计入成绩**。判分不依赖 AI，可复现。
- 自适应：`composite = 0.45·近期正确率 + 0.25·难度加权正确率 + 0.20·知识点掌握度 + 0.10·连对连错`；≥2 题才调整；5 档（beginner→challenge）单步移动。
- **题库式自适应测验**（`services/quizBank.ts`）：难度为「自适应」的 topic / mixed / weakness 测验（`usesQuestionBank`；复习会话与“练这道错题”带 `sourceMistakeId` 的仍按原来的一次性递增计划）出题时生成**题库**：`planBank(count, 'basic')` = 前 2 个位置只出起始难度（模型 ≥2 题才调整），之后每个位置出 简单一档 / 同档 / 难一档；总数上限 min(2.5 × 题数, 60)，超出时从最后的位置起交替去掉一个偏离档（每个位置始终保留起始难度）。题库沿用分批出题、补题、校验、选项打乱、丢题规则与暂停 / 继续（`PlanEntry.slot` 指向 `Quiz.bank.plan`，同一位置的各档共用其主题组；暂停进度按题库总数计）。出完后 `Quiz.bank = { start, plan, entries, length }` 记下全部题库题，`questionIds` 只保留**已出的题**（初始为位置 0 的起始难度题），`difficultyPlan` 记录实际出题难度。每次 `submitAnswer` 后，若已出的题都已作答且未达 `length`，用同一模型（`nextDifficultyFor`：`adaptiveHistory` 已把被异议的作答当作未验证）的决定挑下一题（`selectNextBankQuestion`：下一个位置中最接近目标难度的未用题；与上一题知识点相同时优先换同题型、同难度距离的后续位置题；该位置用完则取任意位置中最接近的）并通过 `nextQuestion` 返回。`resumeQuestionBank` 在打开测验时补出“已作答但还没出下一题”的那一题（续做）。未用的题库题不显示、不计分（结果 / 计分只看 `questionIds`），结果页「按难度」卡片显示难度路径（如 基础 → 基础 → 中等）。题库不够长时测验长度 = 题库题数。非自适应难度与旧测验不变。
- 掌握度：`Σ(recencyWeight × difficultyWeight × correct) / Σ(recencyWeight × difficultyWeight)`，`recencyWeight = 0.9^距最新`，难度权重 0.6→1.4，未验证作答不计入。

### 答题输入（符号键盘）

- 所有作答框统一用 `widgets/mathInput/MathField`：符号键盘 + 实时“系统识别为”预览，插入在光标处，模板（√、a/b、xⁿ、sin…）把光标放进括号、有选区时直接包裹选区。
- 按判分方式选模式（`shared/lib/mathInput.ts`）：`expression`（测验/练习的表达式题，插 mathjs 语法，预览为判分器实际解析结果）、`number`（数值题）、`quantity`（带单位数值题，插单位符号）、`chemistry`（方程式题：箭头/电荷/状态/条件，预览用 mhchem 渲染解析结果）、`text`（作业草稿、导师作答、提问：插 Unicode 符号，分组按项目科目排序，生物有专属分组）。
- 单行框 Enter 提交，多行框 Ctrl/⌘+Enter 提交；键盘开合状态按模式存 localStorage（仅本机偏好）。预览经 `services/answerPreview.ts` 复用判分器的解析函数，不另立规则。
- **快捷输入条** `widgets/mathInput/QuickInsertBar`（纯逻辑 `shared/lib/quickInsert.ts`）：输入框旁常驻的一小排按钮，只放该框需要的符号（从参考答案 / 矩阵行数 / 科目推出，绝不整面墙）。插入在光标处、模板包裹选区；`?` 占位模板插入后选中第一个 `?`，填一个 `?` 自动跳到下一个，行按钮填 `R?` 的 `?` 只写数字；`onPointerDown` + `onMouseDown` 阻止默认，不抢焦点；触控 ≥44px。`MathField` 的 `quickItems` 属性把它放在框下；`LetterBar` 也是它的一个用法。
  - 引导练习行变换框：`rowOpQuickItems(当前矩阵行数)`（R1…Rn，最多 9 个 + `→ ↔ + − / ,` + 倍加 / 交换 / 倍乘模板 + 退格），框内 Tab / Shift+Tab 在 `?` 间跳转（最后一个之后 Tab 正常离开）。矩阵格聚焦时显示 `−` `/`（`MATRIX_CELL_QUICK_ITEMS`）。
  - 填空按题型：`services/quickInputs.ts` 的 `blankQuickItems`——表达式取答案变量（不取函数，避免提示）+ 模板；带单位数值用 `splitQuantity` 解析答案单位；化学固定箭头 / 下标 / 电荷 / 状态；文字填空：语言课给该语言字母，统计课给固定统计符号（不取自答案）；其它文字与 `exact` 不给。测验与教授练习的 `math_expr` 用 `expressionQuickItems(参考答案)`。测验带单位数值题**不**给单位按钮（选单位是题目本身）。

### 错题本

- `Mistake`：`question / studentAnswer / correctAnswer / knowledgePoint / difficulty / mistakeType / aiAnalysis / timestamp`；同题多次错合并。
- 类型：`Conceptual / Calculation / Formula / Sign / Unit / Misreading / Incomplete / Careless / Unknown`。
- `mistake-analyzer/v2` + `normalizeAnalysis()` 三层兜底（prompt → normalizer → UI）。
- 练习选项：不练 / 练本知识点 / 练相似题 / 薄弱点训练。
- 薄弱点：`0.45·错题占比 + 0.20·未掌握占比 + 0.15·近期错题 + 0.20·(1−掌握度)`。

### 复习卡片（间隔重复）

- `ReviewCard`（Dexie **v15** `reviewCards`，索引 `[projectId+due]`）：正面 / 背面 / 来源（`concept` 课程概念 · `table` 解剖对照表 · `manual` 手写 · `note` 作业问答 · `phrase` 外语课短语）/ 可选 `knowledgePoint`。全部本地，不调用 AI。
- 调度（`entities/reviewCard/types.ts`，SM-2 家族）：忘了 → 10 分钟后重学、ease −0.2、计一次遗忘；新卡“困难” → 6 小时后（仍在学习阶段）；困难 → 间隔 ×1.2、ease −0.15；记得 → 1 天 → 3 天 → 间隔 × ease；简单 → 间隔 × ease × 1.3、ease +0.15；ease 下限 1.3。
- 页面 `/projects/:id/cards`（`ReviewCardsPage`）：统计（待复习 / 总数 / 新卡 / 已熟记 ≥21 天）、复习会话（空格显示答案，1–4 评分，按钮上显示各评分的下次间隔）、搜索 / 编辑 / 删除、从课程概念生成（名词 → 定义，按正面去重）、手写新建。课时中的 `anatomy_table_2d` 可一键加入（“行 — 列” → 单元格）。
- 掌握度：带 `knowledgePoint` 的卡片复习以**半权重**观测计入（`MasteryService.recordObservation`，忘了 0 / 困难 0.6 / 其余 1）。随项目删除；纳入导出。
- **外语课短语卡**（`services/phraseCards.ts`，复习卡片页「从对话生成短语卡」，仅外语课）：只把看起来是对话 / 情景的分块（≥3 行以破折号开头、≥3 个问号或说话人标签）按 ≤8000 字一批（最多 8 批）发给 `phrase-extract/v1`；`validatePhrases`：`sourceChunkId` 必须是本批分块、短语去空白后须**逐字**出现在该分块中、带“……”/“___”的练习行丢弃、按 prompt 去重。确认对话框（按问句 / 答句 / 表达分组、可改正面、取消勾选、分页）→ `ReviewCardService.addMany`（source `phrase`，正面 = 意思，背面 = 原句，可选反向卡），按正面去重。

---

### 背单词（`/vocab`）

- **数据**：`scripts/build-vocab.mjs` 从 [ECDICT](https://github.com/skywind3000/ECDICT)（MIT）下载到 `.cache/ecdict/`（已 gitignore），生成 `public/vocab/{dictionary.json, common.json, roots.json, LICENSE-ECDICT.txt}`。`dictionary.json` 只保留带考试标签的 14,912 词，每词 `[word, phonetic, meanings[], mask, rank, exchange]`，按词频排序；`mask` 位序 = `TAG_ORDER`（`zk gk cet4 cet6 ky toefl ielts gre`）；释义去掉 `[网络]` / `[计]` 义项（含 `art. [计] …` 写法）。`common.json` = 词频前 6000 及其变形（课程词汇跳过它们）。重跑脚本即可重建；运行时由 `infrastructure/vocab/wordData.ts` fetch。**不要**改用 qwerty-learner / TypeWords（GPL）、Earthworm（AGPL）或无许可证的词表。
- **调度**：`ts-fsrs`（FSRS-6，`request_retention 0.9`、fuzz、最长 1825 天），`entities/vocab/schedule.ts`。**现有复习卡片 `ReviewCard` 仍是 SM-2，未迁移。**
- **表（Dexie v16）**：`vocabCards`（主键 `word`，**全局进度**，跨课程共享——`projectId` 原则的唯一例外）、`vocabBooks`（`custom` 导入词表 / `course` 课程词书，后者带 `projectId`）、`vocabEntries`（词书条目，含释义来源 `glossBy: dictionary | ai | user | none`、原句 `context`、出现次数）、`vocabReviews`（评分日志，供连续天数与统计）。考试词书不入库，由词典按标签生成（`exam:<tag>`，推荐 `exam:cet4`）。删除词书 / 删除项目只删词书与条目，**不删单词进度**。纳入导出。
- **设置**（`UserProfile`）：`vocabBookId` / `vocabDailyNew`（默认 20，上限 200）/ `vocabReviewMode`（`auto | recognize | spell | dictation | cloze`）。
- **今日队列**（`VocabService.session`）：到期复习在前（上限 200），再补新词至 `dailyNew − 今日已学新词`。`auto` 复习方式：学习中或 `reps < 2` → 认读；否则按 `reps % 3` 轮换 拼写 / 填空 / 听写，无可挖空原句时填空退回拼写。打字题本地判分：对 → 记得(3)，差一个字母 → 模糊(2)，错 → 忘了(1) 并计入易错词；忘了的词本轮以认读再出现（最多 2 次）。
- **课程词汇**（`CourseVocabService.extract`）：读项目已处理分块，本地抽词（`extractCourseTerms`：≥4 字母、去停用词、复数并入单数），跳过常用词与中考 / 高考 / 四级词，取前 150 个，保留首次出现的原句 + 页码 + 文档名；词典查不到的由 `vocab-gloss/v1` 每批 40 个补释义（AI 判定不是词则丢弃），未配置 AI 时保留未释义条目、之后可再补；每个项目一本课程词书，重复提取只合并不重复。
- **导出**（`formatExport`）：Anki（`#separator:tab` / `#html:true` / `#tags column:3`，背面音标 + 释义 + 例句）、CSV（带 BOM，`word,phonetic,meaning,example,source`）、纯单词 TXT；可导出任意词书 / 已学 / 易错词。导入：`parseWordList`（每行单词，或 制表符 / 逗号 / 冒号 / 空格+中文 分隔的释义）。
- **非英语词书**（`VocabBook.language`，缺省为英语）：导入时可选语言；课程词书取项目目标语言。非英语词书不查 ECDICT、不做常用词 / 四级过滤、不做英语词形还原与词根提示，释义由用户或 `vocab-gloss/v2`（带 `targetLanguage`；英语时与 v1 逐字相同）提供；保留单词大小写（`wordKey`：英语照旧小写，已有进度不受影响）。分词、词表解析一律按 Unicode 字母（`\p{L}`），抽词前去掉在一半以上页面重复的页眉页脚行。
- **目标语言判分**（`shared/lib/language.ts` `compareTargetText` → `exact / accent / case / variant / wrong`）：非英语词书的拼写题只差重音、大小写或德语 ß↔ss / ä↔ae 时评为「模糊」(2) 并提示正确写法；语言课测验填空同样情况计 0.5 分并提示，且不送 AI 等价核对。朗读 `speak(text, lang)` 按语言选语音，本机没有该语言语音时听写退回拼写并提示。符号键盘新增德语（ä ö ü ß „ “）与匈牙利语（á é í ó ö ő ú ü ű）组，按项目目标语言排在最前（`LetterBar` 也用于单词拼写与填空）。
- **导入课本词表**（`services/textbookWordList.ts`；外语课文件菜单「导入课本词表」与背单词「课程词汇」中的同名按钮）：文档分块按章节（`chapterId`）切成 ≤12000 字的部分，只发看起来像词表的部分（词表标题、≥3 个德语“der X,”条目或短行为主；都不像时全发），并发 2 调 `vocab-list-split/v1`。`validateWordListItems`：term 须按整词出现在该部分原文（重音一致、大小写不敏感），释义非空，冠词须为 der/die/das（非德语不得带冠词）且不与原文词表矛盾，“der Kopf” 形式的 term 拆出冠词，不在原文的复数只丢复数，按 `wordKey` 去重，记录所在行作 `context`。确认对话框按课次分组、释义可改、可取消勾选、每页 100 行。`merge` 写入项目课程词书（不存在则新建，`language` = 目标语言），按 `wordKey`（再按忽略大小写）合并：已有的更新释义 / 冠词 / 复数 / 课次，确认的释义 `glossBy: 'user'`；单事务。`VocabEntry` 新增可选 `article` / `plural` / `lesson`，`WordView.grammar`（`grammarLine` → “der Kopf, die Köpfe”）在单词复习揭晓后与词表中显示。
- 词根词缀提示（`rootHints`）只作联想，至少留 3 个字母的词干才提示。朗读用浏览器 `speechSynthesis`（`shared/lib/speech.ts`），不可用时听写模式退回拼写。

### 模拟问诊（外语课口试，`/projects/:id/interview`）

- **场景**：Semmelweis 匈牙利语 / 德语医学语言课的口试是病人问诊——老师按情景卡扮演病人，学生用目标语言问必问问题（姓名年龄、主诉、从何时、部位、程度、加重因素、伴随症状…），听懂回答后用英语向医生总结。匈牙利语课计分：问题 7 + 信息 10 + 交流 3 = 20 分。
- **数据**（Dexie **v18** `interviewSessions`，索引 `id, projectId, [projectId+updatedAt]`）：`InterviewSession` = `scenario`（`title`、`facts[{id, fact, englishGloss?, questionId?, sourceChunkId?}]`、`questions[{id, label（目标语言）, englishGloss}]`、`source: textbook | generated`、`sourceChunkIds`、`page?`）+ `examMode` + `turns[{role: student | patient, text, at, coveredQuestionIds?, correction?}]` + `summary` + `results?` + `status: interviewing | summarizing | graded`。随项目删除（同一事务）、纳入导出 / 恢复。类型与纯函数在 `entities/interview/types.ts`（`askedQuestionIds`、`courseScaleScore`、`speechLocaleFor`），仓库 `entities/interview/repository.ts`。
- **情景**（`services/interviewService.ts`）：「从课本提取情景」——`selectScenarioChunks` 按 `scenarioScore`（“Name, age” / 主诉 / Patient 标签 / 编号列表 / 对话）挑分块，≤8000 字一批、最多 8 批；`validateTextbookScenarios`（`services/interviewValidation.ts`）：每条信息须（`evidenceKey` 规范化后）出现在其 `sourceChunkId` 分块中，每个问题的 `label` 或 `englishGloss` 须出现在其分块中（课本常只印英文问题清单），否则丢弃；剩不到 3 条信息 / 2 个问题的情景丢弃；本地重新编号 q1… / f1…。学生从列表里选。没有情景时「生成一个练习情景」：用课程对话分块（无则前几块）写 A1/A2 情景，标为 `generated`（无出处，界面注明“AI 生成”）；必问问题默认取本次提取到的第一个课本情景，否则取最近一次课本情景会话的清单。
- **问诊**：学生输入或语音输入（`useSpeechInput(speechLocaleFor(targetLanguage))`，如 hu-HU / de-DE）+ `LetterBar`；每句一次 `interview-patient/v1` 调用，`readPatientTurn` 校验：回复非空、`coveredQuestionIds` 只保留闭集内 id（去重、按清单顺序）、`correction` 可选。回复不可用 ⇒ 抛错、**这一轮不落库**。病人回复可朗读（`speak(text, targetLanguage)`，可开自动朗读；本机无该语言语音时提示）。侧栏清单显示已问 / 未问；**考试模式**在评分前隐藏清单与语言提示。
- **评分**：结束问诊后写英语总结；`interview-summary-check/v1` 对每条信息给出是否听懂 + 逐字引用总结原文；`buildInterviewResults` 本地校验（`isVerbatimEvidence` + `isMeaningfulEvidence`，同一引文只算一条），问题数 = 学生各轮 `coveredQuestionIds` 的并集；交流 = AI 估计（0–3 取整夹紧，一行说明，`estimate: true`，界面标“估计值”）。清单正好 7 题时另显示课程 20 分制（信息按 10 分折算）。结果卡列出听懂的信息（附原话）、可能需要再听的信息、语言提示；「把没问到的问题加入短语卡」→ `ReviewCardService.addMany`（source `phrase`，正面英文释义、背面目标语言问句，按正面去重）。
- **会话列表**：继续 / 查看 / 删除（确认对话框）。导航 `ProjectFlowNav` 的「模拟问诊」只对 `language` 课程显示（`flowItemsFor(subject)`）。

### 作业完整讲解（作业页「完整讲解」标签）

- **结构**：`HomeworkWalkthrough`（id = `<setId>:<language>`，Dexie v17 `homeworkWalkthroughs`）按部分存 `sections`：`overview`（必须掌握的工具）、每题 `q:<questionId>`（`conclusion` + Markdown `body` + 可选 `checks`）、`summary`（小结 + `suggestions`）。标题在渲染时按 UI 语言生成，不存。
- **生成**（`services/homeworkWalkthroughService.ts`，提示词 `homework-walkthrough/v3`（不带 v3 选项时与 v2 / v1 逐字相同），带科目画像；缓存版本仍为 `subjectPromptVersion('homework-walkthrough/v1', subject)`）：每题一次请求（并发 2，单次尝试 240 s 时限；截断时输出预算翻倍，**上限为 `ai.maxOutputTokens`（模型上限或用户数字），不再有固定 16k 封顶**；在上限处仍截断 ⇒ `OutputTruncatedError.atCap`，提示「当前模型单次最多输出约 X token，这一部分仍然太长」（由用户数字封顶时提示调高设置）；`output-limit` 减半，限流 / 超时 / 不可用重试 2 次），再**分别**请求开头与小结（`homework-walkthrough/v5` 的 `buildFramePartSystemPrompt({ part })`：开头返回 `tools[{name, body}]`，小结返回 `kinds[{name, questions, note}]` / `ideas` / `suggestions`；也接受旧式整段文字）。某一部分在上限处仍截断 ⇒ 按题目对半分组递归重试（直到单题），各组结果在本地合并（`entities/homework/walkthroughFrame.ts`：工具按名称去重保留较长说明，类型按名称合并题号，要点 / 建议去重）；已完成的组存在该节的 `frameDraft`（暂停 / 失败后继续只补剩下的组，就绪的旧文本在重写完成前保留）。题目 / 小题提示词与 v4 逐字相同，缓存版本仍为 `v1`，已就绪的开头 / 小结不会变为过期。**每部分总时长上限** `SECTION_TOTAL_MS` = 6 分钟（一次 `requestSectionJSON` 的全部尝试合计；最后一次尝试只给剩余时间；分小题时每个小题各算一次）：到时抛 `SECTION_TIMEOUT`（「超时，可重试：…已跳过」），该部分存为 failed，运行继续下一部分。重试时 `progress.attempts[sectionId] = { attempt, lastFailure }`，进度卡与该节标题旁显示「第 2 次尝试：上次超时」（开头与小结共用一条）。**开头 / 小结请求只发各题题目（≤800 字）、结论（≤1000 字）与要点**（`sectionKeyPoints`：小题标题 + `##`–`####` 标题 + 加粗术语，≤600 字，本地提取），不发正文。每部分完成即 `putSection`（事务内读改写）；**已就绪的部分绝不被失败覆盖**；账号类错误（额度 / 鉴权）停止后续请求。不会自动生成：首次与更新都由学生点击。语言 = `walkthroughLanguage(questionLanguage, set.language)`（默认 `zh_terms`）。教授答案规则同复习讲解（已对上题号才用，「留给学生」不用）。
- **提示词 `homework-walkthrough/v2`**（v1 保留）：在 v1 上给单题与开头 / 小结提示加可选的 `revision` 块（当前版本 + 学生修改建议），并新增小题提示 `buildPartSystemPrompt` / `buildPartUserPrompt`（只写某一小题，带完整题面、已对上的教授答案与已写小题的结论 + 正文，按 6000 字预算截断）。**无 `revision` 时提示与 v1 逐字相同**，缓存版本用 `CACHE_VERSION = 'v1'`，已有讲解的哈希不变（有测试）。
- **提示词 `homework-walkthrough/v3`**（v1 / v2 保留，注册表已切到 v3）：单题系统提示 `{ analysis: true }` 多要 `analysis` 字段并加标点规则 `PUNCTUATION_RULE`（方框后与居中公式末尾不加句末标点）；小题系统提示 `{ punctuation: true }` 只加标点规则，**第一个小题**的用户提示 `{ analysis: true }` 顺带返回整题的 `analysis`（存在 `draft.analysis`，拼接时放到节上）；开头 / 小结 `buildFrameSystemPrompt({ keyPoints: true })` + `buildFrameKeyPointsUserPrompt`（`KEY POINTS` 块代替 `SECTION START`）；单独的 `buildAnalysisSystemPrompt` / `buildAnalysisUserPrompt`（题面 + 来源段落 + 结论 → `{"analysis"}`）。**不带这些选项时与 v2 逐字相同**，`CACHE_VERSION` 仍为 `'v1'`，已有讲解不变成「可更新」（有测试）。
- **题目分析**（`WalkthroughSection.analysis`，也进 `previous` 版本与打印）：题目节在「查看原题」与「结论」之间渲染可折叠的「题目分析」（`<details open data-walkthrough-analysis>`，两种风格）。新生成与「重新生成这一节」自动带上；旧节（无 `analysis`）显示「补充题目分析」→ `addAnalysis(setId, sectionId, { control })`（与整份生成共用 `runs`，`progress.section.analysis = true`，单次请求可「停止」；同样受 6 分钟上限）：只把 `analysis` 写到当前已就绪的节上，不改正文、哈希、`generatedAt` 与 `previous`；停止 / 失败不改动该节。
- **提示词 `homework-walkthrough/v4`**（v1–v3 保留，注册表已切到 v4）：单题 / 小题系统提示 `{ steps: true }` 追加 `STEP_FORMAT_RULE`（每步一行「作 $R_3 \to R_3 - 3R_1 - 2R_2$：」，多个变换各占一个 `$…$`、以逗号分隔、视为同时作用于上一矩阵，下一行是完整结果矩阵的 `$$…$$`）、`EMPHASIS_RULE`（术语仅首次出现加粗、每段关键结果加粗 ≤2 处、不整句加粗）与 `FINAL_ANSWER_RULE`（每小题末尾 `\boxed{…}`）；新增详略变体请求 `buildVariantSystemPrompt({ linearSystems, level, part? })` / `buildVariantUserPrompt`（`EXISTING STANDARD VERSION` + 可选 `CURRENT DETAILED VERSION TO REWRITE` 与学生建议），`normalizeVariant` = v1 的 `normalizeQuestionSection`。**不带这些选项时与 v3 逐字相同**，`CACHE_VERSION` 仍为 `'v1'`（有测试）。
- **普通版 / 详细版**（2j）：标准版就是节本身的字段；详细版存在 `WalkthroughSection.variants.detailed`（`WalkthroughVariant`：`conclusion` / `body` / `checks` / `parts` / `inputHash` / `generatedAt`），`inputHash` 与节相同才有效（`detailedVariant()`），哈希共用、不影响 freshness；分小题的详细版逐小题请求，进度存在 `section.variantDraft`（暂停后只写剩余小题）。学生选择存在 `section.level`，未选时用设置页的默认版本 `UserProfile.walkthroughLevel`（`DEFAULT_WALKTHROUGH_LEVEL = 'standard'`，`widgets/settings/WalkthroughLevelSetting.tsx`）；只有题目节有详略（开头 / 小结 / 其它内容始终标准）。每节标题旁「普通 / 详细」切换（`aria-pressed`）：`setLevel(setId, ids | 'all', level)` 即时保存（`WalkthroughRepository.updateSection` / `updateSections` 事务内读改写）；切到未生成的详细版时 `generateVariants(setId, { sectionIds })` **对照已有的普通版**生成（保持结论、记号、步骤顺序，只调详略），两版都保存，之后切换不再请求；未配置 AI 或生成中只切换并提示「详细版还没有生成」+「生成详细版」。工具栏「全部切到详细版」= 全部题目节设为详细 + 只生成缺的（`missingDetailed`，并发 2，与整份生成共用 `runs`，可暂停 / 立即停止；暂停记 `pausedRuns.variant`，`resume()` 继续只写剩余的）；全部已是详细时显示「全部切到普通版」。两版都跑 RREF 本地核对（详细版的 `linearSystems` 单独核对，存在变体的 `checks`）。「重新生成这一节」只重写**当前显示**的版本：显示详细版时 `regenerateSection(..., { level: 'detailed' })` 只改 `variants.detailed`，被替换的详细版进 `previous`（`level: 'detailed'`），「恢复上一版」按 `previous.level` 互换；重写普通版时详细版与 `level` 保留。整份重新生成（输入变化 / 全部重新生成）只保留 `level`，旧详细版因内容已变不再沿用。题目分析两版共用。打印按各节当前显示的版本。
- **排版**（2k，显示层，旧讲解即时生效，`widgets/homework/walkthrough/WalkthroughBody.tsx`）：
  - 两种风格正文 / 结论 / 题目分析限宽 `max-w-[70ch]`；四级字号（小题标题 19–21px / 步骤标题 16px / 正文 15–17px / 旁注 13.5px，`WALKTHROUGH_PROSE` 用 `[&_h3]` 等变体）；`tabular-nums`；统一 `space-y-4` 节奏。`globals.css` 的 `[data-walkthrough-body]` 规则：居中公式改为左对齐、缩进 1.5rem 跟在说明下方；段落中含公式的加粗（关键结果）用强调色，每段第 3 处起的加粗恢复常规字重。
  - 显示变换（`walkthroughFormat.ts` 的 `formatWalkthroughText` = `tidyBoxedPunctuation` → `dfracInMatrices`（矩阵 / array 环境内 `\frac` / `\tfrac` → `\dfrac`）→ `dedupeBoldTerms`（不含公式 / 数字的加粗术语只保留第一次））。
  - **每小题末尾框答案**：`splitSubparts` 按 `### (a)` 切分，该小题正文里没有 `\boxed` 时在末尾显示「本小题答案」框（分小题节取 `part.conclusion`，否则 `conclusionByPart` 从结论里读 `(a)(b) …; (c) …`，读不出就不显示）。
  - **步骤卡片**（`entities/homework/walkthroughSteps.ts`，纯函数）：`splitSteps` 在显示时识别「含行变换的句子（`$R_i \to …$` / `\rightarrow` / `\gets` / `\leftrightarrow`，`r_2`、`R_{2}`、系数 `\frac12`、`(-2)`、`R_2/3` 均可）+ 后面的矩阵（`bmatrix` / `pmatrix` / `array{ccc|c}` 等）」以及「`A \xrightarrow{R_2 - 3R_1} B \xrightarrow{…} C`」链式写法（箭头标签可省略目标：`R_2 - 3R_1` 即 $R_2 \to R_2 - 3R_1$，单项即倍乘）；上一矩阵取同一小题里最近显示的矩阵（遇到 `#`–`###` 标题清空并重新编号）。卡片 = 左侧竖线 + 半粗体操作行「③ 变换」+（句子里还有别的说明时）原句 + 「原矩阵 →(箭头上标操作) 新矩阵」并排；被改动的行浅色高亮，悬停行 / 悬停或 Tab 聚焦单元格时在卡片下方读出逐元素算式（如 $1 - 3\cdot 2 - 2\cdot 0 = -5$，`entryArithmetic`，`rref.ts` 的 `rational` 精确分数本地计算，不调用 AI）；单元格 `tabIndex=0` + `aria-describedby` 指向隐藏的纯文本说明（值 + 算式 + 应为）。讲解所写与本地结果不一致的单元格标红（`data-wrong`）并在卡片下列出「第 r 行第 c 列：讲解写的是 a，按这一步的变换应为 b」，否则显示「本地核对：这一步的计算无误」。多个变换先按「同时作用」计算，与所写不符再试「依次作用」。
  - **保守**：单元格 / 变换读不出、矩阵尺寸不同、句中有读不出的行变换、结果与原矩阵相同、或**变换未涉及的行也变了**（句子里多做了文字描述的步骤）时，该处按原样渲染为普通 Markdown，不标任何错误、不崩溃。
- **方框后的标点**（显示时，`entities/homework/walkthroughFormat.ts` 的 `tidyBoxedPunctuation`）：去掉居中公式（`$$…$$` / `\[…\]`）中最后一个 `\boxed{…}` 之后只剩间距 + 一个 `.` `,` `，` `。`（或 `\text{.}`）的标点、以方框结尾的居中公式闭合后同一行末尾的标点，以及以方框结尾的行内公式后**位于行末**的 `。`；代码、普通公式、方框不在末尾、行内方框后还有文字时都不动。讲解的结论 / 正文 / 小题 / 建议 / 题目分析与打印都经它渲染，旧讲解无需重写。
- **重新生成这一节**（`regenerateSection(setId, sectionId, { suggestion?, control? })`，与整份生成共用 `runs`，进行中时按钮隐藏，未配置 AI 时禁用）：题目节 = 原输入 + `revision`；开头 / 小结 = 开头小结请求带 `revision.target`，返回两部分但只保存所请求的那一部分。成功时把被替换的就绪版本存进 `section.previous`（一层），`restorePrevious` 互换（再点即切回）；`inputHash` 用当前哈希（过时的节重写后不再过时），题目节重写不影响开头 / 小结（其哈希只依赖题目输入）。停止 / 失败 / `insufficient` 都不替换就绪内容。单次请求用「停止」，分小题时用暂停 / 继续。
- **长题分小题**（`entities/homework/splitQuestion.ts` 的 `walkthroughSubparts` / `shouldSplitWalkthrough`）：(a)(b)… 字母须从 a 连续（全角括号也认），≥3 小题，或题面 >1500 字且 ≥2 小题时按小题请求；整题请求在预算处理后仍 `truncated` 时自动改为分小题（不显示失败）。进度存在 `section.draft`（`mode` / `suggestion` / `inputHash` / `labels` / 已完成 `parts`）：没有就绪内容时节状态为 `partial`（界面「已完成 x / y 小题」+「继续生成」），已就绪的节在重写期间保持原文、草稿另存；小题之间检查 `shouldContinue()`，暂停 / 刷新 / 失败后只写剩余小题。结论与正文在本地按小题拼接（`### (b) 标题`），RREF 核对按小题标签合并。「全部重新生成」只续用 `startedAt ≥ forceSince` 的草稿，`partial` / `failed` 不算已重写。进度 `progress.parts` 显示「第 2 题 (b) 正在编写」。
- **freshness**（`planWalkthrough`，纯函数）：题目部分哈希 = 提示词版本 + 语言 + 题号 / 题面 / 指纹 / 来源 chunk / 已对上的教授答案；开头与小结的哈希 = 全部题目哈希。只有变化的题目 + 开头小结显示“可更新”；`insufficient` / `failed` / 缺失也算需要更新；退役题目的部分在下次生成后移除。
- **RREF 本地核对**（`infrastructure/math/rref.ts` BigInt 精确分数；`entities/homework/walkthroughChecks.ts`）：线性代数科目或题面含增广 / 行阶梯 / RREF / 线性方程组等关键词时，模型额外返回 `linearSystems`（增广矩阵、最终 RREF、解的类型）；本地重算 RREF 并比较（忽略零行）与解的类型，不一致在该题下标出并显示正确 RREF。读不出的矩阵跳过，不报错误。
- **划词提问**：讲解 `<article data-selection-context="walkthrough" data-walkthrough-project data-walkthrough-set>`，每部分 `<section data-walkthrough-section data-section-title>`。`SelectionTranslator` 在此范围内选「解释 / 提问」时不弹原来的贴边弹窗，而是 `openPassage()` 打开**浮动窗口**（`features/homework/floatingQAStore.ts` zustand：位置 / 大小 / 层级 / 最小化，最多同时 3 个，第 4 个把最靠后的收进右下角停靠栏；整窗始终在视口内；层级按排名 41–43，停靠栏 z-44，均低于对话框 z-50）。问答走 `contextual-tutor/v3`（新增 `walkthrough` 语境：解法已在眼前，可完整解释并指出计算错误；`history` 带最近 6 轮）。
- **保存问答**（`WalkthroughNote`，Dexie v17 `walkthroughNotes`，索引 `[setId+updatedAt]`）：原文以 `TextAnchor`（文本 + 前后各 32 字，`shared/lib/textAnchor.ts`，与 `Range.toString()` 同口径）保存，不存位置；重新定位时按文本搜索，多处出现按前后文选最匹配。保存后追问自动追加；窗口拖动 / 调大小后记住位置。原文用 CSS Custom Highlight API（`walkthrough-note` / `walkthrough-flash`）标记，点击标记处（`caretPositionFromPoint`）重新打开；每部分下有本节问答芯片；「我的问答」对话框可搜索 / 打开 / 重命名 / 删除，找不到原文的标“原文已更新”。以“解释”开始的问答以原文命名。
- **窗口的三种形态**（`floatingQAStore`：`compact?: CompactCard` / `tucked?: boolean`，`windowMode()` = full | compact | tucked | minimized）：标题栏「缩成小卡片」「收进原文」。**小卡片**（`CompactCardView`）：标题 + 最新问题 + **完整**最新回答；默认宽 320 px（`defaultCardWidth`，按视口收窄），高度在渲染后实测内容自动贴合（`fitCardHeight`：头部 + 正文实测高，上限 min(60vh, 520 px)，超出才让正文滚动——可见滚动条 + 未到底时底部渐隐；手指 / 笔在可滚动正文上是滚动而非拖动），新回答到来（`useLayoutEffect` + `ResizeObserver`）重新贴合；右下角调整大小把手（`data-card-resize`，触屏 44 px，Pointer Events + 捕获 + 拖动阈值，最小 240×120、最大视口减边距，`clampCardSize`）设置后 `manual: true` 不再自动贴合，尺寸记在窗口 `cardSize`（本次访问再次缩成卡片沿用）并经 `persistCardSize` 存到已保存问答的 `WalkthroughNote.cardSize`（同 `rect`）。`CompactCard` 带可选 `width` / `height` / `manual`，`clampCard` / `convertCardPin` 用卡片实际尺寸（`cardSize()`，`CARD_SIZE` 320×140 只作未测量前的回退），换算固定 / 跟随时尺寸保留；拖动 / 点击展开（`expand` 回到原尺寸、放在卡片当前位置）；不计入 3 个完整窗口，最多 6 张（`MAX_COMPACT_CARDS`），超出的最靠后一张进停靠栏；`pinned` 时 `position: fixed`（视口坐标，层级 35–40，低于完整窗口），否则渲染进讲解里的 `data-walkthrough-card-layer`（`absolute inset-0`，内容坐标，随页面滚动，不监听滚动）；切换用纯函数 `convertCardPin`（按卡片层的视口位置换算，不跳），`clampCard` 分别夹在视口 / 卡片层内；`cardPinned` 记住本次访问上次的选择（默认固定）。**收进原文**：窗口不渲染，原文用 `walkthrough-link`（虚线下划线，priority 1，高于 `walkthrough-note`）标记；文章 `pointermove`（rAF 节流）经 `caretAt` + `hitPassage` / `pointInPassage`（`isPointInRange` + 行框校验）命中后，`usePassageHover`（进 150 ms / 出 200 ms，悬停在卡片上保持，Esc 关闭）显示 `PassageHoverCard`（portal、z-45、`computeSelectionPopupPosition` 定位于所在行，最新问答最高 320 px 可滚动，「展开窗口」+「保存」或「复习卡片」）；已保存问答的 `walkthrough-note` 标记同样悬停显示。点击标记打开完整窗口。未保存的收进原文问答在本节问答芯片里有虚线芯片（`data-tucked-chip`）作为键盘入口；只存在于本次访问的 store 中。
- **导入讲解**（「导入讲解」按钮：工具栏与空状态；`widgets/homework/walkthrough/ImportWalkthroughDialog.tsx`，服务 `services/walkthroughImportService.ts`，提示词 `walkthrough-import/v1`，本地校验 `entities/homework/walkthroughImport.ts`）：
  - **文件**：对话框里「上传文件」走现有上传 / 处理流程（PDF / Word / 图片 OCR / Markdown / 文本；`ACCEPTED_TYPES` 新增 `txt` / `md` / `markdown` 作为 `text` 类型），资料角色 **`walkthrough_import`**（「导入的讲解」，`isReferenceOnlyMaterial()` 为真：不进课程分析与 `sourceHash`、测验片段、导师来源、课程词汇、幻灯片学习、首页资料数）；也可选择项目里任何已处理的文件（`importableDocuments`，导入角色排前，作业文件除外）。
  - **AI**（`prepare`）：分块按 `planAnalysisSegments` 切成每份 ≤ `importSegmentChars(ai.maxOutputTokens)` 字（回复是同一文字重新排版、通常更长：按 1.3 token / 字 + 1 500 估算并只用输出上限的 80%；8 192 上限约 3 900 字，最多 12 000 字；预览记下 `segmentChars`，继续时沿用），逐份请求，每次请求前检查 `shouldContinue()`。**输出预算**（`importOutputBudget`）按该段字数估算、不超过已解析的输出上限；回复被截断 ⇒ 预算翻倍直到上限；在上限处仍截断（`OutputTruncatedError.atCap`）⇒ `splitImportPieces` 把这一段对半拆开（多个分块按分块边界，单个分块按段落 / 换行，绝不在 `$$…$$`、`\[…\]`、`\begin…\end` 中间拆；短于 600 字不再拆）递归读取，提示加 `fragment`（「只导入这一片段」，不带时提示与以前逐字相同），各片结果按顺序 `mergeImportParts`。已读的片段按文本哈希存在预览的 `pieces`（`'split'` 标记已拆开的段），暂停返回 `complete: false` 的预览（`parts` + `pieces`），`resume` 只读剩下的；某一段失败抛 `WalkthroughImportPartError`（带 `partial` 预览），对话框保留已读部分，显示按导入语境的提示（「导入的讲解第 x / y 部分太长：当前模型单次最多输出约 N token……」/ 设置上限 / 未写完 / 其它原因，`importPartMessage`）与「继续导入」（重新读取 AI 设置后只请求失败的片段与剩余部分）。进度「正在读取第 x / y 部分」显示正在读的那一部分。输入 = 本作业题目清单（id + 题号 + 题面前 400 字，`QUESTION LIST`）+ 文件文字，均以 `untrustedContentWrapper` 包裹 + `securityFooter`，带科目画像。输出 `{overview, questions:[{questionId, conclusion, analysis, body, issues?, linearSystems?}], summary, suggestions, other}`；`normalizeImport` 只接受清单内的 id（其它记入 `unknownIds` 丢弃，不按题号猜）。模型只做排版（Markdown + LaTeX，数值不变），可疑处只能写进 `issues: [{quote, note}]`，**正文保留原作者的计算**；「只排版，不核对」（`checkIssues: false`）的系统提示不含 issues 部分。多份结果 `mergeImportParts` 合并（同题正文按顺序拼接，开头取第一份、小结取最后一份）。
  - **本地校验**：每节正文须来自文件——NFKC（康熙部首 ⾏→行、½→1⁄2）+ 小写 + 去 LaTeX 命令后，词 / 数字 / 中文二字组至少 60% 出现在文件中（`MIN_TOKEN_COVERAGE`），且 ≥4 个不同数字时至少 80% 的数字出现在文件中（`MIN_NUMBER_COVERAGE`），否则该节被拒（`not-in-source` / `numbers-changed`，对话框列出）；`issues` 的引文须在该节或文件中，否则丢弃。线性代数科目或含行化简时要求 `linearSystems`，与生成的讲解一样本地 RREF 核对（`checkLinearSystems`）。
  - **保存**（`commit`，`WalkthroughRepository.putSections` 单事务）：存为普通讲解节，`origin: 'imported'` + `sourceDocumentId` + 可选 `issues`，`inputHash` 用当前题目哈希（不显示「可更新」）；文件中不属于任何题目的内容存为「其它内容」节（id `other`，`kind: 'other'`，仅在存在时出现在 `planWalkthrough` 末尾，不可重新生成）。**导入不覆盖生成的讲解**：已有生成的讲解时它整份保留为该节的另一来源（见下条「讲解来源」，预览 `keptGenerated` 提示可切换），导入的版本成为显示的来源；只有**之前导入过**的节才算替换：对话框显示「替换 n 节并导入」，未确认时服务抛 `IMPORT_NEEDS_CONFIRMATION`，之前导入的版本存进 `previous`（`origin` / `sourceDocumentId` / `issues` 也进 `WalkthroughSectionVersion`）。有生成任务进行中时不能导入。保存后 `notifyWalkthroughChanged()` 让面板重读。
  - **显示**：节标题旁「来自导入」徽标 + 「查看原文件」链接（`ImportedSection.tsx`）；`issues` 在正文后显示为「这里可能有误」（引文 + 建议，注明原文未改动）。重新生成这一节 / 补充题目分析 / 划词提问 / 保存问答 / 打印对导入的节同样可用（重新生成后的节不再是导入的，导入版本留作上一版）。
- **讲解来源：生成的讲解 / 导入的讲解**（未升 Dexie，`entities/homework/walkthrough.ts`）：节自身字段始终是**显示中的来源**，另一来源整份存在 `WalkthroughSection.alternate`（`WalkthroughSourceVersion` = 去掉 `alternate` 的整节：它自己的 `previous`、详细版、`level`、对照报告、引导练习缓存都随之保存），所以页面、RREF 核对显示、打印、引导练习、划词问答（按文字重新定位）、与教授答案对照都自动用显示中的来源。`switchSectionSource` 互换（`HomeworkWalkthroughService.setSource`，进行中的任务时拒绝）；节标题旁「生成的讲解 / 导入的讲解」切换（`SourceToggle`，`aria-pressed`，`data-walkthrough-source`，只在两种来源都就绪时显示，两种风格与暗色，触控 ≥44 px）。**写入不丢来源**：`WalkthroughRepository.putSection` 经 `mergeSectionWrite` 写入——同一来源则替换并保留 `alternate`；另一来源且已完成（ready、无草稿）则成为显示的来源、原来显示的保留为 `alternate`；另一来源未完成（草稿 / 失败）则存进 `alternate`、显示不变；属于其它来源的 `previous` 丢弃（每个来源只保留自己的上一版）。**生成只针对生成的来源**：整份生成 / 重新生成这一节 / 按教授答案修改用 `writingState`（计划条目换成 `generatedSource`），所以重新生成时导入的版本保留、新生成的版本完成后显示（按钮提示说明），旧的生成版本进 `previous`；只导入过的节重新生成后生成版显示、导入版成为另一来源。**新鲜度**：`planWalkthrough` 的 `needsWork` / `outdated` 按生成的来源判断（`entry.generated`），只导入过的节仍按导入时的哈希（与以前相同）。导入的来源只有一个详略（`sectionLevel` 恒为 standard、不显示普通 / 详细、`missingDetailed` 与「全部切到详细版」跳过）。**旧数据**：以前导入把生成版放在 `previous`（来源不同）——`normalizeSectionSources` 读取时把它当作 `alternate`（`state()` 与写入时都经过它），没有导入过的行不变。
- **与教授答案对齐**（2l）：
  - **写作**：提示词 `homework-walkthrough/v6`（v1–v5 保留，注册表已切到 v6）在题目 / 小题 / 详细版系统提示上加 `{ alignProfessor: true }`，**只在该题有已对上且非「留给学生」的教授答案时发送**（`professorAnswerOf`，`entities/homework/walkthrough.ts`）：通读整份教授答案按内容对应小题（某小题可能写在另一小题的解答里，解答里的 (a)/(b) 可能是「两种方法」）；沿用教授的方法、步骤顺序、矩阵与行变换、记号与答案形式，不换方法；可加讲解但须支持教授的路线；其它方法 / 额外检验放在后面并以「**补充（考试不要求）：**」开头；覆盖题目或教授答案里出现的每个小题；教授答案没覆盖的小题注明；明显笔误按原意写并加一行「注：」。**不带该选项时与 v5 逐字相同**，`CACHE_VERSION` 仍为 `'v1'`（有测试）。
  - **哈希**：`questionSectionHash` 只对有教授答案的题加入 `alignProfessor: PROFESSOR_ALIGN_VERSION`（`'align-v1'`），所以只有这些节显示「可更新」，其它节哈希不变；开头 / 小结的哈希用不含该键的题目哈希（`{ align: false }`），不会因此过期（重写任何题时本来就会重写开头 / 小结）。按此写成的节记 `professorAligned: { answerHash }`（进 `previous`，恢复上一版时互换），答案未变时显示「已按教授答案」徽标（页面与打印）。
  - **对照**（`walkthrough-compare/v1`，`services/homeworkWalkthroughService.ts` 的 `compareSection` / `compareAll` / `dismissCompare`，本地校验 `entities/homework/professorCompare.ts`）：只发本题题面、教授答案、本节**普通版**结论 + 正文（均 `untrustedContentWrapper` + `securityFooter`，带科目画像，usage `walkthrough`）。返回逐小题 `{label, status: same | method_differs | result_differs | missing_in_walkthrough | not_in_professor, note, professorQuote?}` + `recommendation` + `suggestion`；同样要求按内容对应小题，只有教授答案**任何地方都没覆盖**时才用 `not_in_professor`。`validateCompare`：标签须是本题小题或教授答案中出现的小写 `(x)`（`professorAnswerLabels`），否则丢弃，同一小题只留第一条，按题目顺序排列；引文按 `quoteFoundIn`（NFKC 等规范化）在**整份**教授答案中查找，找不到只丢引文；`result_differs` 附本地 RREF 核对结论（`localCheck: verified | mismatch`）；`recommendation` 由状态本地推出（有结果不同 / 缺少 → fix，方法不同 → align，否则 keep）；一条都不剩 ⇒ `INVALID_RESPONSE`，节不变。报告存为 `WalkthroughSection.professorCompare`（`answerHash` / `sectionHash` = 普通版结论 + 正文指纹 / `items` / `recommendation` / `suggestion` / `comparedAt` / `dismissed?`；未升 Dexie），任一侧变化即过期不显示（`currentCompare`）；保存时事务内再核对正文未变。
  - **界面**（`widgets/homework/walkthrough/ProfessorCompare.tsx`）：有教授答案的就绪节标题旁「与教授答案对照」；报告为可折叠列表（状态徽标 + 说明 + 教授原文引用），「按教授答案修改」= `regenerateSection(..., { suggestion: alignSuggestion(report), align: true })`（建议 ≤1 000 字；只重写普通版，旧版进 `previous`，详细版丢弃），「保持现状」= `dismissed`（报告折叠）。工具栏在有「既未按教授答案写、也没有有效对照」的就绪节时显示「n 题有教授答案，可对照」+「对照全部有教授答案的题」（并发 2，可暂停 / 立即停止，暂停后「继续」只对照剩下的；`pausedRuns.compare`）。从不自动调用 AI。
- **原题中文翻译**（「查看原题」与做题页题面，`widgets/homework/QuestionText.tsx`）：题面不是以中文为主（`isMainlyChinese`）时显示「原文 / 中文翻译」切换（`aria-pressed`，`data-print-hidden`，两种风格，本次访问记住每题选择、不存储）。第一次点「中文翻译」才发一次请求（`services/questionTranslationService.ts`，提示词 `question-translate/v1`：逐句忠实翻译成简体中文，公式 / 符号 / 小题编号 / 数字原样，保留行与段落，关键术语首次出现附英文，不解释不提示；`untrustedContentWrapper` + `securityFooter`；usage `walkthrough`；可「停止」）；本地 `checkTranslation`（`entities/homework/questionTranslation.ts`）：原题每个 `$…$` / `$$…$$` / `\[…\]` / `\(…\)` 公式须原样（忽略空白）出现、每个小题编号（正文中的 (a)…(iv)，NFKC 后比较）须出现、每个数字出现次数不少于原题，否则丢弃并提示「重新翻译」。结果存在 `HomeworkQuestion.translation = { language: 'zh', sourceHash, promptVersion, text, createdAt }`（可选字段，未升 Dexie，保存前再核对题面未变）；题面变化后 `currentTranslation` 失效，再点时重新请求。译文与原文同样经 `formatHomeworkQuestion` + `RichText`（markdown）渲染；打印只有原文。
- **问答标记样式**（设置页「问答标记样式」，`widgets/settings/NoteMarkStyleSetting.tsx`；`UserProfile.noteMarkStyle: 'link' | 'highlighter'`，缺省 `link`；`features/theme/noteMarkStyle.ts` 的 `applyNoteMarkStyle` 写 `<html data-note-mark>`，`App.tsx` 随 profile 应用，切换即时生效）：`globals.css` 用 `::highlight()` 标记 `walkthrough-note`（已保存，较深）与 `walkthrough-link`（收进原文未保存，较浅）。链接样式 = `--primary-strong` 文字 + 下划线（已保存实线 2px + 极淡底色，未保存虚线）；荧光笔样式 = `--primary` 半透明底色（已保存 0.28 / 未保存 0.13，暗色 0.36 / 0.18）。颜色全部取主题 token；`--primary-strong` 对页面背景 ≥3:1（Pink Aqua 浅色 3.5:1 为最低，`tests/themeContrast.test.ts` 断言），且有下划线不只靠颜色区分。
- **加入复习卡片**：每轮问答一张卡（`ReviewCardSource` 新增 `note`），问题很短时正面附原文，背面过长在段落处截断；按正面去重。
- **打印 / 导出 PDF**：`WalkthroughPrint` 只在打印时把纯净副本挂到 `body` 下，`body.printing-walkthrough` 的打印样式隐藏其它内容并强制白底黑字；`afterprint` 后卸载。
- **删除与导出**：两表随作业删除（`deleteAssignment` / 删除作业文件 / 删除项目，均在同一事务）、纳入导出；**保存过的问答计入学生作业**（`studentWorkFor`），有问答的作业文件不能被直接删除。
- 做题模式下首次进入显示“包含全部解法”提示（每份作业只出现一次：点「我知道了」后记在作业行 `HomeworkSet.walkthroughNoticeSeenAt`，刷新或下次进入都直接打开讲解）。只做桌面端布局。

### 教授出题习惯档案（课程主页「教授出题习惯」，`?tab=habits`）

- **数据**（未升 Dexie、未新增表）：`CourseContext.questionHabits?: QuestionHabitsProfile`（`entities/questionHabits/types.ts`）= `items[{ id, category: types | structure | wording | notation | numbers | traps | answer_format | difficulty, statement（≤240 字）, evidence[{ documentId, kind?: homework | practice | syllabus, questionId?, setId?, chunkId?, quote }], userEdited?, createdAt, updatedAt }]` + `sources[{ documentId, kind, hash, analyzedAt }]`（已读过的文件与其全部题目文本的指纹 `habitSourceHash`）+ `enabled?`（「模仿教授出题」，缺省开）+ `promptVersion` + `updatedAt`。随 `courseContexts` 导出 / 恢复，删除课程时一起删除（有测试）。**只有** `CourseContextRepository.updateQuestionHabits(projectId, fn)`（事务内读改写，必要时建行）写这个字段；`upsert` 与增量分析事务里写派生上下文时用 `keepStoredQuestionHabits` 保留库中现有档案（派生上下文是先读后写，避免覆盖期间的更新）。
- **题目来源**（`QuestionHabitsService.collectDocuments`，本地）：非练习作业的已识别题目（不含已归档）、教授练习题（题干 + 选项）、`syllabus` 资料中像题目的分块（`looksLikeQuestion`：问号 / 编号 / 任务动词）；按文件分组。
- **分析**（`analyze(projectId, { control, force, onProgress })`，同一课程同时只跑一个）：`planHabitSources` 找出新的或指纹变了的文件与已消失的文件；消失的文件先本地移除其例子（`dropRemovedSources`，AI 条目没有例子了就删除，学生条目保留）。新 / 改动的文件每份最多 20 个单元（均匀抽样，每单元 ≤600 字），按整份文件组成 ≤14 000 字的批次（`batchHabitDocuments`），逐批请求；每批完成即合并保存（该批文件记为已读），批次之间检查 `shouldContinue()`，立即停止中断当前请求，已完成的批次保留（「继续」只读剩下的文件）。`force`（「全部重新分析」，先确认）先清掉 AI 条目与已读记录。usage 记为 `analysis`。
- **合并**（`mergeHabitsReply`，纯函数）：每条引文先在其标注的单元、再在本批任一单元中按 `normalizeEvidenceText`（NFKC + 小写 + 统一引号 / 破折号 + 合并空白，≥4 字）查找，找不到的引文丢弃；**新条目没有找到的引文、类别不合法或为空即丢弃**（计入 `dropped`，界面提示）；已有条目（短 id）可修订措辞 / 类别并合并新例子（每条 ≤5 个）；`remove` 删除条目；**学生写过或改过的条目（`userEdited`）永不被修改或删除**；与已有 AI 条目措辞相同的新条目并入其例子；总数 ≤40。
- **界面**（`widgets/questionHabits/QuestionHabitsPanel.tsx`）：「分析教授出题习惯」/「用新资料更新」（未配置 AI 时提示）、进度「正在读取资料 x / y」+ 暂停 / 立即停止 / 继续；待读资料提示（列出文件、注明会调用 AI，从不自动请求）；「模仿教授出题」复选框；按类别列出条目，「x 个原题例子」可展开（引文 + 「查看来源」：作业 → 作业页，教授练习 → 练习页，大纲 → 文档页），编辑 / 删除（确认）/ 添加（类别 + 文字，标「你写的」）；「全部重新分析」。作业首页在有未读入档案的已识别作业时显示 `HabitsSuggestion`（链接到该标签，不调用 AI）。
- **使用**：`buildHabitsBlock(profile)`——开启且有条目时，每条一行 `- [category] statement`，例子多的（学生条目最优先）在前，合计 ≤1 800 字（约 600 token）；否则 `undefined`。`QuizService.generateQuiz`（主题 / 混合 / 考试范围；存进 `QuizResumeState.professorHabits`，「继续出题」沿用）、`OralExamService.fill`（`loadProfessorHabits`）与 `PracticeSetService`（`BuildContext.professorHabits`）把它作为 `professorHabits` 传给提示词；关闭开关或没有档案时请求与以前逐字相同。
- **本地线代方程组**：`linearStyleHints(profile)` 只从条目文字本地读出提示（numbers / structure / notation / types / difficulty 类）：`m×n`（含「增广」时 n−1 为未知数个数，只认 2–4 行 / 2–5 个未知数）→ 行数与未知数范围；「整数 / 不含分数」且未提到分数 / 小数 → `integerOnly`；只提到增广矩阵或只提到方程组写法 → `presentation`。只作用于**精简版**的本地题（完整版仍按原题镜像）：`applyLinearHints` 把行数 / 未知数夹到范围内后 `normalizeSpec`，`integerOnly` 时先用 `buildLinearSystem(spec, rng, { maxFractions: 0 })`（手算消元不出现分数），构造不出再退回默认；`presentation` 决定增广矩阵还是方程组。没有档案或已关闭时行为不变（有测试）。

### 讲解末尾「做练习题」（练习作业）

- **入口**：完整讲解小结就绪后，文章末尾显示 `widgets/homework/practice/PracticeSetLauncher.tsx`（「做练习题」+ 本作业已有的练习作业链接）；对话框选「完整版 / 精简版」（显示题数与本地构造题数，`PracticeSetService.preview`），出题中显示阶段进度与暂停 / 立即停止 / 继续。练习作业本身不再显示此入口。
- **数据**：练习作业是普通 `HomeworkSet`，`kind: 'practice'` + `parentSetId` + `practice: PracticeSetInfo`（`mode` / `requested` / `dropped` / `droppedReasons` / 未完成时的 `draft`）；**与原作业共用 `documentId`**，因此删除原作业（`deleteAssignment` / 删除作业文件 / 删除项目）时一并删除；`ensureSetForDocument` 与 `reconcileSets` 排除练习作业（`isPracticeSet`），`retrySet` 对练习作业报错，作业页不显示「重新识别」。题目为普通 `HomeworkQuestion`：`sourceRefs: []`、`hints: []`、`solution` = 本地或核对后的参考解法，`practice: PracticeQuestionInfo`（`origin: local | ai`、每小题 `answer` + `grader`、`knowledgePoints`、完整版的 `sourceQuestionId`）。**未新增表、未升 Dexie**；随导出（`homeworkSets` / `homeworkQuestions`）。作业首页在原作业卡片下列出练习作业（`PracticeSetRows`：打开 / 继续 / 单独删除，`deletePracticeSet` 同一事务删除题目、讲解、问答、作答图片，不动文件）。
- **规划**（`entities/homework/practice/plan.ts`，纯函数）：完整版每题一个 slot，小题按 `walkthroughSubparts` 切分；该题讲解节的 RREF 核对（`checks`，每小题一条且都能读出）给出各小题的方程组形状与解型 → 整题本地构造，否则交给 AI（要求相同小题标签与解型）。精简版：`summaryKnowledge` 读小结表格首列 / 标题为分类（无则用要点），每类一题 + 综合题（≤3 类 1 道，否则 2 道，上限 12）；线性代数且分类涉及方程组 / 解型的本地构造（综合题为无解 / 唯一 / 无穷三小题）。
- **本地构造**（`practice/linearSystem.ts`）：先写目标 RREF（主元、自由列不在第一列、无解时 `0 = 1` 行），再左乘随机幺模整数矩阵（行加减 ±1/±2 + 行打乱）；拒绝系数 >9、右端 >20、零行 / 零列、首列无 ±1/±2、按合理手算消元出现 >2 个分数的候选（`eliminationFractions`）；`rref.ts` 重算并核对解型与自由变量数。题面按原题用增广矩阵或方程组（`equationsLatex`），语言随原作业（`en` 英文，否则中文）；解法 = RREF + 结论 + 通解（参数 t, s）。
- **AI 出题**（`practice-generate/v1`，带科目画像，每请求 ≤4 个 slot）：返回 `{questions:[{slot, stem, parts:[{label, prompt, answer, solution, check}]}]}`；`check` 为 `linear_system`（增广矩阵 → 本地 RREF、解型须与声明及原题一致，答案与解法改用本地结果）/ `numeric`（算式本地求值，与答案相差 >0.1% 丢弃，带合法单位时按带单位判分）/ `chem_equation`（解析且原子与电荷守恒）/ `null`（不核对，AI 检查答案）。完整版小题结构不符、核对失败、漏写都记为丢弃原因。
- **审核**（`practice-review/v1`，每请求 ≤10 题，闭集 id `p1…`）：附原作业题目（每题 ≤600 字）、小结知识点、每题文本与答案、完整版的期望结构；只返回 `{id, pass, reason}`，缺失的 id 视为未通过。第一轮未通过：本地题换种子重新构造、AI 题带「Rejected before: 原因」重出，再审；第二轮仍不通过则丢弃（`droppedReasons`）。审核从不改题目或答案。
- **生成控制**：`draft`（slots / candidates / 待写 slot / 已丢弃 / 第几轮）每步后存到练习作业行；暂停 = 下一请求前停（状态 `paused`），立即停止中断请求同样存为暂停；AI 错误存为 `failed` + 可操作提示，「继续」从断点做（`resume`）。全部被丢弃时作业为 `failed`（「没有题目通过核对与审核」）。
- **做题与判分**：做题 / 检查答案 / 引导练习 / 完整讲解与普通作业相同（讲解把参考解法当作已有解法）。「检查答案」在无图片时先用 `checkPracticeAnswer` 本地判分（方程组：无解关键词 / `x1 = …` 数值 / 含参数通解代入全部方程并核对参数个数与独立性；数值 / 带单位 / 化学方程式复用现有判分器；多小题按 `(a)(b)` 拆分作答，部分对为 `partial`），读不出再走 AI 检查。练习作业的检查结果（非 `uncertain`）经 `services/practiceLearning.ts` 记入错题本与掌握度（知识点 = 题目第一个知识点，否则练习作业标题）。

### 作业引导练习（作业页「引导练习」，`?view=guided`）

- **入口**：`HomeworkPage` 工具栏「做题 / 复习 / 引导练习 / 完整讲解」，`?view=guided` 时题目导航保留，当前题渲染 `widgets/homework/guided/GuidedPracticeView`（`key` = 题目 id）；做题模式下 `HomeworkQuestionView` 的「引导练习」卡片（`onStartGuided`）同样进入。**原线性代数「六步学习引导」`HomeworkStudyGuide` 已删除**（不并存两套引导）；保留的部分：`linearAlgebraGuide.ts` 的方法候选与模板文案（`homework.guide.method.*` / `template.*`），作为引导练习题目下方可折叠的「从哪里开始」。
- **步骤来源**（`services/guidedStepsService.ts`，`GuidedStepsService.load / prepareSteps / saveProgress / resetProgress`）：只取该题**已就绪**的完整讲解节（无则提示「去完整讲解」）；有详细版（`detailedVariant`）先用详细版，读不出矩阵步骤再试普通版。
  - **矩阵题**（不调用 AI，`entities/homework/guidedMatrix.ts`）：`buildGuidedChains(body)` 复用 `splitSteps` 的步骤卡片识别，按「新小题标题 / 步骤编号重新从 1 开始 / 本步原矩阵 ≠ 上一步所写矩阵」切成若干练习（`GuidedChain`：`label` 小题标题、`start`、`bar`、`steps[{ops, mode, opLatex, hint, result}]`、`final`）；每步按所写变换**精确重放**（同时作用 / 依次作用取与所写一致者，讲解的笔误由重放纠正），任一步读不出或不是可逆初等变换（`isInvertible`：变换作用于单位阵后 RREF 仍为单位阵）⇒ 整个练习丢弃。`hint` = 步骤句中的说明，否则取紧挨的上一段文字（跳过标题与纯公式段）。
  - **其它题**：一次 `guided-steps/v1` 请求（带科目画像，usage `walkthrough`，可停止，瞬时错误重试 2 次）把讲解（结论 + 正文，≤16 000 字）转成 3–8 步，每步 Markdown 文本含 `[[id]]` 空格 + `explanation`（提示）+ `blanks[{id, answer, kind, accepted?, tolerance?}]`。本地 `validateGuidedSteps`（`entities/homework/guidedSteps.ts`）：每个空格的答案须在讲解中出现（`looseMathText`：`\frac`→`/`、去 `^{}` 花括号 / `\text{}` / `\ce{}` / 空白 / 括号 / 乘号后做子串比对），否则丢弃该空并以 `…` 代替（`droppedBlanks` 计数显示）；`kind` 须属于科目允许的判分器（`allowedBlankKinds`：数学 expression/number/text、物理 quantity/number/expression/text、化学 chemistry/number/quantity/expression/text、统计 number/expression/text、生物 / 医学 number/quantity/text、计算机 exact；其它科目全部），否则退为 text（计算机退为 exact）；≤12 步、每步 ≤4 空。全部空格都被丢弃 ⇒ 报错不保存。结果作为 `GuidedStepsCache`（`promptVersion` / `level` / `sourceHash` = `guidedSourceHash(level, conclusion, body)` / `steps` / `droppedBlanks`）存到讲解节的 `WalkthroughSection.guided`（`updateSection` 事务内再核对讲解文本未变，否则 `CONCURRENT_MODIFICATION`）；讲解文本或版本变化后自然失效，需再点「准备」。
- **矩阵题交互**（`GuidedMatrixPractice`）：每步先填行变换 → `judgeOps`：`parseTypedOps`（`normalizeTypedOps` 把 `R2 -> R2 - 2R1`、`R_2→R_2-2R_1`、`R2 = R2 - 2R1`、`R1 <-> R2` / `↔` / `交换 R1 R2` / `R1 与 R2 互换`、`R2/3`、`1/2 R2`、`(1/2)R2`、`0.5R1`、下标数字、全角减号、LaTeX 统一后交给 `parseRowOps(…, short=true)`，短写 `R2 - 2R1` 即 $R_2 \to R_2 - 2R_1$；逗号分隔多个变换，能同时作用就同时作用，否则依次）。拒绝原因：`unreadable` / `out-of-range` / `not-invertible`（`R2 -> 2R1`、`R2 -> 0R2`）/ `no-change` / `no-progress`。接受：结果落在讲解路线上更靠后的位置（`routePosition`，可跳步），或是**别的合法路线**——按标准高斯–约当（`standardOps`）剩余步数减少，或不多于 +1 且「系数部分零元个数 + 首元为 1 的行数」（`tidiness`）增加。变换正确后才开放结果矩阵（`MatrixInputGrid`，每格 44 px 高，Tab 换格、Enter 检查）；「一键填入未变的数据」（`fillUnchanged`，只填 provenance 为空的行）；`checkCells` 逐格精确分数（`parseTypedCell` = NFKC + `parseCell`：`-2/5`、`−0.4`、`\frac{-2}{5}` 均可）：空 / 正确 / 错（标红 + 只给左边的算式 `entryArithmetic` 去掉 ` = 结果`，未改动的行提示照抄）/ 读不懂 / 小数接近但不精确（提示写分数）。全对 ⇒ 记入 `records` 进入下一步；到达讲解的最后矩阵或（行最简形且与讲解 RREF 相同）⇒ 该练习完成（`chainFinished`），显示是否与讲解结果一致。「提示」：路线上显示讲解对这一步的说明（没有则通用提示），偏离路线时说明路线不同 + 通用提示；「看这一步答案」：路线上用讲解的变换、偏离时用标准高斯–约当的下一步（`nextReferenceStep`；已接受自己的变换时用其结果矩阵），直接完成该步并标「看过答案」。
- **空格题交互**（`GuidedBlankPractice`）：逐步出现，空格显示为 $\boxed{n}$，每空一个 `MathField`（模式按 kind：expression / number / quantity / chemistry / text）；`services/guidedGrading.ts` 的 `gradeBlank`：expression → `compareMath`、number → `numericEquivalent`（默认 1%，可带 `tolerance` ≤10%）、quantity → `splitQuantity` + `compareQuantity`（缺单位 / 量纲不对给出原因）、chemistry → `parseEquation` + `compareEquations`（不是方程式时按可接受答案）、text → `blankAccepted`、exact → `normalizeProgramOutput` 精确比较；无法判定（`unverified`）不算错、可通过。无空格的步骤只有「继续」。
- **进度**（`entities/homework/guided.ts`）：存在题目行 `HomeworkQuestion.guidedProgress`（`key` = 步骤指纹 `chainsKey` / `blankStepsKey`，`kind`，矩阵 `chains[{records[{op, hintViewed?, answerViewed?}], pending?{typedOp, op, cells, hintViewed, answerViewed}, done?}]`，空格 `steps[{values, hintViewed?, answerViewed?, done?}]`，`completedAt`）；学生路线由 `records[].op` 重放（`replayRoute`），刷新后从 `pending` 接着做。步骤指纹变了 ⇒ 从头开始（`progressFor`）。`useGuidedQuestion` 改动后 400 ms 保存、离开题目时立即保存；「重新开始」（确认后）删除该字段。`guidedHasWork` 并入 `hasStudentWork` ⇒ 计入学生作业（重新识别时保留、作业文件删除保护）；随题目导出 / 删除，未新增 Dexie 表。完成后显示小结（完成步骤 / 用过提示 / 看过答案）。
- 两种界面风格（`lecture:` / `lab:` 变体）与暗色模式；所有按钮 / 输入 ≥44 px（`h-11`）。

### 作业作答图片与手写板（「你的作答」）

- **入口**（`widgets/handwriting/AnswerImages.tsx`，嵌在 `HomeworkQuestionView` 的作答框下）：「上传图片」（`accept="image/*"`，平板可直接拍照，可多选）与「手写板」。每题多张（上限 `MAX_ANSWER_IMAGES_PER_QUESTION` = 12），缩略图可点开放大（上一张 / 下一张）、前移 / 后移、移除；只有图片没有文字也能「检查答案」。
- **存储**：Dexie **v19** 新表 `homeworkAnswerImages`（`id, projectId, setId, questionId, [questionId+order]`；行 = `mimeType` / `bytes: ArrayBuffer` / `order` / `source: upload | pen` / 宽高 / `createdAt`），`entities/homework/answerImages.ts` + `answerImageRepository.ts`，服务 `services/homeworkAnswerImageService.ts`。上传先经 `infrastructure/files/imageDownscale.ts` 的 `prepareAnswerImage`：长边缩到 ≤2000 px，透明处填白；JPEG / PNG / WebP 够小时原样保存，其它可解码的位图（如 iPad 相机的 HEIC）转 JPEG；处理后仍 >8 MB 拒绝；SVG / 非图片拒绝；保存前 `ensureStorageFor`。改顺序用整行 `put`（不用 `update`，避免 Dexie 的 JS 克隆丢失 ArrayBuffer）。
- **导出 / 恢复**：`BINARY_TABLES` 新增 `{ table: 'homeworkAnswerImages', kind: 'homeworkAnswerImage' }`，与 `documentBlobs` 一样以 base64 文件条目导出（条目带 `projectId` / `setId` / `questionId` / `order` 等字段），恢复时原样写回；缺 `projectId` 的答案图片条目跳过。
- **删除**：随删除题目（`HomeworkRepository.deleteQuestion`）、删除作业（`deleteSet` / `deleteAssignment`）、删除作业文件（`DocumentService.delete`）、删除项目（`deleteByProject`）在同一事务里删除；重新识别时被替代的空白重复题若带图片则**归档而不删除**。**图片计入学生作业**：`studentWorkFor` 把有图片的题算作有作答（有图片的作业文件不能被直接删除），`setHasStudentWork` 同样计入。
- **AI 规则**（`services/answerImagesAI.ts` 的 `withAnswerImages`）：「检查答案」与逐题 AI 问答把**本题**的图片作为 `ChatMessage.images`（`data:` URL）附在最后一条用户消息上，并附一段说明（图片内容是学生作答、不可信、看不清就说明，不要猜）；**绝不发送其它题的图片**。先带图请求一次；服务商报错且属于“不支持图片”（`INVALID_REQUEST` 或报错文字提到 image / vision / multimodal / content 部分；鉴权 / 限流 / 额度 / 超时 / 取消除外，`isVisionUnsupportedError`）时：有打字内容 ⇒ 去掉图片重试一次，结果带 `imagesIgnored`，界面显示「当前模型不支持识别图片，请换用支持看图的模型或改为打字」+「本次只使用了打字内容」；只有图片 ⇒ 抛 `VISION_UNSUPPORTED`（同一提示），不保存检查结果。**不做本地 OCR 猜测手写内容**。检查结果的 `inputHash` 在有图片时加入 `answerImageKey`（图片 id 按顺序），增删 / 调序后旧结果不再显示；`applyAnswerCheck` 在事务里重算图片键，检查期间图片变了就丢弃结果；`imagesIgnored` 的结果不当缓存（换了能看图的模型可重查）；有图片时不走本地直接比对。问答的学生消息记 `imageCount`，未看图的回复记 `imagesIgnored`。
- **手写板**（`widgets/handwriting/PenBoardDialog.tsx`，纯模型 `strokeModel.ts`，绘制 `inkRender.ts`，纸张 `paper.ts`）：Pointer Events；`pen` 与 `mouse` 落笔，`touch` 永不落笔、拖动时滚动画板（`pointerIntent`）；笔接触期间及抬笔后 `PALM_GRACE_MS` = 600 ms 内忽略手指（防手掌误触）；Pencil 橡皮端（`buttons & 32`）自动用橡皮。压感（`pressureWidth`：0.35×–1.65×，无压力值按 0.5）、笔 / 橡皮（`destination-out`，只擦墨迹层）、撤销 / 重做（Ctrl/⌘+Z、Ctrl+Shift+Z / Ctrl+Y）/ 清空本页、三种粗细、四种颜色（黑 + 主题 `--primary-strong` / `--ring` / `--destructive`，经 `inkFromToken` 把亮度压到 ≤42% 以便在白纸上可读）、空白 / 方格 / 横线纸、加页 / 删页（≤10 页）。逻辑页 1000×1400；**只有 canvas 带 `touch-none`**（touch-action: none）；纸张在暗色模式与两种界面风格下都保持白色（固定纸色，见 `paper.ts`）。保存时每页有墨迹的页面导出为白底 PNG（1400×1960，不含格线）并作为一张作答图片（`source: 'pen'`）；有未保存墨迹时关闭会先确认。所有按钮可用键盘操作并有无障碍名称。

## 7. 路由与目录

| 路由                                           | 页面                           |
| ---------------------------------------------- | ------------------------------ |
| `/login` `/invite`                             | 邀请码门（本地校验）           |
| `/dashboard`                                   | 总览                           |
| `/projects` `/projects/:id`                    | 项目列表 / 详情                |
| `/projects/:id/tutor/:topicId`                 | **课时页**（阅读，缓存）       |
| `/projects/:id/tutor/:topicId/interactive`     | **交互导师**（提问/作答/提示） |
| `/projects/:id/history`                        | 对话记录                       |
| `/projects/:id/quiz` `/quiz/:quizId` `/result` | 测验                           |
| `/projects/:id/mastery` `/mistakes`            | 掌握度 / 错题本                |
| `/projects/:id/cards`                          | 复习卡片（间隔重复）           |
| `/projects/:id/interview` `/interview/:sid`    | 模拟问诊（仅外语课）           |
| `/vocab`                                       | 背单词（全局，侧栏「单词」）   |
| `/projects/:id/documents/:did`                 | 文档详情                       |
| `/settings`                                    | AI 设置 / 数据管理             |

响应式（课时页）：**讲义风格** ≥1200px 为「页边目录（sticky）| ~680px 阅读栏 | 旁注（公式符号等，sticky）」三列，<1200px 目录在课时上方、旁注收进课时下方的折叠区；**精密实验室风格** 为一个细线面板，≥lg「目录 | 正文」，≥xl 再加右侧检查栏（248px），更窄时同样收进折叠区。旧的底部 Sheet 公式面板已移除。只做电脑与平板布局。

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

| 命令                    | 作用                                                                |
| ----------------------- | ------------------------------------------------------------------- |
| `npm run dev`           | 开发服务器（**固定端口 5173**，IndexedDB 按 origin 隔离，勿换地址） |
| `npm run build`         | 类型检查 + 生产构建                                                 |
| `npm run typecheck`     | `tsc -b --noEmit`                                                   |
| `npm run lint`          | ESLint                                                              |
| `npm run format`        | Prettier                                                            |
| `npm test`              | Vitest（`vitest run`）                                              |
| `npm run test:coverage` | 覆盖率                                                              |

完成任务后**必须**跑：`npm run lint` + `npm run typecheck` + `npm test`。

---

## 9. 当前状态与待决项

### 阶段进度

| 阶段  | 内容                                                                                                                                                                                                                                     | 状态                                                                                                                           |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1     | 基础骨架                                                                                                                                                                                                                                 | 已交付                                                                                                                         |
| 2     | 内容库（PDF/DOCX/PPTX/OCR/文本 + 分块）                                                                                                                                                                                                  | 已交付                                                                                                                         |
| 3     | AI Provider · 课程分析 · 导师 · 翻译                                                                                                                                                                                                     | 已交付                                                                                                                         |
| 4     | Quiz · 自适应难度 · 掌握度                                                                                                                                                                                                               | 已交付                                                                                                                         |
| 5     | 错题本 · 薄弱点 · 复习                                                                                                                                                                                                                   | 已交付                                                                                                                         |
| 6     | 知识索引 + 检索（RAG）                                                                                                                                                                                                                   | 未开始                                                                                                                         |
| 7     | 课时化导师 + 公式符号 + KaTeX 打磨                                                                                                                                                                                                       | 已交付（v0.2.4）                                                                                                               |
| 7b    | 教材章节结构 + 课程内容持久化 / freshness                                                                                                                                                                                                | 已交付（v0.2.5）                                                                                                               |
| 7c    | 配色主题（Color Themes，4 套）+ 可访问性                                                                                                                                                                                                 | 已交付（v0.2.5）                                                                                                               |
| 7d    | 章节级增量内容生成（依赖模型 + 稳定 Topic 身份 + 局部提交）                                                                                                                                                                              | 已交付（v0.2.6）                                                                                                               |
| 7e    | 课时级数学可视化（线性/非线性 + 向量/图 + 线性变换/维恩图/特征值 + 教学区块放置）                                                                                                                                                        | 已交付（v0.2.6）                                                                                                               |
| 7f    | 划词浮层定位修复（真实尺寸 flip/clamp + ResizeObserver/visualViewport）                                                                                                                                                                  | 已交付（v0.2.6）                                                                                                               |
| 7g    | 学习流程导航与连续性 + 无障碍 / 错误态                                                                                                                                                                                                   | 已交付（v0.2.8）                                                                                                               |
| 7h    | Precision Lab 视觉方向（蓝图网格 + 仪表细节，四套配色）                                                                                                                                                                                  | 已交付（v0.2.8）；**已被 7z.6 的「精密实验室」界面风格取代**                                                                   |
| 7i    | 首页滚动修复 + 可交互函数图像（一次/二次/三次/正弦）                                                                                                                                                                                     | 已交付（v0.2.8）；**首页函数图像已在 7z.7 删除**                                                                               |
| 7j    | 作业讲解（题目 / 提示 / 解法 / 问答 + 归档 / 恢复）                                                                                                                                                                                      | 已交付（v0.2.9）                                                                                                               |
| 7k    | 作业讲解加固（识别可靠性 / 来源校验 / 进度 / 阅读原图）+ 项目文件管理                                                                                                                                                                    | 已交付（v0.3.1）                                                                                                               |
| 7l    | 按幻灯片学习（PPT/PPTX 逐页导师，Dexie v13）                                                                                                                                                                                             | 已交付（v0.3.1）                                                                                                               |
| 7m    | 作业作答双栏布局 + 桌面侧栏可收起 + 提示/回复公式渲染                                                                                                                                                                                    | 已交付（v0.3.1）                                                                                                               |
| 7n    | 作业讲解关联教授答案并用于复习 / 做题                                                                                                                                                                                                    | 已交付（v0.3.1）                                                                                                               |
| 7o    | 教授答案对应修复（编号解析 / 手动划分 / 一对一校验）+ PDF 数学排版 + 讲解生成可靠性 +「留给学生」识别                                                                                                                                    | 已交付（v0.3.4）                                                                                                               |
| 7p    | 作业复习完整教学讲解 + 「检查答案」+ 最后检查排版 + 逐题问答常驻 + 浏览器语音输入                                                                                                                                                        | 已交付（v0.3.4）                                                                                                               |
| 7q    | 线性代数作业逐题六步学习引导试点 + 题面向量箭头 / 上标显示修复                                                                                                                                                                           | 已交付（v0.3.4）                                                                                                               |
| 7r    | 界面动效 + 首页重设计 + 风格统一（圆角尺度）                                                                                                                                                                                             | 已交付（v0.3.9）                                                                                                               |
| 7s    | 学科适配：科目画像（9 科，含生物）、科目推断、物理单位判分、代码输出题、概率分布图、化学 mhchem                                                                                                                                          | 已交付（v0.3.9）                                                                                                               |
| 7t    | 符号键盘 + 实时识别预览；简答题按得分点计分（测验 / 教授练习 / 导师）；化学方程式题、排序题                                                                                                                                              | 已交付（v0.3.9）                                                                                                               |
| 7u    | 化学 / 生物配图三层：课程原图优先、本地计算的六种图（schema v7）、联网参考图片（Dexie v14，默认关闭）                                                                                                                                    | 已交付（v0.3.9）                                                                                                               |
| 7v    | 大学深度：转录方向与起始密码子、有机方程式与同分异构体、大学单位；t / χ² / F 与卡方检验、伴性与复等位遗传、系谱遗传方式分析、多元酸与弱碱滴定（schema v8）                                                                               | 已交付（v0.4.0）                                                                                                               |
| 7w    | 其它理科可交互图：公式探索器、微积分（切线 / 黎曼和 / 泰勒）、物理（受力 / 运动 / 光路 / 电路）、统计（回归 / 置信区间）、化学动力学、酶动力学、种群增长、排序与 BST（schema v9）                                                        | 已交付（v0.4.0）                                                                                                               |
| 7x    | 医学适配（临床 + 口腔，大一大二）：医学科目画像与安全边界、X / B / 填空题型、医学单位、生理 / 生化 / 药动 / 形态共 14 种图（schema v10）、医学联网参考图片、复习卡片（Dexie v15）                                                        | 已交付（v0.5.0）                                                                                                               |
| 7y    | 大教材：取消 100 MB 上传上限（按剩余存储空间检查，单文件 2 GB）、课程分析按章节分部分读完整本教材并合并、流式导出                                                                                                                        | 已交付（v0.5.3）                                                                                                               |
| 7z    | 测验修复：分批出题与补题、题型按题目自身对应、全书取材、出处无摘录时显示该页原文、按钮防整页翻译                                                                                                                                         | 已交付（v0.5.4）                                                                                                               |
| 7z.1  | 测验质量：选项本地随机顺序、干扰项规则与可疑题丢弃（`quiz-generator/v6`）、混合复习按主题分组、题目语言偏好（默认中文附英文术语）、难度本地化、设置页版本号                                                                              | 已交付（v0.5.5）                                                                                                               |
| 7z.2  | 背单词板块：考试词书（ECDICT）、FSRS 调度、认读 / 拼写 / 填空 / 听写、课程词汇（AI 补释义）、易错词、统计、导入、导出（Anki / CSV / TXT）                                                                                                | 已交付（v0.6.0）                                                                                                               |
| 7z.3  | 作业完整讲解：整份作业的讲义式讲解（工具 / 逐题 / 小结）、线性代数 RREF 本地核对、划词提问浮动窗口（拖动 / 调大小 / 最小化 / 追问带上下文）、保存问答并按原文重新定位、加入复习卡片、打印 / 导出 PDF（Dexie v17）                        | 已交付（v0.7.0）                                                                                                               |
| 7z.4  | 全站审查修复：分块丢字、判分（小值容差 / 积分常数 / 中文判断题 / 续做）、掌握度重算、删除保护、锁定保留设置、课程分析增量 / 同名主题 / 中断恢复、流式收尾与非流式超时、导师竞态、图示计算、参考图片下载、未找到与错误页、CSV / Anki 导入 | 已交付（v0.7.0）                                                                                                               |
| 7z.5  | 界面动效：统一缓动 / 时长变量、高频导航提速、「减少动态效果」只去位移                                                                                                                                                                    | 已交付（v0.8.0）                                                                                                               |
| 7z.6  | 两种界面风格：讲义（默认）/ 精密实验室；风格 token 与配色分层、`lecture:` / `lab:` 变体、全站页面重排、测验键盘作答                                                                                                                      | 已交付（v0.8.0）                                                                                                               |
| 7z.7  | 界面验收修复：切换风格不重载、动画与滚动性能、测验键盘与读屏、表格与长文本、焦点与层级、删除首页函数图                                                                                                                                   | 已交付（v0.8.0）                                                                                                               |
| 7z.8  | 全站审查修复（本轮）：路由级代码分割（页面按需加载）、死代码与无用文案清理、测试噪音与慢测试、文档同步                                                                                                                                   | 已交付（v0.8.0）                                                                                                               |
| 7z.9  | 从备份恢复（完整替换）：流式读取与校验、单事务原子替换、导出文件条目带 `projectId`（兼容旧备份）                                                                                                                                         | 已交付（v0.8.0）                                                                                                               |
| 7z.10 | 作业答案显示修复：关联答案对话框题目公式排版、答案中 PDF 组合向量箭头转公式（下标并入、补回丢失空格）                                                                                                                                    | 已交付（v0.8.1）                                                                                                               |
| 7z.11 | 国际医学生适配（第一阶段）：外语课科目 + 目标语言、语言课科目推断、医学考试体系（国内 / 国际，每门课单独设）、Unicode 分词与词表导入、非英语词书、重音 / 大小写判分、按语言朗读、德语 / 匈牙利语符号键盘、课次标题识别                   | 已提交（未发布）                                                                                                               |
| 8     | Dashboard 强化                                                                                                                                                                                                                           | 部分交付（v0.2.8：视觉与交互函数图；v0.3.1：构图与动效打磨；指标类未做）；交互函数图已删除，视觉方向已被 7z.6 两种界面风格取代 |
| 9     | PWA · a11y · 导入导出打磨                                                                                                                                                                                                                | 未开始                                                                                                                         |

**V0.8.1 已提交并发布**（tag `v0.8.1`，两个远程仓库各一份 Release + 源码压缩包）。本版为显示修复：`HomeworkAnswerDialog` 的题目改用 `formatHomeworkQuestion` + `RichText`（markdown）排版；教授答案预览与 `HomeworkQuestionView` 复习模式的答案同样经 `formatHomeworkQuestion`；`formatHomeworkQuestion` 的向量处理把紧随的下标并入（`v⃗₁` → `$\vec{v}_{1}$`）并在被粘连的单词后补空格；答案下拉标签去掉 U+20D7。只改显示，不改存储。

**V0.8.0 已提交并发布**（tag `v0.8.0`，两个远程仓库各一份 Release + 源码压缩包）。本版包含：**两种界面风格**（讲义默认 / 精密实验室；`UserProfile.uiStyle`、`data-ui-style`、风格 token 与配色分层、`lecture:` / `lab:` 变体，旧外观移除）；**界面动效统一**与**验收修复**（切换风格不重载、动画与滚动性能、测验键盘作答与读屏、表格与长文本、焦点与层级，删除首页函数图）；**从备份恢复**（完整替换、流式读取与校验、单事务原子替换，导出文件条目带 `projectId`）；**全站审查修复**（项目页删除清理全部数据、清除 AI 设置不残留密钥、判分与掌握度 / 错题 / 薄弱点修正、AI 错误映射与重试上限、课程分析并发与删除竞态、课时缓存纳入来源原文）；页面按需加载（主包 2.69 MB → 1.57 MB）、全仓库 Prettier 格式化。未新增 Dexie 表 / 索引（仍为 v17）。

**V0.7.0 已提交并发布**（tag `v0.7.0`，两个远程仓库各一份 Release + 源码压缩包）。本版包含：**作业完整讲解**（见 §6「作业完整讲解」：`homework-walkthrough/v1`、RREF 本地核对、`contextual-tutor/v3` 浮动问答窗口、`WalkthroughNote` 保存与按原文重新定位、加入复习卡片、打印 / 导出 PDF；新增 Dexie **v17** `homeworkWalkthroughs` / `walkthroughNotes`）；以及**全站审查修复**约 45 项（分块丢字需重新处理旧资料；判分、掌握度、删除保护、锁定、课程分析一致性与中断恢复、AI 流式 / 超时、导师竞态、图示计算、参考图片、路由错误页与未找到页、导入）。

**V0.6.0 已提交并发布**（tag `v0.6.0`，两个远程仓库各一份 Release + 源码压缩包）。本版新增**背单词板块**（`/vocab`，见 §6「背单词」）：ECDICT 考试词书（`scripts/build-vocab.mjs` → `public/vocab/`）、`ts-fsrs` 调度、认读 / 拼写 / 填空 / 听写、课程词汇（`CourseVocabService` + `vocab-gloss/v1`）、易错词、统计、导入、导出（Anki / CSV / TXT）。新增 Dexie **v16** 四张表 `vocabCards` / `vocabBooks` / `vocabEntries` / `vocabReviews`（单词进度全局，不带 projectId）；`UserProfile` 新增 `vocabBookId` / `vocabDailyNew` / `vocabReviewMode`。

**V0.5.5 已提交并发布**（tag `v0.5.5`，两个远程仓库各一份 Release + 源码压缩包）。本版包含：**选项本地随机顺序**（测验三种选择题型 + AI 导师单选，`shared/lib/shuffle.ts`）；**`quiz-generator/v6`**（`zh_terms` 语言、干扰项规则、禁止“根据讲义”式题干）与本地可疑题丢弃（正确项过长 / 选项重复）；**混合复习按主题分组**（`planGroups`，每批只给本批主题的知识点与来源）；**题目语言偏好** `UserProfile.questionLanguage`（默认 `zh_terms`，测验 / 错题分析 / 交互导师共用）；难度本地化；设置页版本号（取自 package.json）。未新增 Dexie 表 / 索引。

**V0.5.4 已提交并发布**（tag `v0.5.4`，两个远程仓库各一份 Release + 源码压缩包）。本版包含：**测验分批出题与补题**（`generateInBatches`，每批 ≤5 道、输出上限按题数、缺题按题型补两轮）；**题型按题目自身对应**（修复丢题后题型错位）；**全书取材**（`collectQuizSnippets`）；**标题按实际题数**；**出处无摘录时显示该片段或该页原文**（`fillMissingExcerpts`，仅显示）；按钮与判分标签 `translate="no"`。未新增 Dexie 表 / 索引，提示词版本不变。

**V0.5.3 已提交并发布**（tag `v0.5.3`，两个远程仓库各一份 Release + 源码压缩包）。本版包含：**取消固定 100 MB 上传上限**（`ensureStorageFor` 按剩余配额检查，单文件 2 GB 技术上限，配额写满给出明确提示）；**课程分析读完整本教材**（`analysisInput.ts` 按章节分部分、`mergeAnalyses.ts` 合并，旧的截断分析经 `input-truncated` 提示重新分析）；主题章节优先取已校验来源分块；按文字重叠推断章节的性能修复；流式导出 `exportFile()`；存储统计不再读入所有原文件。未新增 Dexie 表 / 索引，`document-analyzer` 仍为 v2。

**V0.5.0 已提交并发布**（tag `v0.5.0`，两个远程仓库各一份 Release + 源码压缩包）。本版包含：**医学科目**（临床 + 口腔，大一大二；科目画像与安全边界、科目推断、医学单位与符号键盘分组）；**X 型多选（部分得分）/ B 型配伍 / 填空题**（`quiz-generator/v5`、`fill-blank-check/v1`）；**14 种医学图**（生理 / 生化 / 药动 / 形态，schema v10，`visualization-generator/v10`）；**医学联网参考图片**（`reference-image-query/v2`）；**复习卡片**（间隔重复，新增 Dexie **v15** `reviewCards` 表）。其它科目画像未改，已缓存讲解不重新生成。

**V0.4.0 已提交并发布**（tag `v0.4.0`，两个远程仓库各一份 Release + 源码压缩包）。本版包含：**化学 / 生物正确性修复**（转录方向与起始密码子、有机结构式与同分异构体提示、大学单位）；**化学 / 生物 / 统计科目画像按大学深度改写**，物理 / 微积分 / 计算机画像同步升级；**更深入的图**（t / χ² / F 分布、卡方拟合优度检验、伴性与复等位遗传、系谱遗传方式分析、多元酸与弱碱滴定，schema v8）；**其它理科可交互图**（公式探索器、微积分、物理、统计、化学动力学、酶动力学、种群增长、排序与 BST，schema v9，`visualization-generator/v9`）。未新增 Dexie 表 / 索引。

**V0.3.9 已提交并发布**（tag `v0.3.9`，两个远程仓库各一份 Release + 源码压缩包）。本版包含：**界面动效 / 首页重设计 / 风格统一**；**学科适配**（科目画像 9 科含生物、按科目单独失效缓存、科目推断、物理单位判分、代码输出题、概率分布图 `distribution_2d`、化学 mhchem）；**符号键盘与实时识别预览**；**简答题按得分点计分**（测验 / 教授练习 / 导师）；**化学方程式题、排序题**；**化学 / 生物配图三层**（课程原图优先、六种本地计算图、默认关闭的联网参考图片）。新增 Dexie **v14** `referenceImages` / `referenceImageBlobs` 两表；可视化 schema v7；新增依赖 `smiles-drawer`。

**V0.3.4 已提交并发布**（tag `v0.3.4`，两个远程仓库各一份 Release + 源码压缩包）。本版包含：**教授答案对应修复**（编号解析支持 `Problem/Solution/Answer/Q/Sol/Ex` 与裸编号、编号与正文分行；只识别到未分题段落时提供手动划分；Service 层严格一对一校验）；**教授答案 PDF 数学排版还原**（上下标基线分组，可重新读取原 PDF）；**讲解生成可靠性**（最多 2 题并发 / 题目级进度 / 单题 120s 时限 / 输出截断分阶段 / 已完成跳过 / 失败单题重试）；**「留给学生」答案识别**（不发无依据请求）；**作业复习完整教学讲解**；**「检查答案」**（本地核对 + AI 语义估计，百分比为估计值）；**最后检查排版修复**；**逐题问答常驻**；**浏览器语音输入**；**线性代数六步学习引导试点**；**题面向量箭头与上标显示修复**。均未新增 Dexie 表 / 索引。

**V0.3.1 已提交并发布**（tag `v0.3.1`，两个远程仓库各一份 Release + 源码压缩包）。本版包含：**按幻灯片学习**（PPT/PPTX 逐页导师，新增 Dexie **v13** `slideLessons` 表）；**作业讲解关联教授答案**（新资料角色 `homework_answer`，一对一题号核对、依据教授答案生成提示/解法、做题/复习切换）；作业作答双栏布局 + 桌面侧栏可收起；作业提示与 AI 回复的 KaTeX 公式渲染修复；作业识别加固（分批识别 / 失败阶段分类 / 每题进度 / 受控 Token 预算与错误分类 / 来源 ID 校验与准确出处 / 原图与原文阅读 / 输出截断分次生成）；项目文件总览与安全删除；首页与工作台视觉打磨。

**V0.2.9 已提交并发布**（tag `v0.2.9`，两个远程仓库各一份 Release + 源码压缩包）。本版新增**作业讲解**：从作业文档提取题目、渐进提示与完整解法，逐题保存草稿 / 提示进度 / 答案展开 / 提问对话；支持**整份重新识别**与**单题重生成**，未匹配题目**归档而非删除**，已归档题目再次出现且匹配可靠唯一时**复用原题 ID 恢复全部记录**（有歧义时不猜测），全部在单个事务内提交。新增 Dexie **v12** 的 `homeworkSets` / `homeworkQuestions` 两表，并纳入导出与项目删除清理。

**V0.2.8 已提交并发布**（tag `v0.2.8`，两个远程仓库各一份 Release + 源码压缩包）。本版包含：课程级导航与学习流程连续性、无障碍与错误态、Precision Lab 视觉方向、首页滚动修复、首页可交互函数图像（一次/二次/三次/正弦），并修复 3 个源码文件的 UTF-8 损坏字符。v0.2.7 已发布（tag `v0.2.7`）。

**V0.2.6 已提交并发布**（tag `v0.2.6`，两个远程仓库各一份 Release + 源码压缩包）。本版包含：Phase 7d 章节级增量分析、导师数学可视化 Phase 1 / 1.1 / 2 / 3.0 / 3.1 / 3.2（含 `eigen_2d`）、Markdown 表格渲染、划词浮层定位修复，以及课程分析 JSON 提取加固。v0.2.5 已发布（tag `v0.2.5`）。

### 待用户拍板的决策点

1. **简答题**：已决定并实现——按得分点覆盖率计分（见 §6 Quiz）；第二期（教授练习题、交互导师）已实现。
   2-0. **【Bug】讲解某部分可能卡 20+ 分钟无提示（已完成（未发布））**：每部分总时长上限 6 分钟后存为「超时，可重试」并继续；进度显示「第 N 次尝试：上次…」；开头 / 小结只发结论与要点（见 §6「作业完整讲解」）。
   2a. **题库式自适应测验（已完成（未发布），见 §6 Quiz）**：第一次出题时一次生成多个难度的题存入题库，做完一题后按对错从题库挑下一题（现状：开考前一次性出完，`submitAnswer` 返回的 `nextDifficulty` 未被使用）。
   2b. **作业作答上传手写图片（已完成（未发布），见 §6「作业作答图片与手写板」）**：「你的作答」可上传 / 拍照手写过程（符号多时打字不便），并在网页内提供 **Apple Pencil 手写板**（canvas + Pointer Events：`pointerType === "pen"` 才落笔，手指滚动、防误触；压感 / 橡皮 / 撤销 / 粗细与颜色 / 加页；`touch-action: none`；导出 PNG）。iPadOS「随手写」可把普通输入框里的手写转文字，但不认公式，公式与矩阵靠手写板。设想：图片存 IndexedDB 随作业草稿保存、纳入导出与删除；「检查答案」与 AI 问答把图片作为 `ChatMessage.images` 发给支持视觉的模型（不支持时提示，不做本地 OCR 猜测手写公式）；只发当前题的图片。
   2c. **侧栏底部显示 AI 额度 / 余额（已完成（未发布））**：实现——**用量统计**：`AIService` 每次拿到响应（chat / chatJSON 含重试 / streamJSON / streamChat）把 `usage` 交给 sink（`setAIUsageSink`，`main.tsx` 里 `installAIUsageRecording()` 安装；测试默认不装），`AIUsageService`（`services/aiUsageService.ts`）在 `settings` 单行上的 `usage` 字段按 `YYYY-MM` × 请求类型累加（`entities/aiUsage/types.ts`：`walkthrough / quiz / analysis / tutor / grading / qa / vocab / other`，记 requests / prompt / completion / cached / 无 usage 次数，保留 13 个月；**未新增表、未升 Dexie**）。类型由调用方决定：`buildAIServices` 等工厂给各服务传 `ai.withKind(kind)`（共享 provider 的视图），单次调用可传 `usageKind` 覆盖，`withUsageKind()` 对测试替身无副作用；未标注的（如 bundle.ai 直接用、参考图片）记 `other`。缓存命中 token 取 `prompt_tokens_details.cached_tokens` 或 DeepSeek `prompt_cache_hit_tokens`（`parseUsage`）；流式请求对 OpenAI / Qwen / DeepSeek 预设加 `stream_options.include_usage`（`streamUsage`，其它预设不加以免严格服务端拒绝）。`SettingsRepository.putRow` 在事务里保留库中现有 `usage`，保存设置不会回滚计数。**余额**：`infrastructure/ai/balance.ts` 注册表——DeepSeek `GET {origin}/user/balance`（已按官方文档核实：`is_available` + `balance_infos[{currency,total_balance,granted_balance,topped_up_balance}]`，金额为字符串）；OpenAI 只用可选**管理员密钥**（`adminApiKeyEncrypted`，与 API Key 同样 AES-GCM 加密，导出 / 恢复时剥离）且只发往固定的 `https://api.openai.com/v1/organization/costs`（本月 `start_time`、`bucket_width=1d`、按 `next_page` 翻页，最多 5 页；响应形状按 OpenAI 官方 cookbook 核实），显示为「本月已花费」不是余额；MiniMax Token Plan 剩余额度**未找到官方文档**（只有第三方工具用 `/v1/api/openplatform/coding_plan/remains`，且说法互相矛盾），故**未实现**；Qwen / MiMo / 自定义无适配器 → 本机统计 + 设置中可选的每百万 token 单价（输入 / 缓存输入 / 输出，CNY/USD，`usagePrices`）→ 标「估算」。请求异常（CORS / 断网，浏览器无法区分）显示「服务商不允许网页直接查询」并退回本机统计；余额结果按设置缓存 30 s。**界面**：精密实验室侧栏底部（替换「数据保留在你的设备上」，`app.dataStaysLocal` 已删）与讲义顶栏账户菜单显示 `UsageReadout`（余额 / 本月已花费 / 本月 tokens + 估算），挂载时与每次记录后刷新，点击到 `/settings#ai-usage`；**默认不显示**：`UserProfile.showUsageReadout`（缺省 false）为真时才渲染（`features/settings/usageReadoutPreference.ts` 的 `useUsageReadoutVisible`），关闭时不挂载、不查询余额，用量照常统计；开关在设置页「AI 用量与余额」节顶部「在侧栏 / 顶栏显示用量与余额」（即时生效，不随「保存」）；设置页「AI 用量与余额」节（`widgets/settings/UsagePanel`）：余额状态、本月 / 上月按类型明细表（含估算列）、重置统计（确认框）、单价与 OpenAI 管理员密钥（随「保存」）。原需求：删掉「数据保留在你的设备上」，改为当前 AI 服务商的余额或用量。服务商提供余额接口时直接查询（如 DeepSeek `GET /user/balance`）；OpenAI / Qwen 等用 API Key 查不到余额的，改为本机统计：累计每次响应的 `usage` token（本月已用），用户在设置里填单价时显示估算花费（标明估计值）。精密实验室放侧栏底部，讲义风格放顶部账户菜单；点击跳到设置页 AI 部分。密钥只用于该查询，不进日志。 补充：Token Plan 类套餐（如 MiniMax）按其 API Key 查询剩余额度——实现前按官方文档核实是否有该接口；不做「登录服务商账号」（纯前端无 OAuth、跨站读不到登录态、粘贴会话凭证不安全）。OpenAI 只能用管理员密钥（`sk-admin-`）经 Costs API 查已花费，查不到余额。
   2d. **换应用名、删「本地优先」（待做，等额度）**：品牌区（精密实验室侧栏、讲义顶栏）、`<title>`、登录 / 邀请页、`app.name` / `app.tagline` 词条、README 中的「AI 学习平台」换成新名字（待用户定名；候选：学问 / 题解 / 伴学 / Integral）；删除副标题「本地优先」(`app.tagline`)；积分号图标保留。
   2e. **AI 设置自动获取模型列表（已完成（未发布））**：实现——`infrastructure/ai/models.ts` 的 `fetchModelList` 以与聊天相同的 `providerHeaders()` 调 `GET {base}/models`（容忍 base 以 `/chat/completions` 结尾），解析 `{data:[{id}]}`（也接受数组 / `{models:[…]}`、`id` 或 `name`），从不抛错，返回 `blocked`（CORS / 断网）/ `auth`（401/403）/ `unsupported`（404/405）/ `failed` / `missing-config`；日志只记 origin+path 与状态码。设置页模型旁「获取模型」按钮，Base URL / 密钥失焦（值有变化时）与保存后自动获取；模型栏 `widgets/settings/ModelCombobox`（ARIA combobox：输入过滤、↑↓ / Enter / Esc、下拉箭头看全部，**任意文字都可保存**），没取到列表时用预设模型或退回普通输入框，并在下方说明原因。原需求：填好 Base URL + Key 后调用 OpenAI 兼容 `GET /models`，模型栏变为可搜索下拉框（仍可手动输入）；服务商不支持或 CORS 拦截时退回手动输入并说明原因。
   2f. **作业完整讲解增加「题目分析」（已完成（未发布））**：`homework-walkthrough/v3` 多返回 `analysis`，在「查看原题」与「结论」之间可折叠显示；旧节「补充题目分析」只生成这一小块，缓存哈希不变（见 §6「作业完整讲解」）。
   2g. **公式方框后的标点（已完成（未发布））**：显示时 `tidyBoxedPunctuation` 清理方框后的句末标点（旧讲解即时生效），提示词加标点规则（见 §6「作业完整讲解」）。
   2h. **问答标记样式可选（已完成（未发布），见 §6「作业完整讲解」）**：有问答的原文（收进原文的 `walkthrough-link`、已保存的 `walkthrough-note`）要更醒目；设置里加「问答标记样式」：链接样式（强调色文字 + 下划线）/ 荧光笔样式（半透明底色）。存 `UserProfile`，用 `::highlight()` 的 color / background-color / text-decoration 实现，颜色取主题 token（随配色与明暗），已保存与未保存用深浅区分。
   2k2. **作业「引导练习」模式（已完成（未发布），见 §6「作业引导练习」）**：作业页「做题 / 完整讲解」旁加「引导练习」，按完整讲解的步骤逐步做：每步先填操作（如 $R_2 \to R_2 - 2R_1$）→ 正确后才开放结果矩阵（挖空）→ 本步全对再进入下一步；「一键填入未变的数据」填好未改动的行；卡住可看提示或「看这一步答案」（标记为已查看）。本地判分不花 token：操作作用于上一矩阵（允许走与讲解不同但正确的路线，如换行）、矩阵逐格精确分数核对（错格标红并显示算式）、最终 RREF / 解与讲解一致。步骤来源：矩阵类题目从已有讲解本地解析「操作 + 矩阵」（不调用 AI）；其它科目用一次小请求把已有讲解转成带空格的步骤结构（`guided-steps/v1`，空格答案必须出现在讲解中，否则丢弃），结果保存复用。各科空格与判分：数学式子→表达式等价；物理→数值 + 单位 1%；化学→方程式解析与守恒；统计→数值容差；生物 / 医学→数值或可接受答案列表；计算机→精确匹配。整合现有线性代数「六步学习引导」试点（`HomeworkStudyGuide`），不并存两套引导。
   2k3. **讲解末尾「做练习题」（已完成（未发布），见 §6「作业完整讲解」）**：小结下方按钮，两种版本——**完整版**按原作业结构一一对应（大题 / 小题数量与题型相同，只换数字与情境，解的类型与原题一致）；**精简版**按小结的分类每类一题 + 1–2 道综合题。线性代数方程组题本地构造指定解型（无解 / 唯一 / 1–2 个自由变量）且数字友好的矩阵，用 `rref.ts` 精确算标准答案；**其它科目按用户决定不做本地参数模板，一律由 AI 出题**（`practice-generate/v1`），已有判分器的答案（方程组 / 数值 / 化学方程式）本地核对、不通过即丢弃。所有题（含本地题）经一次批量 AI 审核（`practice-review/v1`，只返回通过与否 + 原因），未通过的本地题重新构造、AI 题重出一次再审，仍不过则丢弃并告知少了几题；答案以本地计算为准，审核不改答案。结果为挂在原作业下的「练习作业」。
   2l. **讲解与教授答案对齐（已完成（未发布），见 §6「作业完整讲解」）**：有教授答案时讲解按教授的方法 / 步骤 / 记号 / 答案形式写（`homework-walkthrough/v6`，只改有教授答案的节的哈希）；「与教授答案对照」逐小题比较（`walkthrough-compare/v1`，本地校验标签与引文）后由学生选择「按教授答案修改」或「保持现状」；「已按教授答案」徽标；工具栏提示可对照的题。
   2k4. **完整讲解「导入讲解」（已完成（未发布），见 §6「作业完整讲解」；资料角色 `walkthrough_import`、提示词 `walkthrough-import/v1`、节字段 `origin` / `sourceDocumentId` / `issues`）**：上传外部讲解（PDF / Word / 图片 / Markdown）→ 现有提取流程（图片 OCR）→ AI 按本作业题号闭集对应拆分、统一成平台 Markdown + LaTeX 排版、补结论（与题目分析）；线代本地 RREF 核对，AI 只标注可疑处与建议、不改原计算；原文件存为资料可回看；导入的节标「来自导入」，与生成的讲解同样支持划词提问 / 保存问答 / 重新生成这一节 / 详细版 / 引导练习；提供「只排版不核对」省 token。
   2h0. **教授出题习惯档案（已完成（未发布），见 §6「教授出题习惯档案」）**：AI 从作业、教授练习题、往年试卷与考试大纲总结出题习惯——题型比例、大题结构（小题数、递进 / 并列）、题干措辞与语言、记号、数字特点、常设陷阱、答案要求；每条附原题例子为证据（无证据的条目丢弃）；新作业上传后增量更新。用于「做练习题」、测验混合练习与口试出题（本地构造的线代题也按档案调整矩阵大小、数字风格与问法）。课程主页可查看 / 编辑档案，并可关闭「模仿教授出题」。存为项目级数据（CourseContext 字段或独立行），纳入导出与删除。
   2h2. **全站交互与阅读体验审查（待做，等额度；在优化 token 消耗之前做）**：逐页（主页、课程主页、课时、交互导师、测验 / 结果、口试、问诊、作业做题 / 完整讲解 / 浮动窗口、错题本、复习卡片、单词、设置、考点清单）× 两种风格 × 明暗 × 电脑 / 平板截图检查：阅读舒适度（行长、公式与说明距离、行距段距、字号层级、加粗密度、长内容分段）、数学与表格（矩阵内分数、方框外标点、宽公式 / 表格溢出、长词撑破布局）、交互（悬停 / 聚焦 / 按下反馈、全键盘操作、浮层互相遮挡、滚动跳动）、各状态（加载 / 空 / 错误 / 暂停 / 部分完成均有说明与下一步）、一致性（同类控件位置与措辞）。对照 break-ui 与 emil-design-eng 清单出问题清单，用户确认后修复；纯显示问题不花 AI token。
   2h3. **平板 / 触控笔与手指全站适配（已完成（未发布））**：所有操作都能只用触控笔或手指完成——依赖悬停的功能（收进原文的问答预览、改动行算式、工具提示、问答标记）改为点按 / 长按也可用；长按或笔划选文字后弹出「解释 / 提问」且不与 iPadOS 选择菜单冲突；浮动窗口 / 小卡片 / 排序题 / 卡片拖动支持触控与笔（Pointer Events，与页面滚动不冲突）；点按目标 ≥44×44px 并留间距；矩阵挖空 / 填空 / 数值题等输入框可直接用 iPadOS「随手写」写数字与短文本，长公式与推导用 2b 手写板；屏幕键盘弹出时当前输入自动滚到可见（`visualViewport`）；iPad 竖屏（768–834px）布局可用，侧栏 / 旁注可收起；禁双击缩放、防手掌误触；键盘快捷键（测验 A–D / Enter 等）都有触控按钮替代。
   - **布局与输入：已完成（未发布）**。Tailwind 新变体 `coarse:`（`@media (pointer: coarse)`，手指 / 笔为主指针时才生效，桌面不变）：`buttonVariants` 各尺寸、`Input` / `Textarea` / `Slider` / `TabsList`、符号键盘与字母键、排序题上下按钮、侧栏链接、课程二级导航在触控下 ≥44px，顶栏控件间距加大。`globals.css` 末尾的 `(pointer: coarse)` 块：按钮 / 链接 / 输入 / 各 role 控件 `touch-action: manipulation`（禁双击缩放，保留双指缩放），按钮类不被长按选中文字，按钮 / tab / 菜单项 / 选项 / `<summary>` / `<select>` / 文本输入 `min-height: 44px`（按钮与 tab 还有 `min-width`），勾选框所在 `label` 行高 ≥44px。屏幕键盘：`shared/lib/keyboardInset.ts`（纯函数 `keyboardInsetFrom` / `revealScrollDelta` + `installKeyboardAvoidance`，在 `Bootstrap` 安装）按 `visualViewport` 计算键盘遮挡写入 `--keyboard-inset`，文本输入获得焦点或键盘升起时只滚动其所在滚动容器把它留在键盘上方 24px；设置页保存栏 `bottom: var(--keyboard-inset)`；捏合缩放时不计。随手写：`shared/lib/answerFieldAttrs.ts` 按答案类型给 `inputMode` / `autoCapitalize` / `autoCorrect` / `spellCheck`——数值 `decimal`、矩阵挖空格 iPadOS 上 `numeric`（数字与标点页，含 − /）、其它平台全键盘 + `pattern`、表达式 / 化学 / 带单位与填空、语言练习不自动大写不自动纠正（德语名词复数保留首字母大写），并按是否提交给 `enterKeyHint`；`MathField` / 引导练习矩阵格与操作框 / 填空 / 词形表 / 背单词拼写均为真实 `<input>`。键盘快捷键均有可见按钮（测验提交、引导练习「检查」、背单词「检查 / 下一个」、复习卡片「显示答案」与评分）；`MathField` 的 Enter 提示在触控下隐藏。手写板防误触：笔在写或刚抬起（600ms）时，落在工具栏 / 按钮上的手指触点及随后的 click 被吞掉，落在遮罩上不会关闭（`isPalmContact`），其它时候手指正常。布局：课时页窄于侧栏断点（讲义 <1200px、实验室 <1024px，`useMediaQuery` + `SIDE_COLUMNS_QUERY`）时目录收成「目录 · 当前主题」开关，选主题后自动收起；对话记录 <lg 时会话列表在自身框内滚动；实验室侧栏 <lg 为抽屉、讲义顶栏导航横向滚动（原有）。测试 `tests/ui/tabletLayoutInput.test.tsx`。
   - **触控交互：已完成（未发布）**（与布局 / 输入一半都完成后整项再标完成）：纯函数 `shared/lib/pointerGesture.ts`（`pointerKind` / `isTouchLike`、拖动阈值 鼠标 3 / 笔 6 / 手指 8 px、`LONG_PRESS_MS` 500、`dropIndexAt`、`capturePointer`）+ `shared/lib/useLongPress.ts`。完整讲解标记句子：手指 / 笔点按 `pin` 卡片（`usePassageHover`，不随离开关闭，点卡片与文章外或再点同一句关闭；鼠标点击仍打开窗口）；步骤卡片改动数字点按切换算式（点卡片外隐藏，点按后 800 ms 内的模拟鼠标事件忽略）；`TooltipWrapper` 长按显示（吞掉随后的 click，2.5 s 或下一次按下关闭；鼠标不变）；浮动窗口标题栏 / 调整大小把手（触屏命中区 44px）、小卡片、排序题把手用 Pointer Events + `setPointerCapture`，`touch-none` 只在把手上，超过阈值才开始拖动；排序题鼠标仍用原生拖放；窗口标题栏按钮本就常显。划词弹窗（`SelectionTranslator`）：记录按下的指针类型，触控选择在 `pointerup` / `touchend` 后或停稳 400 ms（`SELECTION_SETTLE_TOUCH_MS`，iPadOS 拖手柄只有 selectionchange）后弹出，按住时不弹；`computeSelectionPopupPosition` 新增 `prefer: 'bottom'` + `TOUCH_POPUP_GAP` 28 px，放在选区下方避开 iPadOS 选择菜单与手柄。手写板未改动。测试 `tests/pointerGesture.test.ts`、`tests/ui/touchInteraction.test.tsx`、`walkthroughQAViews` 新增两组（jsdom 无 PointerEvent，`tests/helpers/pointerEvent.ts` 只在这些测试中安装）。
     2h4. **平板适配后的复审（已完成（未发布））**：键盘弹出时设置页焦点框让开保存栏（`--sticky-footer`，`publishStickyFooter`）、浮动问答窗口临时上移到键盘上方（`keyboardLift`，不保存位置）、讲解目录 / 普通链接 / 排序把手 / 步骤卡片数字 / 窗口调整角触控 ≥44px、填空 Enter 跳下一空、矩阵格 Enter 跳下一个空格（无空格或末格时检查；`enterKeyHint` next / 末格 go）、矩阵格非 iPadOS 用全键盘 + `pattern`（`isAppleTouch`）、窗口输入框 `enterKeyHint="send"`、展开卡片 / 从停靠栏恢复时 `clampRect`、排序拖动行不透明并让出空位、引导练习操作框标签唯一、步骤卡片点按后鼠标移动 / 按键即恢复悬停与焦点读数；移除未使用的 `data-touch-compact`。测试 `tests/ui/tabletReview.test.tsx`。
     2i. **优化 token 消耗（待做，等额度；在全站审查之前做）**：先借 2c 的本机用量统计按请求类型记录输入 / 输出 token，找最费的几项；再逐项优化——少发重复上下文（按来源分块取材，不整章塞入）、让固定系统提示在前以命中服务商前缀缓存、按任务设输出上限并减少截断重写、简单任务（释义 / 匹配 / 判分核对）可在设置里选「轻量模型」、检查重试与分段不重复请求已完成部分；优化前后用同样操作对比 token 用量并记录。
     2j. **作业完整讲解「普通版 / 详细版」（已完成（未发布））**：每节「普通 / 详细」切换，详细版对照普通版生成、两版都保存，设置里选默认版本，「全部切到详细版」只生成缺的（可暂停），两版都做 RREF 核对，「重新生成这一节」只重写当前显示的版本，分小题按小题生成（见 §6「作业完整讲解」）。
     2k. **作业完整讲解排版改进（已完成（未发布））**：正文限宽约 70 字、公式靠左缩进、矩阵内 `\dfrac`、四级字号与加粗规则、每小题末尾框答案；行变换显示为步骤卡片（原矩阵 → 新矩阵、改动行高亮、悬停 / 聚焦显示本地精确分数算式、与所写不符的单元格标出正确值），读不出时按原样显示；`homework-walkthrough/v4` 约定固定步骤格式（见 §6「作业完整讲解」）。
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
   - **医学（schema v10，`visualization-generator/v10`，随 v0.5.0 发布）**：新增图族开关 `physiology`（医学 / 生物）、`biochemistry`（医学 / 生物 / 化学）、`pharmacokinetics`、`morphology`（仅医学）；医学同时获得生物、χ² 检验、回归、酶动力学图族。模型只给课时数值，其余本地计算（`entities/tutorVisualization/medicine.ts`，校验 `normalizeMedicine.ts` 含生理范围检查）：
     - **生理**（`TutorPhysiologyFigure`）：`membrane_potential_2d`（Nernst 平衡电位 + GHK 静息电位，[K⁺]ₒ 滑块）、`action_potential_2d`（神经 / 心室肌 / 窦房结示意，分期标注）、`oxygen_2d`（Hill 方程氧解离曲线、血氧含量与动静脉差）、`cardiac_2d`（左室压力–容积环，SV / EF / CO / 每搏功）、`lung_volumes_2d`（肺量计曲线与各肺容量）、`renal_2d`（Starling 力与有效滤过压、清除率 C = U·V/P、滤过分数）、`acid_base_2d`（Davenport 图 + 国内病理生理教材代偿公式：代酸 PaCO₂ = 1.5·HCO₃⁻ + 8 ± 2，代碱 ΔPaCO₂ = 0.7·ΔHCO₃⁻ ± 5，呼酸急性 0.1 ± 1.5 / 慢性 0.35 ± 3，呼碱急性 0.2 ± 2.5 / 慢性 0.5 ± 2.5；超出范围提示合并紊乱，数值不符合 H–H 方程时警告）。
     - **生化 / 药动**（`TutorBiochemFigure`）：`amino_acid_2d`（净电荷–pH 曲线与 pI）、`metabolism_2d`（逐步 ATP / NADH / FADH₂，P/O 现行 2.5/1.5 与旧教材 3/2、苹果酸–天冬氨酸 / α-磷酸甘油穿梭切换；糖酵解 + 有氧氧化 32 / 30 或 38）、`pharmacokinetics_2d`（一室模型静注 / 口服、多次给药叠加，MEC / MTC 带，剂量与间隔滑块，CL / AUC / Css / 蓄积因子 / 达稳态时间；注明不构成用药建议）。
     - **形态**（`TutorMorphologyFigure`）：`dental_chart_2d`（FDI / Universal / Palmer 切换，患者右侧在左）、`timeline_2d`（胚胎 / 萌出时间轴，≤4 条泳道）、`neural_pathway_2d`（逐级神经元，皮质–周围分层与中线，交叉后换侧；`crossesAt` 表示轴突在胞体以外的平面交叉，如皮质脊髓束在延髓）、`anatomy_table_2d`（起止点 / 神经支配等对照表，课时内可一键加入复习卡片，经 `LessonFigureContext` 取得项目与主题）。
     - 门控关键词：`looksLikePhysiologyText` / `looksLikeBiochemistryText` / `looksLikePharmacokineticsText` / `looksLikeMorphologyText`；医学加入 `FORMULA_SUBJECTS`。课程原图优先（第 1 层）同样适用于医学。
   - **第 3 层 联网参考图片（默认关闭，设置页开启）**：只在化学 / 生物 / 医学课时、且本主题没有课程原图时，提供“查找参考图片”按钮（学生点击才联网）。`reference-image-query/v2`（v1 保留）对医学追加：优先 Wikimedia 上公有领域的格氏解剖学图版（Gray's Anatomy）、CC 授权组织切片 / 胚胎 / 牙体图，药物结构用 PubChem，**绝不检索患者照片 / 病灶 / 手术 / 可识别个人**。模型只给搜索词（PubChem 需附分子式，与 PubChem 返回值核对）；`infrastructure/referenceImages/sources.ts` 检索并下载；可选 `reference-image-check/v1` 视觉核对（`ChatMessage.images` 以 OpenAI content 数组发送；模型不支持图片时自动降级为“未核对”）。图片与来源 / 许可 / 作者存入 Dexie **v14** `referenceImages` / `referenceImageBlobs`（每主题缓存，可逐张移除，随项目删除；不纳入导出，可重新获取）。

10. **Markdown 表格渲染（Phase 3.1.1 已实现并验证，随 v0.2.6 发布）**：共享 `RichText` 新增 GFM pipe table block（`shared/lib/markdownTable.ts` 纯解析 + `markdownText.ts` block + `RichText` 语义化渲染）；cell 复用现有 inline 文本/code/LaTeX；宽表仅在容器内横向滚动；普通 `|x|` 不误判；code fence / block math 内不解析表格。Tutor Lesson Prompt 升 **v3**（保留 v1/v2）规范表格输出。旧缓存中的多行 Markdown 表格**无需重新调用 AI 即可正确显示**；Prompt v3 经 `contentHash` 使旧课时自然重生成一次。未改 `TUTOR_LESSON_VERSION` / Visualization schema / Dexie。

11. **划词浮层定位修复（Phase 3.2 已实现并验证，随 v0.2.6 发布）**：`SelectionTranslator` 不再一次性写入 `top: rect.top - 8` + `translate(-50%,-100%)`，改为纯函数 `computeSelectionPopupPosition`（`shared/lib/popupPosition.ts`）按**真实浮层尺寸**优先上方、空间不足翻转下方、上下都不足取较大侧并给出 `maxHeight`，左右 clamp 到视口；用 `ResizeObserver` + `useLayoutEffect` + `window.resize` + 捕获阶段 `scroll` + `visualViewport`（resize/scroll）在内容/视口/滚动变化后重新定位，监听器与 observer 在卸载时清理；滚动使选区完全离开视口时关闭浮层。移动端仍为底部浮层但以 `visualViewport` 为界。未引入新依赖、未改 Portal、未改动全站其它浮层。

### 已知限制

- 需自备 AI API；不配置时仅上传与本地处理可用（状态是 `no-provider`，不是 failed）。
- 数据绑定浏览器 origin；换地址/清站点数据会看不到数据，需用「数据管理 → 导出数据」备份，再用「从备份恢复」导回。恢复是**完整替换**（不合并），不恢复 API 密钥（需重新填写）与联网参考图片缓存（可重新查找）。
- 数学等价判断有边界，极复杂表达式返回「无法自动判定」，不计入成绩。
- OCR 质量取决于图片清晰度；手写内容提取效果有限。
- 课程分析为项目级（覆盖该项目全部已处理文档），非逐文档结果，也非章节级。
- 长教材的课程分析按部分请求，AI 调用次数随教材长度增加（约每 4 万字一次，并发 2）；任一部分失败则整次分析失败、保留旧结果，没有“只重试失败部分”。
- 数学可视化范围受控：`eigen_2d` 只支持 2×2 实矩阵的**实**特征值/特征向量；复特征值、3×3、Jordan 形、动画、拖拽均不支持，会安全回退为普通 LaTeX，不绘制误导性的实特征方向。
- 化学 / 生物图范围受控：滴定只支持 ≤三元酸 + 强碱、一元弱碱 + 强酸（不含活度校正）；棋盘格最多两对基因、至多一个 X 连锁基因，不含连锁交换 / 上位效应；遗传方式分析假设完全外显；同分异构体无法自动区分（不计分并提示）；不画 3D 结构、反应机理、细胞 / 器官示意图（这类交给课程原图或联网参考图片）。
- 医学图为教学模型：动作电位为示意形状；氧解离曲线用 Hill 方程近似；压力–容积环为分段示意；药动学只做一室模型（无非线性消除）；酸碱判读只覆盖单纯性紊乱与一层合并紊乱提示（不含阴离子间隙 / 三重紊乱）；神经通路最多 4 级神经元、一次交叉。不画器官 / 切片 / 影像，这类交给课程原图或联网参考图片。
- 对判定提出异议后的掌握度重算（`MasteryService.rebuild`）合并测验与教授练习的作答，并保留已有的复习卡片观测（`FLASHCARD_TYPE`）；被异议的作答不计入。
- 冷启动时外观偏好（明暗 / 配色）要等 `UserProfile` 读出后才应用，可能有一帧默认配色。
- 作业完整讲解的浮动问答窗口只做了桌面端（未做手机端适配）；保存问答的原文标记用 CSS Custom Highlight API，不支持的浏览器不显示标记（本节问答芯片与「我的问答」仍可用）。RREF 核对只验证“讲解写出的增广矩阵 → RREF”的计算，不验证增广矩阵是否按题目列对；矩阵读不出时跳过不报。打印依赖浏览器打印对话框（另存为 PDF）。
- 背单词的词典数据（`public/vocab/`，约 1.9 MB）按需 fetch；项目**没有 Service Worker**，不保证离线可用。课程词汇的提取是纯本地启发式（≥4 字母、去停用词与常用词），可能漏掉短术语或收进少量普通词。
