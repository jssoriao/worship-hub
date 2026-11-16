import { useEffect, useRef, useState, type ChangeEvent, type PointerEvent } from 'react'
/** How long the slider keeps showing where it was sent while the player gets there (a seek waits for audio). */
const LANDING_MS = 2000
/**
 * A position slider that seeks once, when it is let go (a click, a drag, a finger), or at once with the arrow keys.
 * Shared by the desktop and the phone play bars.
 *
 * - The pointer is captured, so letting go above or below the thin line, or a touch the browser cancels, still seeks.
 * - Only `input` events move it. The browser's `change` after a release can carry the OLD position (the play bar
 *   re-renders before the seek has landed), which used to send a second seek back to where the drag started.
 * - After a release it keeps showing the target until the playhead is there, so the line does not jump back.
 */
export function useSeekDrag(position: number, onSeek: (seconds: number) => void) {
  const [drag, setDrag] = useState<number | null>(null)
  // where the last release sent the player, until the playhead gets there (or LANDING_MS passes)
  const [landing, setLanding] = useState<number | null>(null)
  const dragging = useRef(false)
  const last = useRef(0)
  const moved = useRef(false)
  // arrived: drop the target during this render (React's pattern for state that follows a prop)
  if (landing !== null && Math.abs(position - landing) < 1) setLanding(null)
  useEffect(() => {
    if (landing === null) return
    // the player never got there (a failed load, the end of the song): show the playhead again
    const timer = setTimeout(() => setLanding(null), LANDING_MS)
    return () => clearTimeout(timer)
  }, [landing])
  const commit = (t: number) => {
    dragging.current = false
    setDrag(null)
    setLanding(t)
    onSeek(t)
  }
  const release = () => {
    if (!dragging.current) return
    if (moved.current) commit(last.current)
    else {
      // pressed and let go without moving it: nothing to do (seeking to the same place would only cut the sound)
      dragging.current = false
      setDrag(null)
    }
  }
  const shown = drag ?? landing ?? position
  const props = {
    onChange: (e: ChangeEvent<HTMLInputElement>) => {
      if (e.nativeEvent.type !== 'input') return
      const t = Number(e.target.value)
      last.current = t
      moved.current = true
      if (dragging.current) setDrag(t)
      else commit(t) // arrow keys
    },
    onPointerDown: (e: PointerEvent<HTMLInputElement>) => {
      dragging.current = true
      moved.current = false
      last.current = position
      setDrag(position)
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* not capturable: the release still arrives on the slider in most cases */
      }
    },
    onPointerUp: release,
    onPointerCancel: release,
    onLostPointerCapture: release,
  }
  return { shown, props }
}
