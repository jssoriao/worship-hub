import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { XIcon } from 'lucide-react'
import { useSidebar } from '@/components/ui/sidebar'
import { embedUrl } from '../../lib/media'
import { useNowPlaying } from '../../lib/now-playing-context'
/** `left`/`top` kept so the whole window stays on screen. */
function clamp(el: HTMLElement | null, left: number, top: number) {
  const w = el?.offsetWidth ?? 320
  const h = el?.offsetHeight ?? 220
  return { left: Math.min(Math.max(0, left), Math.max(0, window.innerWidth - w)), top: Math.min(Math.max(0, top), Math.max(0, window.innerHeight - h)) }
}
/**
 * A small video window. It starts in the bottom left corner, above the play bar when a song is open, and stays
 * while you move around the page. Drag it by its title bar to put it elsewhere (it stays on screen);
 * double-click the title bar to send it back to the corner.
 */
export function MiniPlayer({ video, onClose }: { video: { id: string; title: string } | null; onClose: () => void }) {
  const { state, isMobile } = useSidebar()
  const now = useNowPlaying()
  const box = useRef<HTMLDivElement>(null)
  // null = the corner; otherwise where it was dragged to (px from the window's top left)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const grab = useRef<{ dx: number; dy: number } | null>(null)
  const moved = pos !== null
  // a smaller window must not leave it off screen
  useEffect(() => {
    if (!moved) return
    const keep = () => setPos((p) => (p ? clamp(box.current, p.left, p.top) : p))
    window.addEventListener('resize', keep)
    return () => window.removeEventListener('resize', keep)
  }, [moved])
  if (!video) return null
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button') || !box.current) return
    const r = box.current.getBoundingClientRect()
    grab.current = { dx: e.clientX - r.left, dy: e.clientY - r.top }
    // keeps the moves coming while the pointer is over the video
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (grab.current) setPos(clamp(box.current, e.clientX - grab.current.dx, e.clientY - grab.current.dy))
  }
  const onUp = () => {
    grab.current = null
  }
  const corner = isMobile ? '0.75rem' : `calc(${state === 'expanded' ? 'var(--sidebar-width)' : 'var(--sidebar-width-icon)'} + 0.75rem)`
  return (
    <div
      ref={box}
      role="group"
      aria-label={`Video: ${video.title}`}
      className={`fixed z-30 w-80 overflow-hidden rounded-xl border border-border bg-card shadow-xl shadow-black/50 ${pos ? '' : `transition-[left] duration-200 ease-linear ${now.title ? 'bottom-24 md:bottom-20' : 'bottom-3'}`}`}
      style={pos ? { left: pos.left, top: pos.top } : { left: corner }}
    >
      <div
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onDoubleClick={() => setPos(null)}
        title="Drag to move, double-click to put it back"
        className="flex cursor-grab touch-none items-center gap-2 py-1 pr-1 pl-3 select-none active:cursor-grabbing"
      >
        <p className="min-w-0 flex-1 truncate text-xs font-medium">{video.title}</p>
        <button type="button" onClick={onClose} aria-label="Close video" className="grid size-6 place-items-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground">
          <XIcon className="size-3.5" />
        </button>
      </div>
      {/* a new key per video, so choosing another one loads it from the start */}
      <iframe
        key={video.id}
        src={embedUrl(video.id)}
        title={video.title}
        className="aspect-video w-full bg-black"
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        referrerPolicy="strict-origin-when-cross-origin"
        allowFullScreen
      />
    </div>
  )
}
