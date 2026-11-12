# Arrangements

Your own version of a song, made from its stems: a different order of sections, repeats, a simpler
mix per section, another key or tempo, and parts of your own (MIDI). Built for a vocal lead who wants
a Sunday backing track arranged their way, not the recording's.

Order of work: 1 arranger (done), 2 key and tempo, 3 a guide to play along to in a DAW, 4 importing
your own recorded stems. MIDI in the app is later, if at all.

An arrangement is a recipe. It never changes the audio files: the app plays the recipe live, and
can render it to a file when one is needed.

## Where it lives

- A page of its own: **Home · Practice · Charts · Arrange** (`/arrange`). Practice keeps playing the
  original stems; Charts is unchanged.
- Arrange has its own player (a second `StemEngine`). Playing in Arrange pauses Practice. Leaving
  the page stops it (only Practice stays mounted across pages).
- Later: Charts follows a playing arrangement (order and key); Practice can pick an arrangement.

## Model

```ts
interface Arrangement {
  id: string            // random, URL-safe
  song: string          // song id (the song row in Neon)
  name: string          // "Sunday 17 Nov"
  owner: string         // user id; the owner or anyone with arrangement:manage (editor and up) may change it
  updated: string       // ISO time
  sections: { id: string; label: string; start: number; end: number }[] // seconds in the recording
  blocks: { id: string; section: string; muted: string[] }[]          // the order; muted = stem ids
  countIn: number       // bars of click before the first block (0–2)
  // phase 2: key: number (semitones), tempo: number (ratio)
  // phase 4: own: { id, name, file }[] (audio on the arrangement timeline)
}
```

- Sections come from the chart's `{cue}` times when the song has them, snapped to the nearest
  downbeat of the beat grid; otherwise from `music.sections` in the manifest, suggested at publish
  time from the stems (`src/cli/lib/sections.ts`) or set in `song.json`; otherwise the whole song. They can be split at the
  playhead (snapped to a downbeat), renamed, and joined back.
- A block plays one section. Repeating a chorus is two blocks. A block mutes stems at the level the
  Practice page shows them (a combined stem such as Drums, or a stem on its own).
- Storage: the Neon `arrangements` table (`id, song_id, owner_id, name, data jsonb`), through the Worker at
  `/songs/<songId>/arrangements/[<id>.json]` (same URLs as before). Scoped to the church through its
  song. Any member can make their own (`arrangement:create`); only its owner or someone with
  `arrangement:manage` can change or delete one.

## Playback

`StemEngine` gets a timeline mode: a list of segments `{ src, end, at, gains }` mapping
arrangement time to recording time. Each 8 s chunk that a segment covers is scheduled as its own
source, cut to the segment, through a gain node for that segment's mutes. Within a segment chunks
join sample-exactly as before; between segments that are not contiguous in the recording, or where
the mutes change, there is a 10 ms fade out and in. Repeats reuse the decoded chunks. The click is
mapped through the same segments, and a count-in plays clicks before the first block. Practice keeps
the plain mode (no timeline).

## Key and tempo (phase 2)

- Tempo: every stem plays at `playbackRate = tempo` (which also shifts pitch by 12·log2(tempo)).
- Key: one pitch shifter on the summed stems (AudioWorklet, Signalsmith Stretch, MIT) undoes the
  tempo's pitch change and adds the key change. One shifter for all stems keeps it light on phones.
- MIDI parts and the click do not go through the shifter: they are played in the new key and tempo.
- Good range: tempo about ±15%, key about ±3 semitones before it sounds processed.
- To check first: a ready web build of Signalsmith Stretch, or compile it to WASM ourselves.

## Guide for a DAW (phase 3)

Your own parts are played and recorded in a DAW (Ableton Live Lite with Sunday Keys or Analog Lab,
from a Roland FP-10), not in the browser: browsers cannot host VST/AU plugins. Arrange exports the
arrangement as a guide to play along to: one mixdown file and a click track, both starting at bar 1,
in the arrangement's key and tempo, with the BPM shown. Rendered on the device (OfflineAudioContext,
then the shifter offline).

## Own stems (phase 4)

Import the bounced audio (WAV/MP3) as a stem of the arrangement. It lives on the arrangement's
timeline from its start (it was played to that order), uploaded to R2 next to the arrangement, and
behaves like the other stems: volume, mute, and per-block mutes. Your "Piano (mine)" sits next to the
recording's piano, so either can be muted. Drums and guitars usually stay the recording's stems. If
the order of an arrangement with own stems is changed, Arrange warns that those stems no longer
follow it.

## Later

- MIDI in the app (piano roll, a part from the chart's chords, `.mid` import/export, a MIDI keyboard
  through Web MIDI in desktop Chrome), only if the DAW route is not enough. Ableton exports MIDI
  clips without locators, so parts would be placed by bars of the beat grid, not by markers.
- A mixdown export of the finished arrangement (with own stems) for Sunday, and a stage mode (vamp
  until cued, next-section cue). Recording audio in the browser.

