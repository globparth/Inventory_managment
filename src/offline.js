// Offline safety net for the team phones.
//  - Samples that could not be sent (bad Wi-Fi) wait in a queue on the phone and sync later.
//  - Every entry carries a client_id, so a retry can never create a double entry on the server.
//  - A small product list is cached so a scan still shows the product name with no signal.
import { useSyncExternalStore } from 'react'
import { supabase } from './supabase'

const QUEUE_KEY = 'sampledesk.queue.v1'
const CATALOG_KEY = 'sampledesk.catalog.v1'
const EVT = 'sampledesk:queue'

/* ---------- queue ---------- */
function readQueue() {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]') } catch { return [] }
}
let snapshot = readQueue()
function writeQueue(items) {
  snapshot = items
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(items)) } catch { /* storage full or blocked */ }
  window.dispatchEvent(new Event(EVT))
}
export function getQueue() { return snapshot }
function subscribe(cb) {
  window.addEventListener(EVT, cb)
  return () => window.removeEventListener(EVT, cb)
}
export function useQueue() {
  return useSyncExternalStore(subscribe, getQueue, getQueue)
}
export function dismissQueued(clientId) {
  writeQueue(snapshot.filter((q) => q.client_id !== clientId))
}

/* ---------- errors ---------- */
// True when the problem is the connection (or an expired login), not the data: safe to retry later.
export function isRetryable(error, status) {
  if (!error) return false
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  if (!status) return true
  return status === 401 || status === 408 || status === 429 || status >= 500
}

/* ---------- giving a sample ---------- */
function toRpcArgs(p) {
  return {
    p_code: p.code, p_name: p.name, p_phone: p.phone || null, p_email: p.email || null,
    p_company: p.company || null, p_notes: p.notes || null,
    p_client_id: p.client_id, p_given_at: p.given_at || null,
  }
}

/** Returns {state:'done', data} | {state:'queued'} | {state:'rejected', message} */
export async function submitSample(payload) {
  const item = { ...payload, given_at: payload.given_at || new Date().toISOString() }
  const { data, error, status } = await supabase.rpc('give_sample', toRpcArgs(item))
  if (error) {
    if (isRetryable(error, status)) {
      writeQueue([...snapshot, { ...item, queued_at: item.given_at }])
      return { state: 'queued' }
    }
    return { state: 'rejected', message: error.message }
  }
  if (data?.ok) return { state: 'done', data }
  return { state: 'rejected', message: data?.error || 'Could not save this sample' }
}

/* ---------- syncing ---------- */
let syncing = false
export async function syncQueue() {
  if (syncing) return { sent: 0 }
  syncing = true
  let sent = 0
  try {
    for (const item of [...snapshot]) {
      if (item.failed) continue
      const { data, error, status } = await supabase.rpc('give_sample', toRpcArgs(item))
      if (error) {
        if (isRetryable(error, status)) break          // still offline: try again later
        markFailed(item.client_id, error.message)
      } else if (data?.ok) {
        writeQueue(snapshot.filter((q) => q.client_id !== item.client_id))
        sent++
      } else {
        markFailed(item.client_id, data?.error || 'Rejected by the server')
      }
    }
  } finally {
    syncing = false
  }
  return { sent }
}
function markFailed(clientId, message) {
  writeQueue(snapshot.map((q) => (q.client_id === clientId ? { ...q, failed: true, error: message } : q)))
}

/* ---------- product list cache ---------- */
export async function refreshCatalog() {
  const { data, error } = await supabase.rpc('get_catalog')
  if (error || !Array.isArray(data)) return false
  const items = {}
  for (const [code, name, category, description] of data) items[code] = [name, category, description]
  try { localStorage.setItem(CATALOG_KEY, JSON.stringify({ ts: Date.now(), items })) } catch { /* ignore */ }
  return true
}
export function lookupCached(code) {
  try {
    const c = JSON.parse(localStorage.getItem(CATALOG_KEY) || 'null')
    const hit = c?.items?.[code]
    return hit ? { name: hit[0], category: hit[1], description: hit[2] } : null
  } catch { return null }
}
export function catalogAge() {
  try { return JSON.parse(localStorage.getItem(CATALOG_KEY) || 'null')?.ts || null } catch { return null }
}

// Products to pick from when claiming a blank QR code: the imported catalog
// plus any product already in use on a printed code. Falls back to whatever
// was last cached for offline use if the picker call itself fails.
export async function distinctProducts() {
  const { data, error } = await supabase.rpc('get_product_picker')
  if (!error && Array.isArray(data)) {
    return data.map((item) => ({ name: item.name, category: item.category || '', description: item.description || '' }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }
  const rows = Object.values(JSON.parse(localStorage.getItem(CATALOG_KEY) || 'null')?.items || {})
  const seen = new Map()
  for (const [name, category, description] of rows) {
    if (name && !seen.has(name)) seen.set(name, { name, category: category || '', description: description || '' })
  }
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name))
}
