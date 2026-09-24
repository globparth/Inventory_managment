import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase, configured } from './supabase'

const AuthCtx = createContext(null)
const PROFILE_KEY = 'sampledesk.profile.v1'

function cachedProfile(uid) {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null')
    return p && p.id === uid ? p : null
  } catch { return null }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(configured)

  const loadProfile = useCallback(async (s) => {
    if (!s) { setProfile(null); return }
    const { data, error } = await supabase
      .from('profiles').select('id, email, full_name, role').eq('id', s.user.id).maybeSingle()
    if (data) {
      setProfile(data)
      try { localStorage.setItem(PROFILE_KEY, JSON.stringify(data)) } catch { /* ignore */ }
    } else if (error) {
      setProfile(cachedProfile(s.user.id))          // offline: keep the role we already knew
    } else {
      setProfile({ id: s.user.id, email: s.user.email, role: 'none' })
    }
  }, [])

  useEffect(() => {
    if (!configured) return
    let alive = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return
      setSession(data.session)
      await loadProfile(data.session)
      if (alive) setLoading(false)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_evt, s) => {
      setSession(s)
      // defer: supabase-js warns against awaiting other calls inside this callback
      setTimeout(() => loadProfile(s), 0)
    })
    return () => { alive = false; sub.subscription.unsubscribe() }
  }, [loadProfile])

  const value = {
    session, profile, loading,
    isTeam: profile?.role === 'team' || profile?.role === 'admin',
    isAdmin: profile?.role === 'admin',
    signOut: async () => {
      await supabase.auth.signOut()
      try { localStorage.removeItem(PROFILE_KEY) } catch { /* ignore */ }
    },
  }
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export const useAuth = () => useContext(AuthCtx)
