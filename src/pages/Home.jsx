import { lazy, Suspense, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth.jsx'
import { supabase } from '../supabase'
import { dismissQueued, syncQueue, useQueue } from '../offline'
import { extractCode, timeAgo } from '../lib/util'
import { Banner, Spinner, pad3 } from '../ui.jsx'

const Scanner = lazy(() => import('../Scanner.jsx'))

export default function Home() {
  const { profile, isTeam, loading } = useAuth()
  const nav = useNavigate()
  const queue = useQueue()
  const [scanning, setScanning] = useState(false)
  const [typed, setTyped] = useState('')
  const [typedErr, setTypedErr] = useState('')
  const [recent, setRecent] = useState(null)

  useEffect(() => {
    if (!isTeam || !navigator.onLine) return
    supabase.rpc('my_recent').then(({ data }) => Array.isArray(data) && setRecent(data))
  }, [isTeam, queue.length])

  if (loading) return <Spinner />
  if (!isTeam) {
    return (
      <main className="page">
        <Banner kind="warn">
          Your account ({profile?.email}) is signed in but not approved for sampling. Ask an admin to give you team access.
        </Banner>
      </main>
    )
  }

  const go = (raw) => {
    const code = extractCode(raw)
    if (!code) { setTypedErr('That does not look like a product code.'); return false }
    nav(`/p/${code}`)
    return true
  }

  const first = (profile?.full_name || '').split(' ')[0]
  const failed = queue.filter((q) => q.failed)
  const waiting = queue.filter((q) => !q.failed)

  return (
    <main className="page">
      <h1>{first ? `Hi ${first}` : 'Ready to scan'}</h1>

      {scanning ? (
        <Suspense fallback={<Spinner label="Starting camera" />}>
          <Scanner onCode={(t) => { if (!go(t)) setScanning(false) }} onCancel={() => setScanning(false)} />
        </Suspense>
      ) : (
        <button className="btn primary block" style={{ minHeight: 64, fontSize: '1.1rem' }} onClick={() => { setTypedErr(''); setScanning(true) }}>
          Scan a product QR
        </button>
      )}

      <form className="card stack" onSubmit={(e) => { e.preventDefault(); setTypedErr(''); go(typed) }}>
        <h3>Label damaged? Type the code</h3>
        <div className="row">
          <input className="input mono grow" value={typed} onChange={(e) => setTyped(e.target.value.toUpperCase())}
            placeholder="K7F3Q2" autoCapitalize="characters" autoCorrect="off" spellCheck={false} maxLength={12} aria-label="Product code" />
          <button className="btn ghost" disabled={!typed}>Open</button>
        </div>
        {typedErr && <p className="small" style={{ color: 'var(--danger)' }}>{typedErr}</p>}
      </form>

      {(waiting.length > 0 || failed.length > 0) && (
        <section className="card stack">
          <div className="row spread">
            <h2>Not sent yet</h2>
            {waiting.length > 0 && <button className="btn sm ghost" onClick={() => syncQueue()}>Try now</button>}
          </div>
          {waiting.length > 0 && (
            <p className="muted small">{waiting.length} saved on this phone. They send automatically when the connection is back. Keep this app open or reopen it later.</p>
          )}
          <ul className="list">
            {queue.map((q) => (
              <li key={q.client_id}>
                <div className="grow">
                  <strong>{q.product_name || q.code}</strong> to {q.name}
                  {q.failed && <div className="small" style={{ color: 'var(--danger)' }}>{q.error}</div>}
                </div>
                {q.failed && <button className="btn sm ghost" onClick={() => dismissQueued(q.client_id)}>Dismiss</button>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {recent && recent.length > 0 && (
        <section className="card">
          <h2 style={{ marginBottom: 6 }}>Your last samples</h2>
          <ul className="list">
            {recent.map((r, i) => (
              <li key={i}>
                <div className="grow">
                  <strong>{r.product}</strong> <span className="mono">{pad3(r.sample_no)}</span>
                  <div className="muted small">to {r.recipient_name}</div>
                </div>
                <span className="muted small">{timeAgo(r.given_at)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="muted small">
        Tip: tap Share, then Add to Home Screen, so the app opens like a normal app and keeps working when the hall Wi-Fi drops.
        You can also scan with your phone’s normal camera.
      </p>
    </main>
  )
}
