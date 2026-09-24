import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth.jsx'
import { configured } from './supabase'
import { refreshCatalog, syncQueue, useQueue } from './offline'
import { useOnline } from './useOnline'
import { Spinner } from './ui.jsx'
import Home from './pages/Home.jsx'
import Login from './pages/Login.jsx'
import Scan from './pages/Scan.jsx'

const Admin = lazy(() => import('./pages/admin/index.jsx'))

function TopBar() {
  const { profile, isTeam, isAdmin, signOut } = useAuth()
  const queue = useQueue()
  const online = useOnline()
  const pending = queue.filter((q) => !q.failed).length
  const failed = queue.filter((q) => q.failed).length

  return (
    <header className="topbar">
      <Link to="/" className="brand" aria-label="Home">
        <span className="brand-mark" aria-hidden="true">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12l5 5L20 6" /></svg>
        </span>
        Sample Desk
      </Link>
      <span className="spacer" />
      {isTeam && !online && <span className="pill off">Offline</span>}
      {isTeam && (pending > 0 || failed > 0) && (
        <Link to="/" className="pill warn">{failed ? `${failed} need attention` : `${pending} waiting to sync`}</Link>
      )}
      {isAdmin && <Link to="/admin" className="pill">Admin</Link>}
      {profile && <button className="pill" onClick={signOut}>Sign out</button>}
    </header>
  )
}

function Background() {
  const { isTeam, session } = useAuth()
  useEffect(() => {
    if (!isTeam || !session) return
    const tick = () => { if (navigator.onLine) syncQueue() }
    tick()
    refreshCatalog()
    const a = setInterval(tick, 15000)
    const b = setInterval(() => navigator.onLine && refreshCatalog(), 10 * 60 * 1000)
    const onVis = () => document.visibilityState === 'visible' && tick()
    window.addEventListener('online', tick)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      clearInterval(a); clearInterval(b)
      window.removeEventListener('online', tick)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [isTeam, session])
  return null
}

function RequireTeam({ children }) {
  const { session, loading } = useAuth()
  const loc = useLocation()
  if (loading) return <Spinner />
  if (!session) return <Navigate to={`/login?next=${encodeURIComponent(loc.pathname)}`} replace />
  return children
}

function SetupNeeded() {
  return (
    <main className="page">
      <h1>Almost there</h1>
      <div className="banner warn">
        This app is not connected to a database yet. Add <b className="mono">VITE_SUPABASE_URL</b> and{' '}
        <b className="mono">VITE_SUPABASE_ANON_KEY</b> in your hosting settings (or in a <b className="mono">.env</b> file
        when running locally), then redeploy. The README has the steps.
      </div>
    </main>
  )
}

function NotFound() {
  return (
    <main className="page">
      <div className="center">
        <h1>Page not found</h1>
        <Link className="btn primary" to="/">Go to start</Link>
      </div>
    </main>
  )
}

export default function App() {
  if (!configured) return <SetupNeeded />
  return (
    <BrowserRouter>
      <AuthProvider>
        <Background />
        <TopBar />
        <Routes>
          <Route path="/" element={<RequireTeam><Home /></RequireTeam>} />
          <Route path="/login" element={<Login />} />
          <Route path="/p/:code" element={<Scan />} />
          <Route path="/admin/*" element={<Suspense fallback={<Spinner />}><Admin /></Suspense>} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
