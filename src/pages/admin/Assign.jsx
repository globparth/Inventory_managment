import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { distinctProducts } from '../../offline'
import { supabase } from '../../supabase'
import { Banner, Field, Spinner, useToast } from '../../ui.jsx'

export default function Assign() {
  const [blankCodes, setBlankCodes] = useState([])
  const [code, setCode] = useState('')
  const [existing, setExisting] = useState([])
  const [picked, setPicked] = useState('')
  const [form, setForm] = useState({ name: '', category: '', description: '', total: '0' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [toast, toastNode] = useToast()

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [blankRes, catalog] = await Promise.all([
          supabase.from('products').select('code').eq('status', 'unassigned').order('seq').limit(200),
          distinctProducts(),
        ])
        if (blankRes.error) throw blankRes.error
        setBlankCodes(blankRes.data || [])
        setExisting(catalog || [])
      } catch (e) {
        setErr(e.message || 'Could not load blank codes.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const setField = (key) => (e) => setForm((s) => ({ ...s, [key]: e.target.value }))

  function pickExistingProduct(e) {
    const name = e.target.value
    setPicked(name)
    if (!name) return
    const item = existing.find((x) => x.name === name)
    if (!item) return
    setForm((s) => ({ ...s, name: item.name, category: item.category || '', description: item.description || '' }))
  }

  async function save(e) {
    e.preventDefault()
    setErr('')

    const trimmedCode = code.trim().toUpperCase()
    if (!trimmedCode) return setErr('Choose a blank code to assign.')
    if (!form.name.trim()) return setErr('Enter the product name.')

    const total = Number.parseInt(form.total, 10)
    if (!Number.isInteger(total) || total < 0) return setErr('Enter how many samples you have (0 or more).')

    setBusy(true)
    const { data, error } = await supabase.rpc('save_product', {
      p_code: trimmedCode,
      p_name: form.name,
      p_category: form.category,
      p_description: form.description,
      p_total: total,
    })
    setBusy(false)

    if (error) return setErr(error.message)
    if (!data?.ok) return setErr(data?.error || 'Could not assign this product.')

    toast('Product assigned')
    setCode('')
    setPicked('')
    setForm({ name: '', category: '', description: '', total: '0' })
    const nextBlank = blankCodes.filter((item) => item.code !== trimmedCode)
    setBlankCodes(nextBlank)
  }

  if (loading) return <main className="page"><Spinner label="Loading blank codes" /></main>

  return (
    <main className="page wide">
      <div className="row spread wrap">
        <div>
          <h1>Assign product to a blank code</h1>
          <p className="muted">Link a printed QR label to a product so it is ready to scan.</p>
        </div>
        <Link className="btn ghost sm" to="/admin/products">Back to products</Link>
      </div>

      {blankCodes.length === 0 && (
        <Banner kind="warn">There are no blank QR codes left to assign. Generate more labels from the QR labels section.</Banner>
      )}
      {err && <Banner kind="error">{err}</Banner>}

      <form className="card stack" onSubmit={save} noValidate>
        <Field label="Blank code" htmlFor="assign-code" hint="Pick a code that has not been linked to a product yet.">
          <select id="assign-code" className="input" value={code} onChange={(e) => setCode(e.target.value)}>
            <option value="">Select a blank code</option>
            {blankCodes.map((item) => (
              <option key={item.code} value={item.code}>{item.code}</option>
            ))}
          </select>
        </Field>

        {existing.length > 0 && (
          <Field label="Existing product" htmlFor="assign-pick" hint="Optional — autofill the product details from a product already in the system.">
            <select id="assign-pick" className="input" value={picked} onChange={pickExistingProduct}>
              <option value="">Choose a saved product</option>
              {existing.map((item) => (
                <option key={item.name} value={item.name}>{item.name}{item.category ? ` (${item.category})` : ''}</option>
              ))}
            </select>
          </Field>
        )}

        <Field label="Product name" htmlFor="assign-name">
          <input id="assign-name" className="input" value={form.name} onChange={setField('name')} />
        </Field>

        <Field label="Category" htmlFor="assign-category">
          <input id="assign-category" className="input" value={form.category} onChange={setField('category')} placeholder="Rice, spices, pulses…" />
        </Field>

        <Field label="Samples in stock" htmlFor="assign-total">
          <input id="assign-total" className="input" type="number" inputMode="numeric" min="0" value={form.total} onChange={setField('total')} />
        </Field>

        <Field label="Description" htmlFor="assign-desc" hint="Shown to anyone who scans the label.">
          <textarea id="assign-desc" className="input" value={form.description} onChange={setField('description')} />
        </Field>

        <div className="row">
          <button type="button" className="btn ghost" onClick={() => {
            setCode('')
            setPicked('')
            setForm({ name: '', category: '', description: '', total: '0' })
            setErr('')
          }}>Clear</button>
          <button className="btn primary grow" type="submit" disabled={busy || blankCodes.length === 0}>
            {busy ? 'Assigning…' : 'Assign product'}
          </button>
        </div>
      </form>
      {toastNode}
    </main>
  )
}
