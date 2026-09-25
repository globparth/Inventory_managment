import { lazy, Suspense, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { extractCode } from '../../lib/util'
import { supabase } from '../../supabase'
import { Banner, Field, Spinner, useToast } from '../../ui.jsx'

const Scanner = lazy(() => import('../../Scanner.jsx'))

export default function Assign() {
  const [blankCodes, setBlankCodes] = useState([])
  const [code, setCode] = useState('')
  const [existing, setExisting] = useState([])
  const [picked, setPicked] = useState('')
  const [productMode, setProductMode] = useState('manual')
  const [form, setForm] = useState({ name: '', category: '', description: '', total: '0' })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [toast, toastNode] = useToast()

  useEffect(() => {
    async function load() {
      setLoading(true)
      try {
        const [blankRes, productRes] = await Promise.all([
          supabase.from('products').select('code').eq('status', 'unassigned').order('seq').limit(200),
          supabase.from('products').select('name, category, description').eq('status', 'active').not('name', 'is', null).order('name').limit(200),
        ])
        if (blankRes.error) throw blankRes.error
        if (productRes.error) throw productRes.error
        setBlankCodes(blankRes.data || [])

        const seen = new Map()
        for (const item of productRes.data || []) {
          const name = (item.name || '').trim()
          if (!name || seen.has(name)) continue
          seen.set(name, { name, category: item.category || '', description: item.description || '' })
        }
        const rows = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
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

  function handleScanned(raw) {
    const result = extractCode(raw)
    if (!result) {
      setErr('That does not look like a QR code for a blank label.')
      setScanning(false)
      return
    }
    if (!blankCodes.some((item) => item.code === result)) {
      setErr(`Code ${result} is already assigned or not in the blank-code list.`)
      setScanning(false)
      return
    }
    setCode(result)
    setErr('')
    setScanning(false)
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
    setProductMode('manual')
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

      {scanning ? (
        <div className="card stack">
          <Suspense fallback={<Spinner label="Starting camera" />}>
            <Scanner onCode={handleScanned} onCancel={() => setScanning(false)} />
          </Suspense>
        </div>
      ) : null}

      <form className="card stack" onSubmit={save} noValidate>
        <Field label="Blank code" htmlFor="assign-code" hint="Pick a code that has not been linked to a product yet.">
          <div className="row">
            <select id="assign-code" className="input grow" value={code} onChange={(e) => setCode(e.target.value)}>
              <option value="">Select a blank code</option>
              {blankCodes.map((item) => (
                <option key={item.code} value={item.code}>{item.code}</option>
              ))}
            </select>
            <button type="button" className="btn ghost" onClick={() => { setErr(''); setScanning(true) }}>Scan QR</button>
          </div>
        </Field>

        {existing.length > 0 && (
          <Field label={productMode === 'existing' ? 'Use existing product' : 'Select product'} htmlFor="assign-pick" hint="Choose a product already listed in the app, or switch to manual entry below.">
            <div className="row">
              <select id="assign-pick" className="input grow" value={picked} onChange={pickExistingProduct}>
                <option value="">{productMode === 'existing' ? 'Choose a saved product' : 'Select a product from the list'}</option>
                {existing.map((item) => (
                  <option key={item.name} value={item.name}>{item.name}{item.category ? ` (${item.category})` : ''}</option>
                ))}
              </select>
              {productMode === 'existing' && (
                <button type="button" className="btn ghost" onClick={startManualEntry}>Enter manually</button>
              )}
            </div>
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
            setProductMode(existing.length > 0 ? 'manual' : 'manual')
            setForm({ name: '', category: '', description: '', total: '0' })
            setErr('')
          }}>Clear</button>
          {existing.length > 0 && productMode === 'manual' && (
            <button type="button" className="btn ghost" onClick={() => setProductMode('existing')}>Use existing product</button>
          )}
          <button className="btn primary grow" type="submit" disabled={busy || blankCodes.length === 0}>
            {busy ? 'Assigning…' : 'Assign product'}
          </button>
        </div>
      </form>
      {toastNode}
    </main>
  )
}
