/** Save text as a file through the browser's download. */
export function downloadText(filename: string, content: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  // Revoke after the click has been handled.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/**
 * Save a Blob through the browser's download. The object URL is revoked only
 * after a minute: Safari / iPadOS read a large file asynchronously after the
 * click, and revoking at once can cancel the download.
 */
export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}
