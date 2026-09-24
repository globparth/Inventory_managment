import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../supabase'
import { toCsv } from '../../lib/csv'
import { downloadText, fmtDateTime } from '../../lib/util'
import { Banner, Modal, Spinner, pad3, useToast } from '../../ui.jsx'

const PAGE = 50
const COLS = 'id, sample_no, recipient_name, phone, phone_key, email, company, notes, given_by_name, given_at, voided, void_reason, products(code, name)'

async function fetchAll() {
  const out = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('sample_log').select(COLS).order('given_at', { ascending: false }).range(from, from + 999)
    if (error) throw error
    out.push(...data)
    if (data.length < 1000) break
  }
  return out
}

export default function Log() {
  const [rows, setRows] = useState(null)
  const [count, setCount] = useState(0)
  const [page, setPage] = useState(0)
  const [q, setQ] = useState('')
  const [err, setErr] = useState('')
  const [voiding, setVoiding] = useState(null)
  const [busy, setBusy] = useState(false)
  const [toast, toastNode] = useToast()

  const load = useCallback(async () => {
    let query = supabase.from('sample_log').select(COLS, { count: 'exact' })
      .order('given_at', { ascending: false }).range(page * PAGE, page * PAGE + PAGE - 1)
    const term = q.trim().replace(/[,()%*]/g, ' ')
    if (term) query = query.or(`recipient_name.ilike.%${term}%,phone.ilike.%${term}%,email.ilike.%${term}%,company.ilike.%${term}%`)
    const { data, count: c, error } = await query
    if (error) return setErr(error.message)
    setErr(''); setRows(data); setCount(c || 0)
  }, [page, q])

  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t) }, [load])
  useEffect(() => { setPage(0) }, [q])

  async function exportAll() {
    setBusy(true)
    try {
      const all = await fetchAll()
      downloadText('sample-log.csv', toCsv([
        ['time', 'product code', 'product', 'sample no', 'name', 'phone', 'email', 'company', 'note', 'given by', 'cancelled'],
        ...all.map((r) => [new Date(r.given_at).toISOString(), r.products?.code, r.products?.name, r.sample_no, r.recipient_name,
          r.phone, r.email, r.company, r.notes, r.given_by_name, r.voided ? 'yes' : '']),
      ]))
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  // One row per person, with everything they received. Handy for follow-up after the event.
  async function exportContacts() {
    setBusy(true)
    try {
      const all = (await fetchAll()).filter((r) => !r.voided).reverse()      // oldest first
      const people = new Map()
      for (const r of all) {
        const key = r.phone_key || r.email || `${r.recipient_name}|${r.company}`
        const p = people.get(key) || { name: r.recipient_name, phone: r.phone, email: r.email, company: r.company, items: [], first: r.given_at }
        p.name = r.recipient_name || p.name
        p.email = r.email || p.email
        p.company = r.company || p.company
        p.phone = r.phone || p.phone
        p.items.push(r.products?.name || r.products?.code)
        people.set(key, p)
      }
      downloadText('contacts.csv', toCsv([
        ['name', 'phone', 'email', 'company', 'samples received', 'products', 'first contact'],
        ...[...people.values()].map((p) => [p.name, p.phone, p.email, p.company, p.items.length, p.items.join('; '), new Date(p.first).toISOString()]),
      ]))
    } catch (e) { setErr(e.message) }
    setBusy(false)
  }

  async function doVoid(reason) {
    const { data, error } = await supabase.rpc('void_sample', { p_log_id: voiding.id, p_reason: reason })
    if (error || !data?.ok) { setErr(error?.message || data?.error); return }
    setVoiding(null); toast('Entry cancelled, sample returned to stock'); load()
  }

  return (
    <main className="page wide">
      <div className="row spread wrap"><h1>Sample log</h1><span className="muted">{count} entries</span></div>
      <div className="row wrap">
        <input className="input grow" style={{ minWidth: 200 }} placeholder="Search name, phone, email or company" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn ghost" onClick={exportAll} disabled={busy}>Download all entries</button>
        <button className="btn ghost" onClick={exportContacts} disabled={busy}>Download unique contacts</button>
      </div>
      {err && <Banner kind="error">{err}</Banner>}
      {!rows ? <Spinner /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Time</th><th>Product</th><th>No.</th><th>Received by</th><th>Phone</th><th>Email</th><th>Company</th><th>Given by</th><th></th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={r.voided ? 'void' : undefined}>
                  <td>{fmtDateTime(r.given_at)}</td>
                  <td>{r.products?.name} <span className="mono muted small">{r.products?.code}</span></td>
                  <td className="mono">{pad3(r.sample_no)}</td>
                  <td>{r.recipient_name}</td>
                  <td>{r.phone}</td>
                  <td>{r.email}</td>
                  <td>{r.company}</td>
                  <td>{r.given_by_name}</td>
                  <td>{r.voided ? <span className="tag bad">Cancelled</span> : <button className="linkbtn" onClick={() => setVoiding(r)}>Cancel</button>}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan="9" className="muted">No entries yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <div className="row spread">
        <button className="btn ghost sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
        <span className="muted small">Page {page + 1} of {Math.max(1, Math.ceil(count / PAGE))}</span>
        <button className="btn ghost sm" disabled={(page + 1) * PAGE >= count} onClick={() => setPage(page + 1)}>Next</button>
      </div>
      {voiding && <VoidModal row={voiding} onClose={() => setVoiding(null)} onConfirm={doVoid} />}
      {toastNode}
    </main>
  )
}

function VoidModal({ row, onClose, onConfirm }) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Modal title="Cancel this entry?" onClose={onClose}>
      <div className="stack">
        <p>{row.products?.name}, sample <span className="mono">{pad3(row.sample_no)}</span>, to <strong>{row.recipient_name}</strong>.
          The sample goes back into stock. The number is not reused.</p>
        <input className="input" placeholder="Reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <button className="btn danger block" disabled={busy} onClick={async () => { setBusy(true); await onConfirm(reason); setBusy(false) }}>Cancel entry</button>
      </div>
    </Modal>
  )
}
