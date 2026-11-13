import { Button } from '@/components/ui/button'
import { NativeSelect } from '@/components/ui/native-select'
import { useMemo, useRef, useState } from 'react'
import ChartView from './ChartView'
import type { ChordLevel } from '../lib/analysis'
import { parseChart } from '../lib/chart'
import { useNowPlaying } from '../lib/now-playing-context'

/** Shown for a song with no chart yet. */
export const TEMPLATE = `{title: }
{artist: }
{key: }

{comment: Intro}
[C] [G] [Am] [F]

{start_of_verse: Verse 1}
[C]Lyrics with [G]chords in brackets
{end_of_verse}

{start_of_chorus: Chorus}
[F]Lyrics with [C]chords in brackets
{end_of_chorus}
`

interface Props {
  initial: string
  /** is this song loaded on the Practice page, so "Mark cue" has a playhead to read */
  syncing: boolean
  onSave: (text: string) => Promise<void>
  onCancel: () => void
  /** a chart made from the song's analysis; absent when the song has none */
  build?: (level: ChordLevel, quickChords: boolean) => string
  /** open with a chart built from the analysis instead of `initial` (still to be saved) */
  startBuilt?: boolean
}

const LEVELS: [ChordLevel, string][] = [
  ['basic', 'Basic chords'],
  ['simple', 'Simple chords'],
  ['complex', 'Full chords'],
]

/** ChordPro text on one side, how it will look on the other. */
export default function ChartEditor({ initial, syncing, onSave, onCancel, build, startBuilt }: Props) {
  const { getTransport } = useNowPlaying()
  const [level, setLevel] = useState<ChordLevel>('simple')
  const [quick, setQuick] = useState(false)
  const [text, setText] = useState(() => (startBuilt && build ? build('simple', false) : initial))
  // the text the last build made: replacing it again needs no confirmation
  const [built, setBuilt] = useState(() => (startBuilt && build ? text : null))
  const [confirming, setConfirming] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const area = useRef<HTMLTextAreaElement>(null)
  const chart = useMemo(() => parseChart(text), [text])
  const dirty = text !== initial

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      await onSave(text)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSaving(false)
    }
  }

  /** Puts `{cue: m:ss.s}` on its own line at the cursor, from where the song is now. */
  const markCue = () => {
    const el = area.current
    const t = getTransport()?.position()
    if (!el || t === undefined) return
    const m = Math.floor(t / 60)
    const s = (t - m * 60).toFixed(1).padStart(4, '0')
    const at = el.selectionStart
    const before = text.slice(0, at)
    const lead = before === '' || before.endsWith('\n') ? '' : '\n'
    const insert = `${lead}{cue: ${m}:${s}}\n`
    setText(before + insert + text.slice(el.selectionEnd))
    requestAnimationFrame(() => {
      el.focus()
      el.setSelectionRange(at + insert.length, at + insert.length)
    })
  }

  /** Replaces the text with a chart built from the analysis, after a confirmation if that would lose typed text. */
  const rebuild = (force = false) => {
    if (!build) return
    const blank = text.trim() === '' || text === TEMPLATE || text === built
    if (!force && !blank) return setConfirming(true)
    const next = build(level, quick)
    setText(next)
    setBuilt(next)
    setConfirming(false)
  }

  return (
    <div className="mt-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button  onClick={() => void save()} disabled={saving || !dirty}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          {dirty ? 'Discard' : 'Close'}
        </Button>
        <Button variant="outline" onClick={markCue} disabled={!syncing} title="Insert the current playback time as a cue at the cursor">
          Mark cue
        </Button>
        {!syncing && <span className="text-xs text-muted-foreground">Play this song on the Practice page to mark cues.</span>}
        {build && (
          <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
            <NativeSelect aria-label="Chords to write" value={level} onChange={(e) => setLevel(e.target.value as ChordLevel)} disabled={saving}>
              {LEVELS.map(([value, name]) => (
                <option key={value} value={value}>
                  {name}
                </option>
              ))}
            </NativeSelect>
            <label className="flex items-center gap-2 text-sm text-muted-foreground" title="Passing chords shorter than about a beat and a half">
              <input type="checkbox" checked={quick} onChange={(e) => setQuick(e.target.checked)} disabled={saving} className="size-4 accent-primary" />
              Quick chords
            </label>
            <Button variant="outline" onClick={() => rebuild()} disabled={saving || confirming} title="Write the chart from the song's analysis: sections, lyrics and chords">
              {built === null && initial === TEMPLATE ? 'Build from analysis' : 'Rebuild from analysis'}
            </Button>
          </div>
        )}
      </div>
      {confirming && (
        <div role="alertdialog" aria-labelledby="rebuild-question" className="mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-input bg-card p-3 text-sm">
          <p id="rebuild-question" className="min-w-0 flex-1">
            Replace everything in the editor with a chart built from the analysis? The saved chart changes only when you save.
          </p>
          <div className="flex shrink-0 gap-2">
            <Button size="sm" onClick={() => rebuild(true)} autoFocus>
              Replace
            </Button>
            <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>
              Keep
            </Button>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-300">
          Could not save: {error}
        </p>
      )}
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <div>
          <label htmlFor="chart-text" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            ChordPro
          </label>
          <textarea
            id="chart-text"
            ref={area}
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            className="mt-1 h-[28rem] w-full resize-y rounded-xl border border-input bg-background p-3 font-mono text-sm leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-ring md:h-[70vh]"
          />
        </div>
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Preview</h2>
          <div className="mt-1 md:max-h-[70vh] md:overflow-y-auto">
            <h3 className="text-lg font-semibold">{chart.title}</h3>
            <p className="mb-3 text-sm text-muted-foreground">{[chart.artist, chart.key && `Key of ${chart.key}`].filter(Boolean).join(' · ')}</p>
            <ChartView chart={chart} />
          </div>
        </div>
      </div>
    </div>
  )
}
