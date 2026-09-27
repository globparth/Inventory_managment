import { lazy, Suspense, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { extractCode } from '../../lib/util'
import { supabase } from '../../supabase'
import { Banner, Field, Spinner, useToast } from '../../ui.jsx'

const Scanner = lazy(() => import('../../Scanner.jsx'))

export default function Assign() {
  const [blankCodes, setBlankCodes] = useState([])
  const [code, setCode] = useState('')
  const [correcting, setCorrecting] = useState(null)   // {code, name, given} of an already-assigned code being fixed
  const [existing, setExisting] = useState([])
  const [picked, setPicked] = useState('')
  const [search, setSearch] = useState('')
  const [productMode, setProductMode] = useState('manual')
  const [form, setForm] = useState({ name: '', category: '', description: '' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [toast, toastNode] = useToast()

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [blankRes, pickerRes] = await Promise.all([
          supabase.from('products').select('code').eq('status', 'unassigned').order('seq').limit(200),
          supabase.rpc('get_product_picker'),
        ])
        if (blankRes.error) throw blankRes.error
        if (pickerRes.error) throw pickerRes.error
        setBlankCodes(blankRes.data || [])

        const rows = (pickerRes.data || []).map((item) => ({
          name: item.name, category: item.category || '', description: item.description || '',
          assigned: item.assigned || 0, given: item.given || 0,
        }))
        setExisting(rows)
        if (rows.length === 0) setProductMode('manual')
      } catch (e) {
        setErr(e.message || 'Could not load blank codes.')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const setField = (key) => (e) => setForm((s) => ({ ...s, [key]: e.target.value }))

  async function handleScanned(raw) {
    const result = extractCode(raw)
    setScanning(false)
    if (!result) {
      setErr('That does not look like a QR code for a blank label.')
      return
    }
    // Check the live database for this one code, not the capped 200-code
    // list used for the dropdown -- with thousands of codes, a scanned one
    // is very often outside that first page and would be wrongly rejected.
    const { data, error } = await supabase.from('products')
      .select('code, status, name, category, description, samples_given').eq('code', result).maybeSingle()
    if (error) { setErr(error.message); return }
    if (!data) { setErr(`Code ${result} was not found. Check the label and try again.`); return }

    if (data.status === 'unassigned') {
      setBlankCodes((rows) => (rows.some((item) => item.code === result) ? rows : [...rows, { code: result }]))
      setCorrecting(null)
      setCode(result)
      setErr('')
      return
    }

    // Already assigned -- let the admin correct it instead of just refusing.
    setCorrecting({ code: result, name: data.name, given: data.samples_given > 0 })
    setPicked('')
    setSearch('')
    setProductMode('manual')
    setForm({ name: data.name || '', category: data.category || '', description: data.description || '' })
    setCode(result)
    setErr('')
  }

  function pickExistingProduct(e) {
    const name = e.target.value
    setPicked(name)
    if (!name) {
      setProductMode('manual')
      return
    }
    const item = existing.find((x) => x.name === name)
    if (!item) return
    setForm((s) => ({ ...s, name: item.name, category: item.category || '', description: item.description || '' }))
    setProductMode('existing')
  }

  function startManualEntry() {
    setPicked('')
    setSearch('')
    setProductMode('manual')
    setForm({ name: '', category: '', description: '' })
  }

  async function save(e) {
    e.preventDefault()
    setErr('')

    const trimmedCode = code.trim().toUpperCase()
    const trimmedName = form.name.trim()
    if (!trimmedCode) return setErr('Scan or choose a code to assign.')
    if (!trimmedName) return setErr('Enter the product name.')

    setBusy(true)
    // Every code is one sample unit, so the count of codes assigned to a
    // product IS its stock -- there is nothing to type in here.
    const { data, error } = await supabase.rpc('save_product', {
      p_code: trimmedCode,
      p_name: trimmedName,
      p_category: form.category,
      p_description: form.description,
      p_total: 1,
    })
    setBusy(false)

    if (error) return setErr(error.message)
    if (!data?.ok) return setErr(data?.error || 'Could not assign this product.')

    toast(correcting ? `${trimmedCode} corrected → ${trimmedName}` : `${trimmedCode} → ${trimmedName}`)
    setBlankCodes((rows) => rows.filter((item) => item.code !== trimmedCode))

    // Keep the running per-product counts accurate: a fresh blank-code
    // assignment adds one to the target product; correcting a wrongly
    // assigned code moves one from its old (wrong) product to the new one
    // -- or touches nothing if only the category/description was fixed.
    const oldName = correcting?.name
    const sameName = oldName && oldName.toLowerCase() === trimmedName.toLowerCase()
    setExisting((rows) => {
      let next = rows
      if (oldName && !sameName) {
        next = next.map((r) => (r.name.toLowerCase() === oldName.toLowerCase()
          ? { ...r, assigned: Math.max(0, r.assigned - 1), given: correcting.given ? Math.max(0, r.given - 1) : r.given }
          : r))
      }
      if (sameName) return next
      const i = next.findIndex((r) => r.name.toLowerCase() === trimmedName.toLowerCase())
      if (i === -1) {
        const added = { name: trimmedName, category: form.category || '', description: form.description || '', assigned: 1, given: correcting?.given ? 1 : 0 }
        return [...next, added].sort((a, b) => a.name.localeCompare(b.name))
      }
      const copy = [...next]
      copy[i] = { ...copy[i], assigned: copy[i].assigned + 1, given: copy[i].given + (correcting?.given ? 1 : 0) }
      return copy
    })
    setCode('')
    setCorrecting(null)
    setPicked('')
    setSearch('')
    setForm({ name: '', category: '', description: '' })
  }

  if (loading) return <main className="page"><Spinner label="Loading blank codes" /></main>

  const count = existing.find((x) => x.name.toLowerCase() === form.name.trim().toLowerCase())
  const term = search.trim().toLowerCase()
  const filtered = term ? existing.filter((item) => item.name.toLowerCase().includes(term)) : existing

  return (
    <main className="page wide">
      <div className="row spread wrap">
        <div>
          <h1>Assign product to a blank code</h1>
          <p className="muted">Link a printed QR label to a product so it is ready to scan. Each code is one sample -- the count below is how many codes you've assigned to a product.</p>
        </div>
        <Link className="btn ghost sm" to="/admin/products">Back to products</Link>
      </div>

      {blankCodes.length === 0 && !correcting && (
        <Banner kind="warn">There are no blank QR codes left to assign. Generate more labels from the QR labels section.</Banner>
      )}
      {correcting && (
        <Banner kind="warn">
          Code {correcting.code} is already assigned to <strong>{correcting.name}</strong>. Fix the details below and save to correct it.
        </Banner>
      )}
      {err && <Banner kind="error">{err}</Banner>}

      {scanning ? (
        <div className="card stack">
          <Suspense fallback={<Spinner label="Starting camera" />}>
            <Scanner onCode={handleScanned} onCancel={() => setScanning(false)} />
          </Suspense>
        </div>
      ) : null}

      <form className="card stack" onSubmit={save} noValidate>
        <Field label="Code" htmlFor="assign-code" hint="Pick a blank code to assign, or scan an already-assigned code to correct it.">
          <div className="row">
            <select id="assign-code" className="input grow" value={correcting ? '' : code}
              onChange={(e) => { setCorrecting(null); setCode(e.target.value) }}>
              <option value="">Select a blank code</option>
              {blankCodes.map((item) => (
                <option key={item.code} value={item.code}>{item.code}</option>
              ))}
            </select>
            <button type="button" className="btn ghost" onClick={() => { setErr(''); setScanning(true) }}>Scan QR</button>
          </div>
        </Field>

        {existing.length > 0 && (
          <Field label={productMode === 'existing' ? 'Use existing product' : 'Select product'} htmlFor="assign-pick" hint="Search to narrow the list, then pick one. Or switch to manual entry below to add a brand new product.">
            <div className="stack" style={{ gap: 6 }}>
              <input className="input" placeholder={`Search ${existing.length} products…`} value={search}
                onChange={(e) => setSearch(e.target.value)} aria-label="Search products" />
              <div className="row">
                <select id="assign-pick" className="input grow" value={picked} onChange={pickExistingProduct}>
                  <option value="">{filtered.length ? (productMode === 'existing' ? 'Choose a saved product' : 'Select a product from the list') : 'No products match your search'}</option>
                  {filtered.map((item) => (
                    <option key={item.name} value={item.name}>
                      {item.name}{item.category ? ` (${item.category})` : ''} — {item.assigned} assigned
                    </option>
                  ))}
                </select>
                {productMode === 'existing' && (
                  <button type="button" className="btn ghost" onClick={startManualEntry}>Enter manually</button>
                )}
              </div>
            </div>
          </Field>
        )}

        <Field label="Product name" htmlFor="assign-name">
          <input id="assign-name" className="input" value={form.name} onChange={setField('name')} />
        </Field>

        {count && (
          <p className="muted small" style={{ margin: 0 }}>
            <strong>{count.assigned}</strong> code{count.assigned === 1 ? '' : 's'} already assigned to this product
            {count.given > 0 ? `, ${count.given} given out` : ''}.
          </p>
        )}

        <Field label="Category" htmlFor="assign-category">
          <input id="assign-category" className="input" value={form.category} onChange={setField('category')} placeholder="Rice, spices, pulses…" />
        </Field>

        <Field label="Description" htmlFor="assign-desc" hint="Shown to anyone who scans the label.">
          <textarea id="assign-desc" className="input" value={form.description} onChange={setField('description')} />
        </Field>

        <div className="row">
          <button type="button" className="btn ghost" onClick={() => {
            setCode('')
            setCorrecting(null)
            setPicked('')
            setSearch('')
            setProductMode('manual')
            setForm({ name: '', category: '', description: '' })
            setErr('')
          }}>Clear</button>
          {existing.length > 0 && productMode === 'manual' && (
            <button type="button" className="btn ghost" onClick={() => setProductMode('existing')}>Use existing product</button>
          )}
          <button className="btn primary grow" type="submit" disabled={busy || !code}>
            {busy ? 'Saving…' : correcting ? 'Save correction' : 'Assign product'}
          </button>
        </div>
      </form>
      {toastNode}
    </main>
  )
}
