/** Split an unusually long multi-part exercise for bounded solution requests. */
export function splitHomeworkSubparts(prompt: string): Array<{ label: string; prompt: string }> {
  const markers = [...prompt.matchAll(/(?:^|\s)\(([a-z])\)\s+/gi)]
  if (markers.length < 2 || markers[0]?.[1]?.toLowerCase() !== 'a' || markers.length > 20) return []
  const stem = prompt.slice(0, markers[0].index).trim()
  if (!stem) return []
  return markers.map((marker, index) => {
    const start = marker.index! + marker[0].length
    const end = markers[index + 1]?.index ?? prompt.length
    return { label: marker[1]!.toLowerCase(), prompt: `${stem}\n\n(${marker[1]}) ${prompt.slice(start, end).trim()}` }
  }).filter((part) => part.prompt.length > stem.length + 6)
}
