import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../supabase'
import { Banner, Spinner } from '../../ui.jsx'

export default function Dashboard() {
  const [s, setS] = useState(null)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    const { data, error } = await supabase.rpc('admin_stats')
    if (error) setErr(error.message)
    else { setS(data); setErr('') }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [load])

  if (err) return <main className="page wide"><Banner kind="error">{err}</Banner></main>
  if (!s) return <Spinner />

  const pct = s.samples_total ? Math.round((s.samples_given / s.samples_total) * 100) : 0

  return (
    <main className="page wide">
      <div className="row spread"><h1>Dashboard</h1><button className="btn ghost sm" onClick={load}>Refresh</button></div>

      {s.codes_total === 0 && (
        <Banner kind="info">No QR codes yet. Open <Link to="/admin/labels">QR labels</Link> to generate them.</Banner>
      )}

      <div className="stats">
        <div className="stat"><div className="v">{s.samples_given}</div><div className="k">samples given of {s.samples_total} ({pct}%)</div></div>
        <div className="stat"><div className="v">{s.people}</div><div className="k">people collected</div></div>
        <div className="stat"><div className="v">{s.last_24h}</div><div className="k">given in the last 24 hours</div></div>
        <div className="stat"><div className="v">{s.assigned}<span className="muted small"> / {s.codes_total}</span></div><div className="k">codes linked to a product ({s.unassigned} blank)</div></div>
      </div>

      <div className="two">
        <section className="card">
          <div className="section-title"><h2>Running low</h2><span className="muted small">5 or fewer left</span></div>
          {s.low_stock.length === 0 ? <p className="muted">Nothing is running low.</p> : (
            <ul className="list">
              {s.low_stock.map((x) => (
                <li key={x.code}>
                  <div className="grow"><strong>{x.name}</strong> <span className="mono muted small">{x.code}</span></div>
                  <span className={`tag ${x.left_n === 0 ? 'bad' : 'warn'}`}>{x.left_n === 0 ? 'Out' : `${x.left_n} left`}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card">
          <div className="section-title"><h2>By team member</h2></div>
          {s.by_member.length === 0 ? <p className="muted">No samples given yet.</p> : (
            <ul className="list">
              {s.by_member.map((m) => (
                <li key={m.name}><span>{m.name}</span><strong className="mono">{m.n}</strong></li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  )
}
