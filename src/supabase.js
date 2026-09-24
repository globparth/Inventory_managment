import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const configured = Boolean(url && key)

// A placeholder client keeps the app from crashing so we can show a setup message instead.
export const supabase = createClient(url || 'http://localhost:54321', key || 'not-configured', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
})

export const ORG_NAME = import.meta.env.VITE_ORG_NAME || 'Globriddge International'
export const PUBLIC_CONTACT = import.meta.env.VITE_PUBLIC_CONTACT || ''
export const PUBLIC_BASE_URL = (import.meta.env.VITE_PUBLIC_BASE_URL || '').replace(/\/+$/, '')
