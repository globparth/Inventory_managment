import { useEffect, useState } from 'react'

export function Spinner({ label }) {
  return (
    <div className="center" role="status">
      <span className="spinner" aria-hidden="true" />
      {label && <p className="muted">{label}</p>}
    </div>
  )
}

export function Banner({ kind = 'info', children }) {
  return <div className={`banner ${kind}`} role={kind === 'error' ? 'alert' : undefined}>{children}</div>
}

export function Field({ label, hint, children, htmlFor }) {
  return (
    <div className="field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <span className="hint">{hint}</span>}
    </div>
  )
}

export function useToast() {
  const [msg, setMsg] = useState('')
  useEffect(() => {
    if (!msg) return
    const t = setTimeout(() => setMsg(''), 2600)
    return () => clearTimeout(t)
  }, [msg])
  const node = msg ? <div className="toast" role="status">{msg}</div> : null
  return [setMsg, node]
}

export function Modal({ title, onClose, children }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="row spread" style={{ marginBottom: 14 }}>
          <h2>{title}</h2>
          <button className="btn ghost sm" onClick={onClose}>Close</button>
        </div>
        {children}
      </div>
    </div>
  )
}

export const pad3 = (n) => String(n).padStart(3, '0')

// One tick per sample when there are few; a plain bar when there are many.
export function Tally({ total, given }) {
  if (!total) return null
  if (total > 60) {
    return <div className="bar" aria-hidden="true"><span style={{ width: `${Math.min(100, (given / total) * 100)}%` }} /></div>
  }
  return (
    <div className="tally" aria-hidden="true">
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className={i < given ? 'on' : i === given ? 'next' : ''} />
      ))}
    </div>
  )
}
