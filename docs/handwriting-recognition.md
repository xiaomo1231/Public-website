# 手写识别：调研、评估与选型

> 适用范围：模拟考试的三种作答方式（在网站上作答 / 纸上作答拍照上传 / 平板卷面手写）中，把学生的手写作答转成可批改的文字。
> 调研时间：2026-10。许可证信息均来自下文列出的原始页面，未能核实的标为「未核实」。

## 1. 硬性要求

1. **识别准确率优先**：识别结果直接影响批改，但识别错误**绝不能**变成批改错误。
2. **可商用许可**：代码、模型权重、训练数据三者都必须允许商业使用（MIT / Apache-2.0 / BSD 等）。GPL / AGPL（闭源分发受限）、NC（非商用）、仅研究用途的权重或数据集一律排除。
3. **在线可接受，但必须有离线兜底。**
4. **批改前学生必须看到识别结果并确认 / 修改**（与原笔迹并排）。

## 2. 候选方案与许可证

| 方案                                                              | 代码许可                                    | 权重许可                                                                                        | 训练数据问题                                               | 大小                                                           | 浏览器运行                                             | 手写数学                                         | 手写文字                                                                              | 可商用？                                   |
| ----------------------------------------------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------ |
| **用户配置的视觉大模型**（OpenAI 兼容接口，`ChatMessage.images`） | —                                           | 服务条款（用户自己的账号）                                                                      | —                                                          | 0（在线）                                                      | 是（fetch）                                            | 强（取决于模型）                                 | 强                                                                                    | **是**（用户自己的服务商与条款）           |
| pix2tex / LaTeX-OCR                                               | MIT                                         | README 未写明（未核实）                                                                         | Wikipedia / arXiv / im2latex-100k（im2latex 许可未核实）   | 未核实                                                         | 无 ONNX 官方移植                                       | 弱：README 的 TODO 里手写支持只是“基本完成”      | 否                                                                                    | 不明确                                     |
| UniMERNet                                                         | Apache-2.0                                  | GitHub 页面未写明（未核实）                                                                     | UniMER-1M 许可未写明；测试集含手写，训练集是否含手写未说明 | base 1.3 GB / small 773 MB / tiny 441 MB                       | 无                                                     | 测试集含手写，准确率未核实                       | 否                                                                                    | 不明确，且体积过大                         |
| PP-FormulaNet_plus（PaddleOCR）                                   | Apache-2.0                                  | Apache-2.0（HF 模型卡）                                                                         | 教材 / 论文 / 试卷 / 期刊，未列手写                        | 未写明                                                         | 只有 Paddle；ONNX 需 paddle2onnx（未核实）             | 未声明（印刷公式）                               | 否                                                                                    | 权重可商用，但无手写证据                   |
| PP-OCRv5 识别模型（server / mobile）                              | Apache-2.0                                  | RapidOCR 声明为 Apache-2.0                                                                      | 未查                                                       | mobile_rec 约 16 MB，server_rec 约 81 MB（第三方目录，非官方） | RapidOCR ONNX / ppu-paddle-ocr（onnxruntime-web）      | 否                                               | 有，但一般：官方内部集上手写中文 0.58 / 0.42、手写英文 0.58 / 0.49（server / mobile） | 大概率可（Apache）                         |
| TrOCR（microsoft/trocr-*-handwritten）                            | unilm 仓库许可未在页面写明（未核实）        | HF 标签 MIT                                                                                     | **在 IAM 上微调；IAM 官方：仅限非商业研究用途**            | small 62M 参数，base 334M                                      | Xenova/trocr-small-handwritten（transformers.js ONNX） | 否                                               | 是（英文单行），IAM CER 4.22 / 3.42 / 2.89                                            | **否**（IAM 数据条款）                     |
| Surya（Texify 的后继）                                            | Apache-2.0                                  | 修改版 AI Pubs Open RAIL-M：研究 / 个人 / 营收或融资 < 500 万美元的初创免费，否则需付费商业授权 | 未查                                                       | 未写明                                                         | 无                                                     | 未声明                                           | 未测试                                                                                | **有条件**（不满足“可商用”的一般要求）     |
| Texify（已归档）                                                  | **GPL-3.0**                                 | CC BY-SA 4.0                                                                                    | 未查                                                       | 未写明                                                         | 无                                                     | 未提手写                                         | 否                                                                                    | 否（GPL 代码）                             |
| Nougat                                                            | MIT                                         | **CC-BY-NC**                                                                                    | arXiv / PMC 论文                                           | —                                                              | 无                                                     | 否                                               | 否                                                                                    | **否**                                     |
| CoMER                                                             | **仓库无 LICENSE 文件**（默认保留所有权利） | 仓库内 checkpoint                                                                               | CROHME 条款未核实                                          | —                                                              | 无                                                     | 是（CROHME）                                     | 否                                                                                    | 否（无许可）                               |
| TAMER                                                             | **仓库无 LICENSE 文件**                     | 仓库内 checkpoint                                                                               | CROHME / HME100K 条款未核实                                | —                                                              | 无                                                     | 是：ExpRate CROHME14 61.23、HME100K 68.52        | 否                                                                                    | 否（无许可）                               |
| BTTR / CAN / PosFormer                                            | 未核实                                      | 未核实                                                                                          | 未核实                                                     | —                                                              | —                                                      | 学术模型                                         | —                                                                                     | 未核实（按无许可处理）                     |
| Google MathWriting 数据集                                         | 代码 Apache-2.0                             | —                                                                                               | **CC BY-NC-SA 4.0**                                        | —                                                              | —                                                      | —                                                | —                                                                                     | **用它训练的商用模型需法律评估，默认排除** |
| Chromium Handwriting Recognition API                              | —                                           | —                                                                                               | —                                                          | —                                                              | Chromium 99+，文档未列 Safari                          | 文本与手势                                       | 英文                                                                                  | **iPad Safari 不可用**                     |
| Seshat（基于笔画）                                                | **GPL-3.0**                                 | —                                                                                               | CROHME 2014                                                | —                                                              | C++，无浏览器移植                                      | 是                                               | 否                                                                                    | 否（闭源受限）                             |
| $P / $Q 识别器                                                    | New BSD                                     | —                                                                                               | —                                                          | 极小                                                           | 纯 JS                                                  | 只能识别单个手势                                 | —                                                                                     | 是，但不能识别公式                         |
| MyScript                                                          | 付费商业 SDK                                | —                                                                                               | —                                                          | —                                                              | 云 / SDK                                               | 是                                               | 是                                                                                    | 付费                                       |
| Tesseract（tesseract.js，项目已在用）                             | Apache-2.0                                  | Apache-2.0                                                                                      | —                                                          | eng 约 4 MB（jsDelivr 按需下载）                               | 是                                                     | **否**（只有线性文本，不懂上下标 / 分式 / 矩阵） | 弱（为印刷体训练）                                                                    | 是                                         |
| Florence-2-base                                                   | MIT                                         | MIT                                                                                             | —                                                          | 约 0.23B 参数                                                  | 未核实移植                                             | 未声明                                           | 有 `<OCR>` 任务，手写未声明                                                           | 许可可以，能力未验证                       |
| SmolVLM-256M                                                      | Apache-2.0                                  | Apache-2.0                                                                                      | —                                                          | 约 0.3B 参数，<1 GB 显存                                       | 提供 ONNX 与 WebGPU 演示                               | 未声明                                           | OCRBench 52.6                                                                         | 许可可以，能力未验证                       |
| Qwen2-VL-2B                                                       | Apache-2.0                                  | Apache-2.0                                                                                      | —                                                          | 2B                                                             | 无验证过的浏览器移植                                   | 未声明                                           | OCRBench 794                                                                          | 许可可以，iPad 上太大                      |
| onnxruntime-web / transformers.js                                 | MIT / Apache-2.0（已核实 LICENSE）          | —                                                                                               | —                                                          | —                                                              | Safari 26（iPadOS 26）默认开启 WebGPU，更早版本需开关  | —                                                | —                                                                                     | 是                                         |

## 3. 本地评估（能跑的部分）

评估脚本放在仓库外的临时目录（`scratchpad/hwr/harness.mjs`），没有提交进仓库。

- **数据**：没有可商用许可的公开手写数学图片集（CROHME / HME100K 条款无法核实，MathWriting 为 NC，IAM 为非商业研究）。因此用脚本**合成**“手写”算式：自定义的单笔画字形（数字、`+ - = x y ( )`），逐点抖动、倾斜、随机线宽，渲染成图片。共 16 个单行线性算式（如 `2x+3=7`、`(x-1)(x+1)`）。
- **能离线运行的识别器**：只有项目已依赖的 tesseract.js 7（eng LSTM；语言数据首次从 jsDelivr 下载后缓存）。其余候选要么许可不合格，要么需要下载数百 MB 权重且没有可用的浏览器移植，本次没有运行。
- **结果**（完全一致数 / 平均字符错误率 CER）：

| 设置                            | 完全一致 | 平均 CER |
| ------------------------------- | -------- | -------- |
| 轻度抖动，字符白名单 + 单行模式 | 13 / 16  | 0.029    |
| 轻度抖动，无白名单              | 12 / 16  | 0.040    |
| 重度抖动 + 倾斜，白名单         | 10 / 16  | 0.064    |
| 重度抖动 + 倾斜，无白名单       | 9 / 16   | 0.104    |

- **解读（要谨慎）**：合成字形接近印刷体、单行、无上下标，远比真实手写容易；即使如此，重度变形时已有约 40% 的算式不完全正确，典型错误是丢掉系数（`7x-2=5` → `x-2=5`）和把 `-` 读成 `=`——这正是会直接改变对错的错误。Tesseract 不能输出二维结构（分式、上下标、矩阵、根号），对真实手写的数学作答不可用。真实照片（光照、透视、草稿涂改）没有评估。

## 4. 结论与推荐

1. **主路径：用户配置的视觉大模型（在线）**，新提示词 `handwriting-transcribe/v1`：
   - 逐字照抄，不纠错、不补全、不解题；数学写成 LaTeX；
   - 看不清的写 `[?]` 或 `[?:猜测]`，绝不悄悄猜；
   - 按行 / 按公式分区域，每个区域给出 0–1 的置信度；
   - 题目文字只作记号参考（`untrustedContentWrapper` + `securityFooter`），图片里的文字是待转写的内容，不是指令。
   - 模型不支持图片时（`isVisionUnsupportedError`）不报失败，转为让学生输入。
2. **离线兜底：学生自己输入识别结果（`typed`）**。没有找到同时满足“可商用 + 手写数学足够准 + 能在 iPad 浏览器里跑”的本地模型：
   - 强 HMER 模型（TAMER、CoMER、Seshat…）无许可或 GPL，且都在 CROHME / HME100K / MathWriting 上训练；
   - 许可干净的（PP-FormulaNet、PP-OCRv5、Florence-2、SmolVLM）没有手写数学能力的证据，或体积太大；
   - TrOCR 的手写权重来自 IAM（非商业研究）。
     因此 `local-model` 识别器只实现了接口（`LocalHandwritingEngine`：名称含许可证、下载大小、`isReady`、`recognize`），默认不安装引擎；设置页如实显示「本机识别：暂不可用」。将来找到合格模型时：用 onnxruntime-web（MIT）或 transformers.js（Apache-2.0）加载，从白名单 CDN 的**固定版本 URL**按需下载并缓存（与 tesseract.js 相同的做法），首次下载前告知大小。值得优先验证的方向：用自有 / 可商用数据微调的小模型（如基于 PP-FormulaNet 或 SmolVLM），需用真实学生手写样本评估后再接入。
3. **保留笔画数据**：平板书写区每页同时保存 PNG 与笔画（`HomeworkAnswerImage.strokes`，坐标 + 压感，按书写顺序）。笔画识别（online HMER）通常比图片识别更准；将来若有服务端或本地笔画模型，可直接使用这些数据，无需学生重写。
4. **无论哪种识别方式**：识别只在交卷后进行；学生在原笔迹旁核对、修改并确认后才批改；含 `[?]` 的文本不能确认；批改只看确认后的文字，绝不把图片交给批改模型。

## 5. 来源

- IAM 手写数据库（条款：仅限非商业研究）：https://fki.tic.heia-fr.ch/databases/download-the-iam-handwriting-database
- MathWriting：https://github.com/google-research/google-research/tree/master/mathwriting ，论文 https://arxiv.org/abs/2404.10690
- UniMERNet：https://github.com/opendatalab/UniMERNet
- PP-FormulaNet_plus：https://huggingface.co/PaddlePaddle/PP-FormulaNet_plus-S ，https://aistudio.baidu.com/modelsdetail/31856
- PaddleOCR / PP-OCRv5 手写指标：https://github.com/PaddlePaddle/PaddleOCR ，https://www.paddleocr.ai/latest/version3.x/algorithm/PP-OCRv5/PP-OCRv5.html
- RapidOCR：https://github.com/RapidAI/RapidOCR
- ppu-paddle-ocr：https://unpkg.com/ppu-paddle-ocr@6.0.0/README.md
- pix2tex：https://github.com/lukas-blecher/LaTeX-OCR
- TrOCR：https://huggingface.co/microsoft/trocr-base-handwritten ，https://huggingface.co/Xenova/trocr-small-handwritten ，https://github.com/microsoft/unilm/tree/master/trocr
- Surya：https://github.com/VikParuchuri/surya ；Texify：https://github.com/VikParuchuri/texify
- Nougat：https://github.com/facebookresearch/nougat
- CoMER：https://github.com/Green-Wood/CoMER ；TAMER：https://github.com/qingzhenduyu/TAMER ，https://arxiv.org/abs/2408.08578
- Seshat：https://github.com/falvaro/seshat ；$P：https://depts.washington.edu/acelab/proj/dollar/pdollar.html
- Chrome Handwriting Recognition API：https://developer.chrome.com/docs/web-platform/handwriting-recognition
- WebGPU 在 Safari 26：https://web.dev/blog/webgpu-supported-major-browsers
- Florence-2：https://huggingface.co/microsoft/Florence-2-base ；SmolVLM：https://huggingface.co/HuggingFaceTB/SmolVLM-256M-Instruct ；Qwen2-VL：https://huggingface.co/Qwen/Qwen2-VL-2B-Instruct
- onnxruntime（MIT）：https://github.com/microsoft/onnxruntime/blob/main/LICENSE ；transformers.js（Apache-2.0）：https://github.com/huggingface/transformers.js/blob/main/LICENSE

### 未能核实

IAM 官网证书过期（条款取自其下载页的搜索摘要）；HME100K、CROHME、im2latex 的条款；pix2tex 与 UniMERNet 的权重许可；BTTR / CAN / PosFormer 仓库；Detexify；PaliGemma 条款；PP-OCRv5 官方文件大小；PP-FormulaNet_plus 的 ONNX 导出。以上一律按“不可商用”处理，直到核实。
