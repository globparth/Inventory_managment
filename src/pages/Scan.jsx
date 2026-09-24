import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase, ORG_NAME, PUBLIC_CONTACT } from '../supabase'
import { useAuth } from '../auth.jsx'
import { isRetryable, lookupCached, distinctProducts, submitSample } from '../offline'
import { newId } from '../lib/util'
import { Banner, Field, Spinner, Tally, pad3 } from '../ui.jsx'

export default function Scan() {
  const { code: raw } = useParams()
  const code = (raw || '').toUpperCase()
  const { loading: authLoading, session, isTeam } = useAuth()
  const [view, setView] = useState({ status: 'loading' })
  const uid = session?.user?.id

  const load = useCallback(async () => {
    setView((v) => (v.status === 'ready' ? v : { status: 'loading' }))
    const { data, error, status } = await supabase.rpc('scan_product', { p_code: code })
    if (error) {
      if (isRetryable(error, status)) {
        const cached = lookupCached(code)
        setView(cached ? { status: 'offline', cached } : { status: 'offline-miss' })
      } else setView({ status: 'error', message: error.message })
      return
    }
    setView(data?.found ? { status: 'ready', p: data } : { status: 'notfound' })
  }, [code])

  useEffect(() => { if (!authLoading) load() }, [authLoading, load, uid])

  if (view.status === 'loading' || authLoading) return <Spinner label="Loading product" />

  if (view.status === 'notfound') {
    return (
      <main className="page">
        <div className="card stack">
          <h1>Code not found</h1>
          <p className="muted">There is no product with code <span className="mono">{code}</span>. Check the label and try again.</p>
          <Link className="btn primary" to="/">Back to start</Link>
        </div>
      </main>
    )
  }
  if (view.status === 'error') {
    return <main className="page"><Banner kind="error">{view.message}</Banner><button className="btn ghost" onClick={load}>Try again</button></main>
  }
  if (view.status === 'offline-miss') {
    return (
      <main className="page">
        <div className="card stack">
          <h1>No connection</h1>
          <p className="muted">This phone could not reach the server and does not have <span className="mono">{code}</span> saved. Move to a spot with signal and try again.</p>
          <button className="btn primary" onClick={load}>Try again</button>
        </div>
      </main>
    )
  }

  if (view.status === 'offline') {
    return isTeam
      ? <TeamPanel code={code} p={{ code, name: view.cached.name, category: view.cached.category, description: view.cached.description, status: 'active' }} offline reload={load} />
      : <PublicView p={{ code, name: view.cached.name, category: view.cached.category, description: view.cached.description, status: 'active' }} />
  }

  const p = view.p
  return p.team ? <TeamPanel code={code} p={p} reload={load} /> : <PublicView p={p} />
}

/* =============================== public =============================== */
function PublicView({ p }) {
  const loc = encodeURIComponent(`/p/${p.code}`)
  return (
    <main className="page">
      {p.status !== 'active' ? (
        <div className="card stack">
          <span className="codechip">{p.code}</span>
          <h1>Product details coming soon</h1>
          <p className="muted">This sample has not been described yet. Please ask the {ORG_NAME} team at the stand.</p>
        </div>
      ) : (
        <div className="card stack">
          <div className="product-head">
            <div className="row spread">
              <span className="codechip">{p.code}</span>
              {p.category && <span className="tag">{p.category}</span>}
            </div>
            <h1>{p.name}</h1>
          </div>
          {p.description && <p style={{ whiteSpace: 'pre-line' }}>{p.description}</p>}
          <p className="muted small">
            {ORG_NAME}
            {PUBLIC_CONTACT && <><br />{PUBLIC_CONTACT}</>}
          </p>
        </div>
      )}
      <p className="small muted"><Link to={`/login?next=${loc}`}>Team sign in</Link></p>
    </main>
  )
}

/* ================================ team ================================ */
function TeamPanel({ code, p, offline = false, reload }) {
  const { isAdmin } = useAuth()
  const nav = useNavigate()
  const [editing, setEditing] = useState(false)
  const [done, setDone] = useState(null)   // result after a sample is logged
  const setup = p.status !== 'active'

  if (setup || editing) {
    return (
      <main className="page">
        <SetupForm code={code} initial={p} isNew={setup} offline={offline}
          onSaved={() => { setEditing(false); reload() }} onCancel={setup ? () => nav('/') : () => setEditing(false)} />
      </main>
    )
  }

  if (done) {
    return (
      <main className="page has-bar">
        <div className="stack" style={{ marginTop: 6 }}>
          {done.queued ? (
            <div className="stamp pending">
              <p className="muted">Saved on this phone</p>
              <div className="no">Waiting to sync</div>
              <p><strong>{p.name}</strong> to <strong>{done.name}</strong></p>
              <p className="muted small">The sample number is assigned when the connection is back. Nothing is lost.</p>
            </div>
          ) : (
            <div className="stamp">
              <p className="muted">{p.name}</p>
              <div className="no">{pad3(done.data.sample_no)}</div>
              <p>given to <strong>{done.name}</strong></p>
              <p className="muted small">{done.data.left} left of this product</p>
            </div>
          )}
        </div>
        <div className="actionbar"><div className="stack">
          <button className="btn primary block" onClick={() => nav('/')}>Scan next product</button>
          <button className="btn ghost block" onClick={() => { setDone(null); reload() }}>Give another of this product</button>
        </div></div>
      </main>
    )
  }

  return <GiveForm code={code} p={p} offline={offline} isAdmin={isAdmin} onEdit={() => setEditing(true)} onDone={setDone} />
}

function GiveForm({ code, p, offline, isAdmin, onEdit, onDone }) {
  const [f, setF] = useState({ name: '', phone: '', email: '', company: '', notes: '' })
  const [showNotes, setShowNotes] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [returning, setReturning] = useState(false)
  const clientId = useRef(newId())     // same id for every retry of THIS submission
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))

  const soldOut = !offline && p.left <= 0

  async function lookupPhone() {
    const digits = f.phone.replace(/\D/g, '')
    if (digits.length < 8 || !navigator.onLine) return
    const { data } = await supabase.rpc('find_recipient', { p_phone: f.phone })
    if (data?.found) {
      setReturning(true)
      setF((s) => ({ ...s, name: s.name || data.name || '', email: s.email || data.email || '', company: s.company || data.company || '' }))
    }
  }

  async function submit(e) {
    e.preventDefault()
    setErr('')
    if (!f.name.trim()) return setErr('Enter the person’s name.')
    if (!f.phone.replace(/\D/g, '') && !f.email.trim()) return setErr('Enter a phone number or an email.')
    setBusy(true)
    const res = await submitSample({ ...f, code, client_id: clientId.current, product_name: p.name })
    setBusy(false)
    if (res.state === 'done') onDone({ data: res.data, name: f.name.trim() })
    else if (res.state === 'queued') onDone({ queued: true, name: f.name.trim() })
    else setErr(res.message)
  }

  return (
    <main className="page has-bar">
      <div className="product-head">
        <div className="row spread">
          <span className="codechip">{code}</span>
          <div className="row">
            {p.category && <span className="tag">{p.category}</span>}
            {isAdmin && !offline && <button className="linkbtn small" onClick={onEdit}>Edit</button>}
          </div>
        </div>
        <h1>{p.name}</h1>
      </div>

      {offline ? (
        <Banner kind="warn">No connection. You can still record this sample. It is saved on this phone and sent when the connection returns. Samples left is not shown while offline.</Banner>
      ) : (
        <div className="stack" style={{ gap: 8 }}>
          <Tally total={p.total} given={p.given} />
          <div className="count-line">
            <span><strong>{p.given}</strong> given</span>
            <span><strong>{p.left}</strong> left</span>
          </div>
        </div>
      )}

      {soldOut ? (
        <Banner kind="error">No samples left for this product.</Banner>
      ) : (
        <form id="give" className="card stack" onSubmit={submit} noValidate>
          <h2>Who is receiving it?</h2>
          <Field label="Name" htmlFor="name">
            <input id="name" className="input" autoComplete="name" autoCapitalize="words" value={f.name} onChange={set('name')} />
          </Field>
          <Field label="Phone" htmlFor="phone" hint={returning ? 'Returning contact. Details filled in.' : undefined}>
            <input id="phone" className="input" type="tel" inputMode="tel" autoComplete="tel" value={f.phone}
              onChange={set('phone')} onBlur={lookupPhone} placeholder="+91 98765 43210" />
          </Field>
          <Field label="Email" htmlFor="email">
            <input id="email" className="input" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" value={f.email} onChange={set('email')} />
          </Field>
          <Field label="Company" htmlFor="company">
            <input id="company" className="input" autoComplete="organization" value={f.company} onChange={set('company')} />
          </Field>
          {showNotes ? (
            <Field label="Note" htmlFor="notes">
              <textarea id="notes" className="input" value={f.notes} onChange={set('notes')} />
            </Field>
          ) : (
            <button type="button" className="linkbtn" style={{ justifySelf: 'start' }} onClick={() => setShowNotes(true)}>Add a note</button>
          )}
          {err && <Banner kind="error">{err}</Banner>}
        </form>
      )}

      {!soldOut && (
        <div className="actionbar"><div>
          <button className="btn primary block" form="give" type="submit" disabled={busy}>
            {busy ? 'Saving…' : offline ? 'Save sample on this phone' : `Give sample ${pad3(p.next_no)}`}
          </button>
        </div></div>
      )}

      {!offline && p.recent?.length > 0 && (
        <section className="card">
          <h3 style={{ marginBottom: 4 }}>Latest for this product</h3>
          <ul className="list">
            {p.recent.map((r) => (
              <li key={r.sample_no}>
                <span><span className="mono">{pad3(r.sample_no)}</span> {r.recipient_name}</span>
                <span className="muted small">{r.given_by_name}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}

/* Filling in a blank code (team) or editing a product (admin). */
function SetupForm({ code, initial, isNew, offline, onSaved, onCancel }) {
  const [f, setF] = useState({
    name: initial.name || '', category: initial.category || '', description: initial.description || '',
    total: initial.total ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [existing, setExisting] = useState(null)   // list of {name, category, description}, once loaded
  const [picked, setPicked] = useState('')          // which one is selected in the dropdown, '' = new product
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))

  useEffect(() => {
    if (!isNew || offline) return
    distinctProducts().then(setExisting)
  }, [isNew, offline])

  function pick(e) {
    const name = e.target.value
    setPicked(name)
    if (!name) return                              // "+ Add a new product" — leave fields as the person is typing them
    const p = existing.find((x) => x.name === name)
    if (p) setF((s) => ({ ...s, name: p.name, category: p.category, description: p.description }))
  }

  async function save(e) {
    e.preventDefault()
    setErr('')
    if (!f.name.trim()) return setErr('Enter the product name.')
    const total = Number.parseInt(f.total, 10)
    if (!Number.isInteger(total) || total < 0) return setErr('Enter how many samples you have (0 or more).')
    setBusy(true)
    const { data, error } = await supabase.rpc('save_product', {
      p_code: code, p_name: f.name, p_category: f.category, p_description: f.description, p_total: total,
    })
    setBusy(false)
    if (error) return setErr(error.message)
    if (!data?.ok) return setErr(data?.error || 'Could not save')
    onSaved()
  }

  return (
    <form className="card stack" onSubmit={save} noValidate>
      <div className="row spread"><span className="codechip">{code}</span></div>
      <h1>{isNew ? 'Set up this product' : 'Edit product'}</h1>
      {isNew && <p className="muted">This label has no product yet. Fill it in and it is ready to use straight away.</p>}
      {offline && <Banner kind="warn">You are offline. Setting up a product needs a connection.</Banner>}
      {isNew && existing?.length > 0 && (
        <Field label="Product" htmlFor="pexisting" hint="Optional — pick one to fill in the details below, then edit them if you need to. Or leave this as it is and just type the details below yourself.">
          <select id="pexisting" className="input" value={picked} onChange={pick}>
            <option value="">Fill in manually</option>
            {existing.map((p) => <option key={p.name} value={p.name}>{p.name}{p.category ? ` (${p.category})` : ''}</option>)}
          </select>
        </Field>
      )}
      <Field label="Product name" htmlFor="pn"><input id="pn" className="input" value={f.name} onChange={set('name')} /></Field>
      <Field label="Category" htmlFor="pc"><input id="pc" className="input" value={f.category} onChange={set('category')} placeholder="Rice, spices, pulses…" /></Field>
      <Field label="Samples in stock" htmlFor="pt" hint="Total number of samples you have for this product.">
        <input id="pt" className="input" type="number" inputMode="numeric" min="0" value={f.total} onChange={set('total')} />
      </Field>
      <Field label="Description" htmlFor="pd" hint="Shown to anyone who scans the label.">
        <textarea id="pd" className="input" value={f.description} onChange={set('description')} />
      </Field>
      {err && <Banner kind="error">{err}</Banner>}
      <div className="row">
        <button type="button" className="btn ghost" onClick={onCancel}>Cancel</button>
        <button className="btn primary grow" disabled={busy || offline}>{busy ? 'Saving…' : 'Save product'}</button>
      </div>
    </form>
  )
}
