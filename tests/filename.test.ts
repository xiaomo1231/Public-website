import { describe, expect, it } from 'vitest'
import { splitFilename, truncateFilename } from '@/shared/lib/filename'

const LONG_EN =
  'Calculus_Lecture_Week_03_Derivatives_and_Applications_Review_Materials_2026_Final_Version.pdf'
const LONG_CJK = '这是一个非常非常非常非常非常长的课程资料文件名称.pdf'
const NO_SPACES = 'file_name_with_very_long_continuous_string_without_spaces.pdf'
const NO_EXT = 'VeryLongFileNameWithoutExtensionThatKeepsGoingAndGoing'

describe('splitFilename', () => {
  it('separates a normal extension', () => {
    expect(splitFilename('lecture1.pdf')).toEqual({ base: 'lecture1', extension: '.pdf' })
    expect(splitFilename('notes.docx')).toEqual({ base: 'notes', extension: '.docx' })
    expect(splitFilename('deck.pptx')).toEqual({ base: 'deck', extension: '.pptx' })
  })

  it('splits on the last dot only', () => {
    expect(splitFilename('archive.2026.final.pdf')).toEqual({
      base: 'archive.2026.final',
      extension: '.pdf',
    })
  })

  it('treats a dotfile as having no extension', () => {
    expect(splitFilename('.gitignore')).toEqual({ base: '.gitignore', extension: '' })
  })

  it('ignores a trailing dot', () => {
    expect(splitFilename('report.')).toEqual({ base: 'report.', extension: '' })
  })

  it('treats an over-long suffix as part of the name', () => {
    const name = 'report.verylongsuffixindeed'
    expect(splitFilename(name)).toEqual({ base: name, extension: '' })
  })

  it('handles names with no dot at all', () => {
    expect(splitFilename('README')).toEqual({ base: 'README', extension: '' })
  })

  it('handles the empty string', () => {
    expect(splitFilename('')).toEqual({ base: '', extension: '' })
  })
})

describe('truncateFilename', () => {
  it('returns short names untouched', () => {
    expect(truncateFilename('lecture1.pdf')).toBe('lecture1.pdf')
    expect(truncateFilename('lecture1.pdf', 36)).toBe('lecture1.pdf')
  })

  it('returns a name that exactly fills the budget untouched', () => {
    const name = 'a'.repeat(32) + '.pdf' // 36 chars
    expect(truncateFilename(name, 36)).toBe(name)
  })

  it('keeps the beginning and the extension of a long English name', () => {
    const result = truncateFilename(LONG_EN, 36)
    expect(result).toHaveLength(36)
    expect(result.startsWith('Calculus_Lecture_Week')).toBe(true)
    expect(result.endsWith('.pdf')).toBe(true)
    expect(result).toContain('...')
  })

  it('preserves a long Chinese name within the budget', () => {
    const result = truncateFilename(LONG_CJK, 20)
    expect(result.length).toBeLessThanOrEqual(20)
    expect(result.endsWith('.pdf')).toBe(true)
    expect(result.startsWith('这是一个')).toBe(true)
  })

  it('handles a long string with no spaces', () => {
    const result = truncateFilename(NO_SPACES, 30)
    expect(result).toHaveLength(30)
    expect(result.endsWith('.pdf')).toBe(true)
  })

  it('handles a name with no extension', () => {
    const result = truncateFilename(NO_EXT, 20)
    expect(result).toHaveLength(20)
    expect(result.endsWith('...')).toBe(true)
  })

  it('drops an over-long "extension" instead of showing it', () => {
    const result = truncateFilename('report.verylongsuffixindeed', 15)
    expect(result).toHaveLength(15)
    expect(result.endsWith('...')).toBe(true)
    expect(result).not.toContain('verylongsuffix')
  })

  it('still produces something sane when the budget is tiny', () => {
    const result = truncateFilename(LONG_EN, 4)
    expect(result.length).toBeLessThanOrEqual(7)
    expect(result).toContain('...')
  })

  it('never returns more than the budget for normal budgets', () => {
    for (const name of [LONG_EN, LONG_CJK, NO_SPACES, NO_EXT]) {
      expect(truncateFilename(name, 40).length).toBeLessThanOrEqual(40)
    }
  })

  it('handles an empty name', () => {
    expect(truncateFilename('')).toBe('')
  })

  it('handles a non-positive budget', () => {
    expect(truncateFilename(LONG_EN, 0)).toBe(LONG_EN)
  })
})
