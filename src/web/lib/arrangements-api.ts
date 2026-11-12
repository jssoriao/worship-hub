/** Saving and loading arrangements through the Worker. */
import { SONGS_BASE_URL } from '../config'
import { checkArrangement, type Arrangement } from './arrangement'

export interface ArrangementInfo {
  id: string
  name: string
  owner: string
  ownerName: string
  updated: string
}

const base = (song: string) => `${SONGS_BASE_URL}/${encodeURIComponent(song)}/arrangements/`

async function ok(r: Response): Promise<Response> {
  if (r.ok) return r
  const why = r.status === 403 ? 'only its owner or an editor can change it' : (await r.text().catch(() => '')) || `HTTP ${r.status}`
  throw new Error(why)
}

export async function listArrangements(song: string): Promise<ArrangementInfo[]> {
  const r = await ok(await fetch(base(song), { cache: 'no-store' }))
  const list = (await r.json()) as ArrangementInfo[]
  return Array.isArray(list) ? list : []
}

export async function loadArrangement(song: string, id: string): Promise<Arrangement> {
  const r = await ok(await fetch(`${base(song)}${encodeURIComponent(id)}.json`, { cache: 'no-store' }))
  const a = checkArrangement(await r.json())
  if (!a) throw new Error('This arrangement could not be read.')
  return a
}

/** Saves and returns the stored copy (with its owner and time). */
export async function saveArrangement(a: Arrangement): Promise<Arrangement> {
  const r = await ok(
    await fetch(`${base(a.song)}${encodeURIComponent(a.id)}.json`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(a),
    }),
  )
  return checkArrangement(await r.json()) ?? a
}

export async function deleteArrangement(song: string, id: string): Promise<void> {
  await ok(await fetch(`${base(song)}${encodeURIComponent(id)}.json`, { method: 'DELETE' }))
}
