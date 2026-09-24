import { jsPDF } from 'jspdf'
import QRCode from 'qrcode'

const PAGE = { a4: [210, 297], letter: [215.9, 279.4] }

/**
 * Builds a printable PDF of QR labels. QR codes are drawn as vector squares
 * (sharp at any print size, tiny file, fast for thousands of codes).
 *
 * codes    : ['K7F3Q2', ...]
 * baseUrl  : 'https://sample.yourdomain.com'  -> QR text is  baseUrl + '/p/' + code
 */
export async function buildLabelPdf({
  codes, baseUrl, cols = 4, rows = 10, paper = 'a4', margin = 8, cutLines = true, onProgress,
}) {
  const [pw, ph] = PAGE[paper] || PAGE.a4
  const doc = new jsPDF({ unit: 'mm', format: [pw, ph], orientation: 'portrait', compress: true })
  const perPage = cols * rows
  const cellW = (pw - margin * 2) / cols
  const cellH = (ph - margin * 2) / rows
  const pad = 1.6
  const textH = 3.8
  const qrSize = Math.max(8, Math.min(cellW - pad * 2, cellH - pad * 2 - textH))
  const base = baseUrl.replace(/\/+$/, '')

  doc.setFont('courier', 'bold')
  doc.setFontSize(Math.min(11, Math.max(7, qrSize * 0.42)))
  doc.setDrawColor(190)
  doc.setLineWidth(0.1)
  if (doc.setLineDashPattern) doc.setLineDashPattern([0.8, 0.8], 0)

  for (let i = 0; i < codes.length; i++) {
    if (i > 0 && i % perPage === 0) doc.addPage([pw, ph], 'portrait')
    const slot = i % perPage
    const col = slot % cols
    const row = Math.floor(slot / cols)
    const x0 = margin + col * cellW
    const y0 = margin + row * cellH

    if (cutLines) doc.rect(x0, y0, cellW, cellH, 'S')

    const qr = QRCode.create(`${base}/p/${codes[i]}`, { errorCorrectionLevel: 'M' })
    const n = qr.modules.size
    const mod = qrSize / n
    const qx = x0 + (cellW - qrSize) / 2
    const qy = y0 + pad

    doc.setFillColor(0, 0, 0)
    for (let r = 0; r < n; r++) {
      let c = 0
      while (c < n) {
        if (!qr.modules.get(r, c)) { c++; continue }
        let end = c
        while (end < n && qr.modules.get(r, end)) end++
        // tiny overlap avoids hairline gaps in some PDF viewers
        doc.rect(qx + c * mod, qy + r * mod, (end - c) * mod + 0.02, mod + 0.02, 'F')
        c = end
      }
    }
    doc.text(codes[i], x0 + cellW / 2, qy + qrSize + textH - 0.6, { align: 'center' })

    if (onProgress && i % 40 === 0) {
      onProgress((i + 1) / codes.length)
      await new Promise((r) => setTimeout(r))     // let the browser repaint
    }
  }
  onProgress?.(1)
  return doc
}

export function labelLayoutInfo({ count, cols, rows, paper = 'a4', margin = 8 }) {
  const [pw, ph] = PAGE[paper] || PAGE.a4
  const cellW = (pw - margin * 2) / cols
  const cellH = (ph - margin * 2) / rows
  const qr = Math.max(0, Math.min(cellW - 3.2, cellH - 3.2 - 3.8))
  return { pages: Math.ceil(count / (cols * rows)), qrMm: qr, cellW, cellH }
}
