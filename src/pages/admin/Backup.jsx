import { useState } from 'react'
import JSZip from 'jszip'
import { supabase } from '../../supabase'
import { toCsv } from '../../lib/csv'
import { Banner, Field } from '../../ui.jsx'

const PRODUCT_COLS = 'code,name,category,description,total_samples,samples_given,status,batch,created_at'
const LOG_COLS = 'sample_no,recipient_name,phone,email,company,notes,given_by_name,given_at,voided,void_reason,products(code,name)'

async function fetchAll(table, cols) {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(table).select(cols).range(from, from + 999)
    if (error) throw error
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}

export default function Backup() {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState('')

  async function download() {
    setBusy(true); setErr(''); setDone('')
    try {
      const [products, log] = await Promise.all([
        fetchAll('products', PRODUCT_COLS),
        fetchAll('sample_log', LOG_COLS),
      ])
      const zip = new JSZip()
      zip.file('products.csv', toCsv([
        ['code', 'name', 'category', 'description', 'total_samples', 'samples_given', 'status', 'batch', 'created_at'],
        ...products.map((p) => [p.code, p.name, p.category, p.description, p.total_samples, p.samples_given, p.status, p.batch, p.created_at]),
      ]))
      zip.file('sample_log.csv', toCsv([
        ['product_code', 'product_name', 'sample_no', 'name', 'phone', 'email', 'company', 'note', 'given_by', 'given_at', 'cancelled', 'cancel_reason'],
        ...log.map((r) => [r.products?.code, r.products?.name, r.sample_no, r.recipient_name, r.phone, r.email, r.company, r.notes, r.given_by_name, r.given_at, r.voided ? 'yes' : '', r.void_reason]),
      ]))
      zip.file('README.txt',
        `Sample Desk backup — ${new Date().toISOString()}\n\n` +
        `products.csv    every QR code and its product info, ${products.length} rows\n` +
        `sample_log.csv  every sample given out, ${log.length} rows\n\n` +
        `This is a readable copy for your own records. It is not a database restore file.\n` +
        `To move to a brand new Supabase project instead, use scripts/backup.sh and\n` +
        `scripts/restore.sh from the project folder (see the README).\n`)
      const blob = await zip.generateAsync({ type: 'blob' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `sampledesk-backup-${new Date().toISOString().slice(0, 10)}.zip`
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(a.href), 4000)
      setDone(`Saved ${products.length} products and ${log.length} sample entries.`)
    } catch (e) {
      setErr(e.message)
    }
    setBusy(false)
  }

  return (
    <main className="page wide">
      <h1>Backup</h1>

      <section className="card stack">
        <h2>Quick backup (readable files)</h2>
        <p className="muted">
          Downloads every product and every sample entry as CSV files you can open in Excel, zipped together.
          Good for a daily safety copy during the event, or to keep for your own records. It cannot be loaded
          back into the app by itself — it's for reading, not restoring.
        </p>
        <button className="btn primary" onClick={download} disabled={busy}>{busy ? 'Preparing…' : 'Download backup (.zip)'}</button>
        {err && <Banner kind="error">{err}</Banner>}
        {done && <Banner kind="ok">{done}</Banner>}
      </section>

      <section className="card stack">
        <h2>Full database backup (for disaster recovery)</h2>
        <p className="muted">
          If something goes badly wrong with your Supabase project — it's deleted, locked, or you need to move to a
          new free project — the CSV backup above isn't enough to restore your exact QR codes and counts. For that,
          use the scripts in the project folder from a computer with internet:
        </p>
        <pre className="mono small" style={{ background: '#f6f8f4', padding: 12, borderRadius: 10, overflowX: 'auto' }}>
{`export SUPABASE_DB_URL="postgresql://postgres:...@db.xxxx.supabase.co:5432/postgres"
./scripts/backup.sh`}
        </pre>
        <p className="muted small">
          Get that connection string from Supabase: Project Settings → Database → Connection string. Run this
          weekly during the event and keep the file it makes somewhere other than one laptop. Full instructions,
          including how to restore into a new project, are in <span className="mono">README.md</span> and at the
          top of <span className="mono">scripts/backup.sh</span>.
        </p>
      </section>

      <ResetSection />
    </main>
  )
}

function ResetSection() {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState('')

  async function run() {
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc('reset_for_new_event', { p_confirm: text })
    setBusy(false)
    if (error) return setErr(error.message)
    if (!data?.ok) return setErr(data.error)
    setDone(`Cleared ${data.cleared_entries} sample entries and reset ${data.reset_products} products to zero. Your QR codes and product list are unchanged.`)
    setOpen(false); setText('')
  }

  return (
    <section className="card stack">
      <h2>Reuse these QR codes for your next event</h2>
      <p className="muted">
        Once this fair is over, you can reuse the same printed labels next time instead of printing new ones.
        This clears the sample log and sets every product back to zero given — but keeps every product name,
        description and QR code exactly as it is, so nothing needs reprinting. This also keeps your database
        small indefinitely, however many events you run through it.
      </p>
      <Banner kind="warn">This cannot be undone from inside the app. Download a backup above first.</Banner>
      {!open ? (
        <button className="btn ghost" onClick={() => setOpen(true)}>Start a new event…</button>
      ) : (
        <div className="stack">
          <Field label='Type "RESET" to confirm' htmlFor="rc">
            <input id="rc" className="input mono" value={text} onChange={(e) => setText(e.target.value)} autoCapitalize="characters" autoComplete="off" />
          </Field>
          {err && <Banner kind="error">{err}</Banner>}
          <div className="row">
            <button className="btn ghost" onClick={() => { setOpen(false); setText(''); setErr('') }}>Cancel</button>
            <button className="btn danger grow" disabled={busy || text !== 'RESET'} onClick={run}>{busy ? 'Resetting…' : 'Clear the log and reset counts'}</button>
          </div>
        </div>
      )}
      {done && <Banner kind="ok">{done}</Banner>}
    </section>
  )
}
