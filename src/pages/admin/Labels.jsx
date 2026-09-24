import { useMemo, useState } from 'react'
import { supabase, PUBLIC_BASE_URL } from '../../supabase'
import { buildLabelPdf, labelLayoutInfo } from '../../lib/labels'
import { toCsv } from '../../lib/csv'
import { downloadText } from '../../lib/util'
import { Banner, Field } from '../../ui.jsx'

async function fetchCodes(kind) {
  const out = []
  for (let from = 0; ; from += 1000) {
    let q = supabase.from('products').select('code').order('seq').range(from, from + 999)
    if (kind === 'blank') q = q.eq('status', 'unassigned')
    const { data, error } = await q
    if (error) throw error
    out.push(...data.map((r) => r.code))
    if (data.length < 1000) break
  }
  return out
}

export default function Labels() {
  const [count, setCount] = useState(2300)
  const [batch, setBatch] = useState(`Batch ${new Date().toISOString().slice(0, 10)}`)
  const [gen, setGen] = useState({ busy: false, made: null, err: '' })

  const [baseUrl, setBaseUrl] = useState(PUBLIC_BASE_URL || window.location.origin)
  const [source, setSource] = useState('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [cols, setCols] = useState(4)
  const [rows, setRows] = useState(10)
  const [paper, setPaper] = useState('a4')
  const [cutLines, setCutLines] = useState(true)
  const [out, setOut] = useState({ busy: false, progress: 0, err: '', info: '' })

  const layout = useMemo(() => labelLayoutInfo({ count: 1, cols, rows, paper }), [cols, rows, paper])
  const risky = /localhost|127\.0\.0\.1|^http:\/\//i.test(baseUrl)

  async function generate() {
    setGen({ busy: true, made: null, err: '' })
    const made = []
    let left = Number(count)
    while (left > 0) {                                   // in slices of 1000 so each request stays quick
      const n = Math.min(1000, left)
      const { data, error } = await supabase.rpc('generate_codes', { p_count: n, p_batch: batch })
      if (error) { setGen({ busy: false, made: made.length, err: error.message }); return }
      made.push(...data); left -= n
    }
    setGen({ busy: false, made: made.length, err: '' })
    setSource('blank')
  }

  async function getCodes() {
    let codes = await fetchCodes(source)
    const a = Math.max(1, parseInt(from, 10) || 1)
    const b = Math.min(codes.length, parseInt(to, 10) || codes.length)
    codes = codes.slice(a - 1, b)
    if (!codes.length) throw new Error('No codes in that range.')
    return codes
  }

  async function makePdf() {
    setOut({ busy: true, progress: 0, err: '', info: '' })
    try {
      const codes = await getCodes()
      const doc = await buildLabelPdf({
        codes, baseUrl, cols: +cols, rows: +rows, paper, cutLines,
        onProgress: (p) => setOut((o) => ({ ...o, progress: p })),
      })
      doc.save(`qr-labels-${codes.length}.pdf`)
      setOut({ busy: false, progress: 1, err: '', info: `${codes.length} labels on ${doc.getNumberOfPages()} pages.` })
    } catch (e) {
      setOut({ busy: false, progress: 0, err: e.message || String(e), info: '' })
    }
  }

  async function makeCsv() {
    try {
      const codes = await getCodes()
      const base = baseUrl.replace(/\/+$/, '')
      downloadText('qr-codes.csv', toCsv([['code', 'url'], ...codes.map((c) => [c, `${base}/p/${c}`])]))
    } catch (e) { setOut((o) => ({ ...o, err: e.message })) }
  }

  return (
    <main className="page wide">
      <h1>QR labels</h1>

      <section className="card stack">
        <h2>1. Create blank codes</h2>
        <p className="muted">Each code is random and does not contain any product information. You link products to them later, so you can print now and fill in details whenever they arrive.</p>
        <div className="grid2">
          <Field label="How many codes" htmlFor="cnt" hint="Tip: make about 15% more than your product count, as spares.">
            <input id="cnt" className="input" type="number" inputMode="numeric" min="1" max="5000" value={count} onChange={(e) => setCount(e.target.value)} />
          </Field>
          <Field label="Batch name" htmlFor="bn" hint="Only a note for you.">
            <input id="bn" className="input" value={batch} onChange={(e) => setBatch(e.target.value)} />
          </Field>
        </div>
        <button className="btn primary" onClick={generate} disabled={gen.busy}>{gen.busy ? 'Creating…' : `Create ${count} codes`}</button>
        {gen.err && <Banner kind="error">{gen.err}{gen.made ? ` (${gen.made} were created before the error.)` : ''}</Banner>}
        {gen.made > 0 && !gen.err && <Banner kind="ok">Created {gen.made} codes. Now print them below.</Banner>}
      </section>

      <section className="card stack">
        <h2>2. Print labels</h2>
        <Field label="Website address inside the QR codes" htmlFor="base"
          hint="Use your final address. Once labels are stuck on products, this address cannot change without reprinting.">
          <input id="base" className="input" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} inputMode="url" autoCapitalize="none" />
        </Field>
        {risky && <Banner kind="warn">This address will not work for people scanning on their phones (it is local or not https). Open this page from your live website before printing.</Banner>}

        <div className="grid2">
          <Field label="Which codes" htmlFor="src">
            <select id="src" className="input" value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="all">All codes</option>
              <option value="blank">Only blank codes (not linked yet)</option>
            </select>
          </Field>
          <div className="grid2">
            <Field label="From number" htmlFor="from"><input id="from" className="input" inputMode="numeric" placeholder="1" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="To number" htmlFor="to"><input id="to" className="input" inputMode="numeric" placeholder="last" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          </div>
        </div>

        <div className="grid2">
          <div className="grid2">
            <Field label="Columns" htmlFor="cols"><input id="cols" className="input" type="number" min="1" max="8" value={cols} onChange={(e) => setCols(e.target.value)} /></Field>
            <Field label="Rows" htmlFor="rows"><input id="rows" className="input" type="number" min="1" max="20" value={rows} onChange={(e) => setRows(e.target.value)} /></Field>
          </div>
          <Field label="Paper" htmlFor="paper">
            <select id="paper" className="input" value={paper} onChange={(e) => setPaper(e.target.value)}>
              <option value="a4">A4</option><option value="letter">US Letter</option>
            </select>
          </Field>
        </div>
        <label className="row"><input type="checkbox" checked={cutLines} onChange={(e) => setCutLines(e.target.checked)} /> Draw light cutting lines around each label</label>

        <p className="muted small">
          Each label is {layout.cellW.toFixed(0)} × {layout.cellH.toFixed(0)} mm with a QR of about {layout.qrMm.toFixed(0)} mm.
          {layout.qrMm < 18 ? ' That is small. Use fewer columns or rows if scanning is slow.' : ''} Print at 100% scale (not "fit to page").
        </p>

        <div className="row wrap">
          <button className="btn primary" onClick={makePdf} disabled={out.busy}>
            {out.busy ? `Building PDF… ${Math.round(out.progress * 100)}%` : 'Download label PDF'}
          </button>
          <button className="btn ghost" onClick={makeCsv} disabled={out.busy}>Download codes as CSV</button>
        </div>
        {out.err && <Banner kind="error">{out.err}</Banner>}
        {out.info && <Banner kind="ok">{out.info}</Banner>}
      </section>
    </main>
  )
}
