import { useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '../supabase'
import { useAuth } from '../auth.jsx'
import { Banner, Field } from '../ui.jsx'

export default function Login() {
  const { session, loading } = useAuth()
  const nav = useNavigate()
  const [params] = useSearchParams()
  const next = params.get('next')
  const dest = next && next.startsWith('/') ? next : '/'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  if (!loading && session) return <Navigate to={dest} replace />

  async function submit(e) {
    e.preventDefault()
    setBusy(true); setErr('')
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (error) {
      setErr(/invalid/i.test(error.message)
        ? 'Email or password is not right.'
        : navigator.onLine ? error.message : 'No connection. Sign in once with internet, after that the app works offline.')
      return
    }
    nav(dest, { replace: true })
  }

  return (
    <main className="page">
      <div className="stack" style={{ marginTop: 10 }}>
        <h1>Team sign in</h1>
        <p className="muted">Sign in once on your phone. You stay signed in for the whole event.</p>
      </div>
      <form className="card stack" onSubmit={submit}>
        <Field label="Email" htmlFor="email">
          <input id="email" className="input" type="email" autoComplete="username" inputMode="email"
            value={email} onChange={(e) => setEmail(e.target.value)} required />
        </Field>
        <Field label="Password" htmlFor="pw">
          <input id="pw" className="input" type="password" autoComplete="current-password"
            value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        {err && <Banner kind="error">{err}</Banner>}
        <button className="btn primary block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  )
}
