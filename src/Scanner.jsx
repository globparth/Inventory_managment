import { useEffect, useRef, useState } from 'react'
import jsQR from 'jsqr'

// Camera QR scanner. Works on iPhone Safari and Android Chrome (needs https).
export default function Scanner({ onCode, onCancel }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const cbRef = useRef(onCode)
  cbRef.current = onCode
  const [error, setError] = useState('')

  useEffect(() => {
    let stream, raf, stopped = false, last = 0
    const video = videoRef.current
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d', { willReadFrequently: true })

    function tick(ts) {
      if (stopped) return
      raf = requestAnimationFrame(tick)
      if (ts - last < 100 || video.readyState !== video.HAVE_ENOUGH_DATA) return
      last = ts
      const scale = Math.min(1, 720 / Math.max(video.videoWidth, video.videoHeight))
      const w = Math.round(video.videoWidth * scale)
      const h = Math.round(video.videoHeight * scale)
      canvas.width = w; canvas.height = h
      ctx.drawImage(video, 0, 0, w, h)
      const img = ctx.getImageData(0, 0, w, h)
      const res = jsQR(img.data, w, h, { inversionAttempts: 'dontInvert' })
      if (res?.data) {
        stopped = true
        if (navigator.vibrate) navigator.vibrate(60)
        cbRef.current(res.data)
      }
    }

    ;(async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }, audio: false,
        })
        if (stopped) { stream.getTracks().forEach((t) => t.stop()); return }
        video.srcObject = stream
        await video.play()
        raf = requestAnimationFrame(tick)
      } catch (e) {
        setError(e?.name === 'NotAllowedError'
          ? 'Camera permission is blocked. Allow the camera for this site in your browser settings, or scan with your phone’s normal camera app.'
          : 'Could not start the camera. Scan with your phone’s normal camera app instead, or type the code below.')
      }
    })()

    return () => {
      stopped = true
      cancelAnimationFrame(raf)
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  return (
    <div className="stack">
      <div className="scanner">
        <video ref={videoRef} playsInline muted />
        <div className="frame" />
        <canvas ref={canvasRef} hidden />
      </div>
      {error && <div className="banner error">{error}</div>}
      <button className="btn ghost block" onClick={onCancel}>Stop camera</button>
    </div>
  )
}
