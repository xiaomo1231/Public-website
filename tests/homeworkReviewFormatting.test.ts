import { describe, expect, it } from 'vitest'
import { formatHomeworkReviewText } from '@/entities/homework/reviewFormatting'
import { parseMarkdownBlocks } from '@/shared/lib/markdownText'

describe('homework review formatting', () => {
  it('turns literal escaped list breaks in cached AI text into readable blocks', () => {
    const raw = '正确性核对\\n- $P(0)=5$\\n- $P(1)=8$\\n\\n三个点均符合。'
    const formatted = formatHomeworkReviewText(raw)
    expect(formatted).toBe('正确性核对\n- $P(0)=5$\n- $P(1)=8$\n\n三个点均符合。')
    expect(parseMarkdownBlocks(formatted).map((block) => block.kind)).toEqual(['paragraph', 'list', 'paragraph'])
  })

  it('preserves LaTeX commands beginning with backslash-n', () => {
    const raw = '$x\\neq 0$，$\\nabla f$\\n- 代入检验'
    expect(formatHomeworkReviewText(raw)).toBe('$x\\neq 0$，$\\nabla f$\n- 代入检验')
  })

  it('repairs escaped newlines between prose and display equations', () => {
    const raw = '步骤 4：代入 $P(x)=ax^2+bx+c$：\\n$$P(x)=\\frac32x^2+5$$\\n步骤 5：代入 $x=3$：\\n$$P(3)=23$$\\n即 23,000 人。'
    const formatted = formatHomeworkReviewText(raw)
    expect(formatted).toBe('步骤 4：代入 $P(x)=ax^2+bx+c$：\n$$P(x)=\\frac32x^2+5$$\n步骤 5：代入 $x=3$：\n$$P(3)=23$$\n即 23,000 人。')
    expect(formatted).not.toContain('\\n')
    expect(formatted).toContain('\\frac32')
  })

  it('leaves escaped sequences inside formulas and code alone', () => {
    const raw = '公式 $x\\neq 0$\\n说明：`literal \\n`\\n再检查 $\\nabla f$。'
    expect(formatHomeworkReviewText(raw)).toBe('公式 $x\\neq 0$\n说明：`literal \\n`\n再检查 $\\nabla f$。')
  })

  it('does not let a currency sign swallow later escaped line breaks', () => {
    expect(formatHomeworkReviewText('花费 $1000\\n参观人数为 8,000。')).toBe('花费 $1000\n参观人数为 8,000。')
    expect(formatHomeworkReviewText('Between $5 and $10\\nNext line')).toBe('Between $5 and $10\nNext line')
  })

  it('turns encoded whitespace around bold math into ordinary spacing', () => {
    expect(formatHomeworkReviewText('**$a$&#x20;**&#x20;与 **$b$**')).toBe('**$a$** 与 **$b$**')
    expect(formatHomeworkReviewText('`&#x20;` 与 &#32; 文字')).toBe('`&#x20;` 与   文字')
  })
})
