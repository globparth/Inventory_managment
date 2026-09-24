// Pulls the product code out of a scanned QR (a full URL like https://x.app/p/K7F3Q2) or a typed code.
export function extractCode(text) {
  if (!text) return null
  const t = String(text).trim()
  const m = t.match(/\/p\/([A-Za-z0-9]{4,12})(?:[/?#]|$)/)
  if (m) return m[1].toUpperCase()
  if (/^[A-Za-z0-9]{4,12}$/.test(t)) return t.toUpperCase()
  return null
}

export function newId() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID()
  // very old browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

export function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`
  return new Date(iso).toLocaleDateString()
}

export function fmtDateTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function downloadText(filename, text, type = 'text/csv;charset=utf-8') {
  const blob = new Blob(['\ufeff' + text], { type })   // BOM so Excel opens UTF-8 correctly
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 2000)
}
