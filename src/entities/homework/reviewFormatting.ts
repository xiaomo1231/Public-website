function hasInlineMathClose(text: string, start: number): boolean {
  const end = text.indexOf('$', start + 1)
  return end > start + 1 && !text.slice(start + 1, end).includes('\n') &&
    !/\d/.test(text[end + 1] ?? '')
}

const SPACE_ENTITY = /^(?:&#x0*20;|&#0*32;|&#x0*a0;|&#0*160;|&nbsp;)/i

/** Repair literal escaped newlines in AI review prose, including older cache. */
export function formatHomeworkReviewText(text: string): string {
  const source = text.replace(/\r\n?/g, '\n')
  let result = ''
  let mode: 'prose' | 'code' | 'fence' | 'math' | 'displayMath' | 'parenMath' | 'bracketMath' = 'prose'

  for (let i = 0; i < source.length;) {
    const rest = source.slice(i)
    if (mode === 'prose') {
      const encodedSpace = SPACE_ENTITY.exec(rest)
      if (encodedSpace) {
        // AI sometimes puts the encoded space inside `**...**`. Move it out
        // so the Markdown strong span remains valid without showing an entity.
        if (!rest.slice(encodedSpace[0].length).startsWith('**')) result += ' '
        i += encodedSpace[0].length
        continue
      }
      const opening = rest.startsWith('```') ? ['```', 'fence'] as const
        : rest.startsWith('`') ? ['`', 'code'] as const
          : rest.startsWith('$$') ? ['$$', 'displayMath'] as const
            : rest.startsWith('$') && hasInlineMathClose(source, i) ? ['$', 'math'] as const
              : rest.startsWith('\\(') ? ['\\(', 'parenMath'] as const
                : rest.startsWith('\\[') ? ['\\[', 'bracketMath'] as const
                  : null
      if (opening) {
        result += opening[0]
        mode = opening[1]
        i += opening[0].length
        continue
      }
      // A literal double backslash is not an escaped newline.
      if (rest.startsWith('\\\\')) {
        result += '\\\\'
        i += 2
        continue
      }
      if (rest.startsWith('\\r\\n')) {
        result += '\n'
        i += 4
        continue
      }
      if (rest.startsWith('\\n')) {
        // Undelimited LaTeX is uncommon, but preserve known commands.
        if (/^\\(?:neq|ne|nabla|notin|neg|nu|natural|newcommand|nRightarrow|nLeftarrow)\b/.test(rest)) {
          result += '\\n'
        } else {
          result += '\n'
        }
        i += 2
        continue
      }
    } else {
      const closing = mode === 'fence' ? '```'
        : mode === 'code' ? '`'
          : mode === 'displayMath' ? '$$'
            : mode === 'math' ? '$'
              : mode === 'parenMath' ? '\\)'
                : '\\]'
      if (rest.startsWith(closing)) {
        result += closing
        i += closing.length
        mode = 'prose'
        continue
      }
    }
    result += source[i]
    i++
  }
  return result
}
