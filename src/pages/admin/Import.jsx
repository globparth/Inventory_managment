import { useState } from 'react'
import { supabase } from '../../supabase'
import { parseCsv, rowsToProducts, toCsv } from '../../lib/csv'
import { downloadText } from '../../lib/util'
import { Banner } from '../../ui.jsx'

const CHUNK = 200

export default function Import() {
  const [file, setFile] = useState(null)
  const [parsed, setParsed] = useState(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState(null)
  const [err, setErr] = useState('')

  async function pick(e) {
    const f = e.target.files?.[0]
    setResult(null); setErr(''); setParsed(null); setFile(f || null)
    if (!f) return
    try {
      const text = await f.text()
      const p = rowsToProducts(parseCsv(text))
      if (p.missing.length) setErr('The file needs a "name" column (product name). Download the template to see the format.')
      else if (!p.items.length) setErr('The file has no rows.')
      else setParsed(p)
    } catch {
      setErr('Could not read that file. Save it as CSV (comma separated) and try again.')
    }
  }

  async function run() {
    setBusy(true); setErr(''); setResult(null); setProgress(0)
    const all = { imported: 0, errors: [], mapping: [] }
    for (let i = 0; i < parsed.items.length; i += CHUNK) {
      const chunk = parsed.items.slice(i, i + CHUNK)
      const { data, error } = await supabase.rpc('bulk_import', { p_rows: chunk })
      if (error) { setErr(`Stopped after ${all.imported} products: ${error.message}`); break }
      all.imported += data.imported
      all.mapping.push(...data.mapping)
      all.errors.push(...data.errors.map((x) => ({ ...x, row: x.row + i + 1 })))   // +1 for header row
      setProgress(Math.min(1, (i + CHUNK) / parsed.items.length))
    }
    setBusy(false)
    setResult(all)
  }

  const template = () => downloadText('sample-products-template.csv',
    toCsv([['code', 'name', 'category', 'total_samples', 'description'],
      ['', 'Basmati Rice 1121', 'Rice', 50, 'Extra long grain, aged 24 months'],
      ['', 'Turmeric Finger', 'Spices', 30, 'Curcumin 3.5%']]))

  return (
    <main className="page wide">
      <h1>Import products</h1>
      <div className="two">
        <section className="card stack">
          <h2>1. Choose a CSV file</h2>
          <p className="muted">One row per product. Columns: <span className="mono">name</span> (required), <span className="mono">total_samples</span>,{' '}
            <span className="mono">category</span>, <span className="mono">description</span>, and optionally <span className="mono">code</span>.</p>
          <ul className="muted small" style={{ margin: 0, paddingLeft: 18 }}>
            <li>With a <b>code</b>, the row fills that exact QR code.</li>
            <li>Without a code, the row uses the next blank code in print order. If there are no blank codes left, the app creates fresh ones automatically so the import is not skipped.</li>
            <li>Importing again with the same codes updates them. It never changes samples already given.</li>
          </ul>
          <div className="row wrap">
            <button className="btn ghost sm" onClick={template}>Download template</button>
          </div>
          <input className="input" type="file" accept=".csv,text/csv" onChange={pick} aria-label="CSV file" />
          {err && <Banner kind="error">{err}</Banner>}
        </section>

        {parsed && (
          <section className="card stack">
            <h2>2. Check and import</h2>
            <p><strong>{parsed.items.length}</strong> rows found in <span className="mono">{file?.name}</span>
              {parsed.hasCode ? ' (with codes).' : ' (no code column, so blank codes are used in order).'}</p>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Code</th><th>Name</th><th>Category</th><th>Samples</th></tr></thead>
                <tbody>
                  {parsed.items.slice(0, 5).map((r, i) => (
                    <tr key={i}><td className="mono">{r.code}</td><td>{r.name}</td><td>{r.category}</td><td className="mono">{r.total_samples}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="btn primary" onClick={run} disabled={busy}>
              {busy ? `Importing… ${Math.round(progress * 100)}%` : `Import ${parsed.items.length} products`}
            </button>
          </section>
        )}
      </div>

      {result && (
        <section className="card stack">
          <Banner kind={result.errors.length ? 'warn' : 'ok'}>
            Imported {result.imported} products{result.errors.length ? `, ${result.errors.length} rows skipped.` : '.'}
          </Banner>
          {result.mapping.length > 0 && (
            <button className="btn ghost" onClick={() => downloadText('product-code-list.csv', toCsv([['code', 'name'], ...result.mapping.map((m) => [m.code, m.name])]))}>
              Download product and code list
            </button>
          )}
          {result.errors.length > 0 && (
            <div className="table-wrap"><table>
              <thead><tr><th>Row</th><th>Product</th><th>Problem</th></tr></thead>
              <tbody>{result.errors.map((x, i) => <tr key={i}><td className="mono">{x.row}</td><td>{x.name}</td><td>{x.error}</td></tr>)}</tbody>
            </table></div>
          )}
        </section>
      )}
    </main>
  )
}
