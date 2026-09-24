import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../supabase'
import { Banner, Field, Modal, Spinner, useToast } from '../../ui.jsx'

const PAGE = 50

export default function Products() {
  const [rows, setRows] = useState(null)
  const [count, setCount] = useState(0)
  const [page, setPage] = useState(0)
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState('all')
  const [err, setErr] = useState('')
  const [edit, setEdit] = useState(null)
  const [toast, toastNode] = useToast()

  const load = useCallback(async () => {
    let query = supabase.from('products').select('*', { count: 'exact' }).order('seq').range(page * PAGE, page * PAGE + PAGE - 1)
    const term = q.trim().replace(/[,()%*]/g, ' ')
    if (term) query = query.or(`name.ilike.%${term}%,code.ilike.%${term}%,category.ilike.%${term}%`)
    if (filter === 'assigned') query = query.eq('status', 'active')
    if (filter === 'blank') query = query.eq('status', 'unassigned')
    const { data, count: c, error } = await query
    if (error) return setErr(error.message)
    setErr(''); setRows(data); setCount(c || 0)
  }, [page, q, filter])

  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t) }, [load])
  useEffect(() => { setPage(0) }, [q, filter])

  const pages = Math.max(1, Math.ceil(count / PAGE))

  return (
    <main className="page wide">
      <div className="row spread wrap"><h1>Products</h1><span className="muted">{count} codes</span></div>
      <div className="row wrap">
        <input className="input grow" style={{ minWidth: 200 }} placeholder="Search name, code or category" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="input" style={{ width: 'auto' }} value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter">
          <option value="all">All</option>
          <option value="assigned">Linked to a product</option>
          <option value="blank">Blank codes</option>
        </select>
      </div>
      {err && <Banner kind="error">{err}</Banner>}
      {!rows ? <Spinner /> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Code</th><th>Product</th><th>Category</th><th>Given</th><th>Left</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="click" onClick={() => setEdit(r)}>
                  <td className="mono">{r.code}</td>
                  <td>{r.name || <span className="tag">Blank</span>}</td>
                  <td>{r.category}</td>
                  <td className="mono">{r.status === 'active' ? r.samples_given : ''}</td>
                  <td className="mono">{r.status === 'active' ? r.total_samples - r.samples_given : ''}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan="5" className="muted">Nothing matches.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      <div className="row spread">
        <button className="btn ghost sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
        <span className="muted small">Page {page + 1} of {pages}</span>
        <button className="btn ghost sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)}>Next</button>
      </div>
      {edit && <EditModal row={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); toast('Saved'); load() }} />}
      {toastNode}
    </main>
  )
}

function EditModal({ row, onClose, onSaved }) {
  const [f, setF] = useState({ name: row.name || '', category: row.category || '', description: row.description || '', total: row.total_samples })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))

  async function save(e) {
    e.preventDefault()
    setErr('')
    const total = Number.parseInt(f.total, 10)
    if (!f.name.trim()) return setErr('Enter the product name.')
    if (!Number.isInteger(total) || total < 0) return setErr('Sample count must be 0 or more.')
    setBusy(true)
    const { data, error } = await supabase.rpc('save_product', {
      p_code: row.code, p_name: f.name, p_category: f.category, p_description: f.description, p_total: total,
    })
    setBusy(false)
    if (error) return setErr(error.message)
    if (!data?.ok) return setErr(data.error)
    onSaved()
  }

  return (
    <Modal title={`Edit ${row.code}`} onClose={onClose}>
      <form className="stack" onSubmit={save} noValidate>
        <Field label="Product name" htmlFor="en"><input id="en" className="input" value={f.name} onChange={set('name')} /></Field>
        <Field label="Category" htmlFor="ec"><input id="ec" className="input" value={f.category} onChange={set('category')} /></Field>
        <Field label="Total samples" htmlFor="et" hint={row.samples_given ? `${row.samples_given} already given, so the total cannot go below that.` : undefined}>
          <input id="et" className="input" type="number" inputMode="numeric" min={row.samples_given} value={f.total} onChange={set('total')} />
        </Field>
        <Field label="Description" htmlFor="ed"><textarea id="ed" className="input" value={f.description} onChange={set('description')} /></Field>
        {err && <Banner kind="error">{err}</Banner>}
        <button className="btn primary block" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</button>
      </form>
    </Modal>
  )
}
