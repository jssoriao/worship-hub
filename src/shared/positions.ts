/**
 * Positions in a service: the places people serve ("Lead Vocals", "Audio") and any other part of the order
 * somebody takes ("Closing Prayer"). These are only suggestions the picker offers first; a position can be any
 * name an editor types, and nothing here is stored in the database.
 */
export const DEFAULT_POSITIONS = [
  'Lead Vocals',
  'Backing Vocals',
  'Main Keyboard',
  'Aux Keyboard',
  'Acoustic Guitar',
  'Rhythm Guitar',
  'Lead Guitar',
  'Drums',
  'Bass Guitar',
  'Audio',
  'Multimedia',
  'Livestream Audio',
  'IEM Audio',
] as const
/** The longest a person's name or a position's name may be (the same as a song title). */
export const NAME_MAX = 120
/** How many people one position may have. */
export const PEOPLE_MAX = 8
/** Same name, whatever the case or the spacing ("lead  vocals" is "Lead Vocals"). */
export const sameName = (a: string, b: string): boolean => a.trim().replace(/\s+/g, ' ').toLowerCase() === b.trim().replace(/\s+/g, ' ').toLowerCase()
