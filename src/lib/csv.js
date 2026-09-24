// Small CSV reader/writer (handles quotes, commas and line breaks inside quotes, BOM, ; or , separator).
export function parseCsv(text) {
  text = text.replace(/^\ufeff/, '')
  const firstLine = text.split(/\r?\n/, 1)[0] || ''
  const sep = (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ','
  const rows = []
  let row = [], field = '', inQ = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ } else inQ = false
      } else field += c
    } else if (c === '"') inQ = true
    else if (c === sep) { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      rows.push(row); row = []
    } else field += c
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows.filter((r) => r.some((x) => String(x).trim() !== ''))
}

// Turns rows into objects using the header row. Header names are matched loosely.
const ALIASES = {
  code: ['code', 'qr', 'qr code', 'qrcode', 'id'],
  name: ['name', 'product', 'product name', 'item', 'sample', 'sample name'],
  category: ['category', 'type', 'group'],
  description: ['description', 'details', 'desc', 'notes'],
  total_samples: ['total_samples', 'total samples', 'samples', 'sample count', 'qty', 'quantity', 'count', 'total'],
}
export function rowsToProducts(rows) {
  if (!rows.length) return { items: [], missing: ['name'] }
  const head = rows[0].map((h) => String(h).trim().toLowerCase())
  const idx = {}
  for (const [key, names] of Object.entries(ALIASES)) {
    idx[key] = head.findIndex((h) => names.includes(h))
  }
  const missing = idx.name === -1 ? ['name'] : []
  const items = rows.slice(1).map((r) => ({
    code: idx.code > -1 ? (r[idx.code] || '').trim() : '',
    name: idx.name > -1 ? (r[idx.name] || '').trim() : '',
    category: idx.category > -1 ? (r[idx.category] || '').trim() : '',
    description: idx.description > -1 ? (r[idx.description] || '').trim() : '',
    total_samples: idx.total_samples > -1 ? (r[idx.total_samples] || '').trim() : '',
  }))
  return { items, missing, hasCode: idx.code > -1 }
}

export function toCsv(rows) {
  const esc = (v) => {
    if (v === null || v === undefined) return ''
    let s = String(v)
    // stops spreadsheet formula injection, but leaves phone numbers like +91 98765 43210 alone
    if (/^[=@]/.test(s) || (/^[+-]/.test(s) && !/^[+-][\d\s().-]+$/.test(s))) s = "'" + s
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return rows.map((r) => r.map(esc).join(',')).join('\r\n')
}
