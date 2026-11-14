import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { lineKind, type Chart } from '../lib/chart'
import { paginate, pageOf, type Page } from '../lib/chart-layout'
import { SECTION_CLASS, chordDisplay, loadSong, loadView, saveSong, saveView, type Paper, type SongSettings, type ViewSettings } from '../lib/chart-view'
import { keyName, parseKey, semitonesBetween } from '../lib/chords'
import { LineView, SectionFragment, SectionHeading } from './ChartFragment'
import { ChartSettings } from './ChartSettings'

interface Props {
  chart: Chart
  /** for remembering key and capo; give the component `key={songId}` so they reload per song */
  songId: string
  title: string
  /** the song's key when the chart has no {key} (from the stems' analysis) */
  fallbackKey?: string
  /**
   * Show the chart in this key, for this view only: the song's remembered key and capo are neither used
   * nor changed. Give the component a `key` that includes it, so a new key starts the view again.
   */
  serviceKey?: string
  bpm?: number
  /** the section playing now, -1 for none */
  active: number
  onJump?: (t: number) => void
  hasCues: boolean
  follow: boolean
  onFollow: (follow: boolean) => void
  playing: boolean
  /** extra buttons in the bar (Edit) */
  actions?: ReactNode
}

/** A letter-size sheet in CSS px, laid out like printed music and scaled to the screen. */
const LETTER = { w: 816, h: 1056, pad: 48 }
const SPREAD_GAP = 24 // px between two sheets side by side
const GAP_X = 32 // between columns, in sheet px
const PAPER_MIN_WIDTH = 600 // narrower screens (phones) use the screen itself as the sheet
const FIT_STEPS = Array.from({ length: 35 }, (_, i) => Math.round((2.3 - i * 0.05) * 100) / 100) // 2.3 … 0.6

const PAPER_COLOURS: Record<Paper, CSSProperties> = {
  // chords in the church's brand colour: darkened on white paper, the light --highlight on dark paper
  light: { '--chord': 'color-mix(in oklch, var(--brand) 72%, black)', '--muted': '#64748b', '--line': '#cbd5e1', '--hover': '#f1f5f9', '--active': 'color-mix(in oklch, var(--brand) 12%, transparent)' } as CSSProperties,
  dark: { '--chord': 'var(--highlight)', '--muted': '#94a3b8', '--line': '#334155', '--hover': '#1e293b', '--active': 'color-mix(in oklch, var(--brand) 16%, transparent)' } as CSSProperties,
}

/**
 * A chart as sheet music: sheets of one or two columns, side by side when two fit, that you turn
 * like pages (swipe, the arrows, ←/→ or Page Up/Down, which page-turner pedals send). The layout
 * is fixed on the sheet and the sheet is scaled to the screen. Text size "Fit" picks the largest
 * text that shows the whole chart at once. Follow turns to the section being played.
 */
export default function ChartPages({ chart, songId, title, fallbackKey, serviceKey, bpm, active, onJump, hasCues, follow, onFollow, playing, actions }: Props) {
  const [view, setView] = useState<ViewSettings>(loadView)
  // a key given for this view moves the chart there; that and any change made here are not remembered
  const forced = useMemo(() => {
    const from = parseKey(chart.key || fallbackKey || '')
    const to = serviceKey ? parseKey(serviceKey) : null
    return from && to ? semitonesBetween(from, to) : null
  }, [chart.key, fallbackKey, serviceKey])
  const [song, setSong] = useState<SongSettings>(() => (forced !== null ? { transpose: forced, capo: 0 } : loadSong(songId)))
  useEffect(() => saveView(view), [view])
  useEffect(() => {
    if (forced === null) saveSong(songId, song)
  }, [songId, song, forced])

  const display = useMemo(() => chordDisplay(chart.key || fallbackKey || '', song, view), [chart.key, fallbackKey, song, view])
  const { show } = display
  const meta = [
    chart.artist,
    display.sounding && `Key ${keyName(display.sounding)}`,
    song.capo > 0 && display.shapes && `Capo ${song.capo} (${keyName(display.shapes)} shapes)`,
    bpm && `${Math.round(bpm)} BPM`,
  ]
    .filter(Boolean)
    .join(' · ')
  const heading = chart.title || title

  // ------------------------------------------------------------ room on screen
  const root = useRef<HTMLDivElement>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const measurer = useRef<HTMLDivElement>(null)
  const [full, setFull] = useState(false)
  const [rootHeight, setRootHeight] = useState<number | undefined>(undefined)
  const [frame, setFrame] = useState({ w: 0, h: 0 })

  // not full screen: fill the window from where the viewer starts
  useLayoutEffect(() => {
    if (full) return
    const fit = () => {
      const el = root.current
      if (!el) return
      const top = el.getBoundingClientRect().top + window.scrollY
      setRootHeight(Math.max(360, window.innerHeight - top - 8))
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [full])

  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(() => setFrame({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ------------------------------------------------------------ the sheet and its scale
  const paperMode = frame.w >= PAPER_MIN_WIDTH
  const sheet = paperMode ? LETTER : { w: frame.w, h: frame.h, pad: 6 }
  const byHeight = frame.h / sheet.h
  // as many sheets side by side as fit at full height (a wide, short screen shows up to three)
  const perView = paperMode ? Math.min(3, Math.max(1, Math.floor((frame.w + SPREAD_GAP) / (sheet.w * byHeight + SPREAD_GAP)))) : 1
  const scale = paperMode ? Math.min(byHeight, (frame.w - SPREAD_GAP * (perView - 1)) / (perView * sheet.w)) : 1
  const contentW = sheet.w - 2 * sheet.pad
  const contentH = sheet.h - 2 * sheet.pad
  const colWidthFor = useCallback((n: number) => Math.max(100, Math.floor((contentW - GAP_X * (n - 1)) / n)), [contentW])
  const basePx = paperMode ? 14 : 16

  // ------------------------------------------------------------ layout: measure, then fill sheets
  const [layout, setLayout] = useState<{ pages: Page[]; text: number; titleH: number; columns: number }>({ pages: [[[]]], text: 1, titleH: 0, columns: 1 })
  useLayoutEffect(() => {
    const el = measurer.current
    const body = el?.querySelector<HTMLElement>('[data-body]')
    if (!el || !body || frame.h === 0 || contentH <= 0) return
    const height = (q: string) => el.querySelector<HTMLElement>(q)?.getBoundingClientRect().height ?? 0
    const measure = (text: number) => {
      const px = basePx * text
      el.style.fontSize = `${px}px`
      // two columns only while a column still holds a normal line (about 24 em)
      const columns = view.columns === 'auto' ? (colWidthFor(2) / px >= 24 ? 2 : 1) : view.columns
      body.style.width = `${colWidthFor(columns)}px`
      // how tall a line is when it does not wrap, per kind
      const single = { cl: height('[data-ref=cl]'), c: height('[data-ref=c]'), l: height('[data-ref=l]') }
      let wraps = 0
      const sizes = [...body.querySelectorAll<HTMLElement>('[data-s]')].map((s) => ({
        header: s.querySelector<HTMLElement>('[data-h]')?.getBoundingClientRect().height ?? 0,
        lines: [...s.querySelectorAll<HTMLElement>('[data-l]')].map((l) => {
          const h = l.getBoundingClientRect().height
          if (h > single[(l.dataset.l as 'cl' | 'c' | 'l') || 'cl'] * 1.4) wraps++
          return h
        }),
      }))
      const titleH = height('[data-title]')
      const gap = Math.round(px * 0.8)
      return { pages: paginate(sizes, contentH - 2, gap, columns, contentH - titleH - 2), text, titleH, columns, wraps }
    }
    if (view.scale !== 'fit') {
      setLayout(measure(view.scale))
      return
    }
    // Fit: the largest text that shows the whole chart in the sheets on screen with no wrapped
    // lines, as long as it stays readable
    const shownPx = (step: number) => basePx * step * scale
    const readable = (step: number) => (paperMode ? shownPx(step) >= 9 : step >= 0.9)
    for (const step of FIT_STEPS) {
      if (!readable(step)) break
      const l = measure(step)
      if (l.wraps === 0 && l.pages.length <= perView) return setLayout(l)
    }
    // too long to show at once: the largest comfortable size without wrapped lines, over more sheets
    for (const step of FIT_STEPS) {
      if (!readable(step)) break
      if (paperMode ? shownPx(step) > 15 : step > 1) continue
      const l = measure(step)
      if (l.wraps === 0) return setLayout(l)
    }
    setLayout(measure(paperMode ? Math.max(0.6, 12 / (basePx * scale)) : 1))
  }, [chart, show, heading, meta, colWidthFor, contentH, basePx, view.scale, view.columns, paperMode, scale, perView, frame.h])

  const { pages, text, titleH, columns } = layout
  const fontPx = basePx * text
  const gapY = Math.round(fontPx * 0.8)
  const views = useMemo(() => {
    const out: number[][] = []
    for (let p = 0; p < pages.length; p += perView) out.push(Array.from({ length: Math.min(perView, pages.length - p) }, (_, i) => p + i))
    return out
  }, [pages.length, perView])

  // ------------------------------------------------------------ turning pages (by view: one sheet or a spread)
  const [at, setAt] = useState(0)
  const count = views.length
  const goTo = useCallback(
    (v: number, smooth = true) => {
      const el = scroller.current
      if (!el) return
      const target = Math.min(Math.max(v, 0), count - 1)
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      el.scrollTo({ left: target * el.clientWidth, behavior: smooth && !reduce ? 'smooth' : 'auto' })
      setAt(target)
    },
    [count],
  )
  useEffect(() => {
    if (at > count - 1) goTo(count - 1, false)
  }, [count, at, goTo])

  const onScroll = () => {
    const el = scroller.current
    if (el && el.clientWidth > 0) setAt(Math.round(el.scrollLeft / el.clientWidth))
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) && t.getAttribute('type') !== 'checkbox') return
      if (e.altKey || e.ctrlKey || e.metaKey) return
      if (e.key === 'ArrowRight' || e.key === 'PageDown') {
        e.preventDefault()
        goTo(at + 1)
      } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault()
        goTo(at - 1)
      } else if (e.key === 'Escape' && full) {
        void leaveFull()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // follow the song: turn to the sheet with the section being played (not when turned by hand)
  useEffect(() => {
    if (!follow || !playing || active < 0) return
    const p = pageOf(pages, active)
    if (p >= 0 && Math.floor(p / perView) !== at) goTo(Math.floor(p / perView))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, follow, playing, pages, perView])

  // ------------------------------------------------------------ full screen
  const enterFull = async () => {
    setFull(true)
    try {
      await document.documentElement.requestFullscreen?.({ navigationUI: 'hide' })
    } catch {
      // not allowed (iPhone): the viewer still covers the app
    }
  }
  const leaveFull = async () => {
    setFull(false)
    if (document.fullscreenElement) await document.exitFullscreen().catch(() => {})
  }
  useEffect(() => {
    const onChange = () => {
      if (!document.fullscreenElement) setFull(false)
    }
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  // ------------------------------------------------------------ view
  const small =
    'rounded-full border border-input px-3 py-1.5 text-sm outline-none hover:bg-card focus-visible:ring-2 focus-visible:ring-ring'
  const light = view.paper === 'light'
  const sheetLook = paperMode
    ? light
      ? 'bg-white text-slate-900 shadow-lg shadow-black/40'
      : 'bg-card text-foreground ring-1 ring-slate-800'
    : light
      ? 'bg-white text-slate-900 rounded-lg'
      : 'text-foreground'
  const shown = views[at] ?? [0]
  const pageLabel = `${shown[0] + 1}${shown.length > 1 ? `–${shown[shown.length - 1] + 1}` : ''} / ${pages.length}`

  const titleBlock = (
    <header className="pb-[0.6em]">
      <h2 className="text-[1.5em] font-bold leading-tight">{heading}</h2>
      {meta && <p className="text-[0.8em] font-semibold text-(--muted)">{meta}</p>}
    </header>
  )

  return (
    <div
      ref={root}
      className={full ? 'fixed inset-0 z-40 flex flex-col bg-background px-3 pb-2 pt-2' : 'flex flex-col'}
      style={full ? undefined : { height: rootHeight }}
    >
      <div className="flex flex-wrap items-center justify-end gap-2 pb-2">
        <p className="mr-auto min-w-0 truncate text-sm text-muted-foreground">{full ? heading : meta}</p>
        {hasCues && (
          <button type="button" aria-pressed={follow} onClick={() => onFollow(!follow)} className={`${small} ${follow ? 'border-highlight/70 text-highlight' : ''}`} title="Turn to the section being played">
            Follow
          </button>
        )}
        <ChartSettings fitScale={text} view={view} song={song} original={display.original} onView={setView} onSong={setSong} />
        {!full && actions}
        <button type="button" onClick={() => void (full ? leaveFull() : enterFull())} className={small} aria-pressed={full}>
          {full ? 'Exit full screen' : 'Full screen'}
        </button>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div
          ref={scroller}
          onScroll={onScroll}
          className="flex h-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {views.map((sheets, v) => (
            <div key={v} className="flex h-full w-full shrink-0 snap-start snap-always items-start justify-center" style={{ gap: SPREAD_GAP }}>
              {sheets.map((p) => (
                <div key={p} className="relative shrink-0" style={{ width: sheet.w * scale, height: sheet.h * scale }}>
                  <div
                    role="group"
                    aria-label={`Page ${p + 1} of ${pages.length}`}
                    className={`absolute left-0 top-0 origin-top-left ${sheetLook}`}
                    style={{ width: sheet.w, height: sheet.h, padding: sheet.pad, fontSize: fontPx, transform: `scale(${scale})`, ...PAPER_COLOURS[view.paper] }}
                  >
                    {p === 0 && titleBlock}
                    <div
                      className="grid"
                      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, columnGap: GAP_X, height: p === 0 ? contentH - titleH : contentH }}
                    >
                      {Array.from({ length: columns }, (_, c) => (
                        <div key={c} className="flex min-w-0 flex-col overflow-hidden" style={{ gap: gapY }}>
                          {(pages[p][c] ?? []).map((f) => (
                            <SectionFragment
                              key={`${f.section}:${f.from}`}
                              section={chart.sections[f.section]}
                              from={f.from}
                              to={f.to}
                              header={f.header}
                              continued={f.continued}
                              show={show}
                              active={f.section === active}
                              onJump={onJump}
                            />
                          ))}
                        </div>
                      ))}
                    </div>
                    {paperMode && pages.length > 1 && (
                      <p className="absolute inset-x-0 text-center text-[0.7em] text-(--muted)" style={{ bottom: sheet.pad / 2 }}>
                        {p + 1} / {pages.length}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* the same title and sections at column width, unseen, to measure how tall each part is */}
        <div ref={measurer} aria-hidden="true" className="pointer-events-none invisible absolute left-0 top-0">
          <div data-title="" style={{ width: contentW }}>
            {titleBlock}
          </div>
          <div data-body="">
            <div data-ref="cl">
              <LineView line={[{ chord: 'A', text: 'Word' }]} show={show} />
            </div>
            <div data-ref="c">
              <LineView line={[{ chord: 'A', text: '' }]} show={show} />
            </div>
            <div data-ref="l">
              <LineView line={[{ chord: '', text: 'Word' }]} show={show} />
            </div>
            {chart.sections.map((section, s) => (
              <section key={s} data-s="" className={SECTION_CLASS}>
                <div data-h="">
                  <SectionHeading section={section} continued={false} onJump={onJump} />
                </div>
                {section.lines.map((line, j) => (
                  <div key={j} data-l={lineKind(line)}>
                    <LineView line={line} show={show} />
                  </div>
                ))}
              </section>
            ))}
          </div>
        </div>
      </div>

      {/* always takes its room, so showing it never shrinks the sheets (which could change the pages again) */}
      {(
        <nav aria-label="Pages" aria-hidden={count <= 1 || undefined} className={`mt-1 flex items-center justify-center gap-3 text-sm text-muted-foreground ${count > 1 ? '' : 'invisible'}`}>
          <button type="button" aria-label="Previous page" disabled={at === 0} onClick={() => goTo(at - 1)} className="h-9 w-9 rounded-full border border-input outline-none hover:bg-card focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30">
            ‹
          </button>
          <span aria-live="polite" className="tabular-nums">
            {pageLabel}
          </span>
          <button type="button" aria-label="Next page" disabled={at >= count - 1} onClick={() => goTo(at + 1)} className="h-9 w-9 rounded-full border border-input outline-none hover:bg-card focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30">
            ›
          </button>
        </nav>
      )}
    </div>
  )
}
