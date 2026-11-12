/**
 * Splits a chart into pages of columns, like a book. A section stays whole when it fits in a
 * column; one taller than a column is split between lines (the rest is labelled "cont.").
 */

/** Measured heights in px of one section: its heading (0 if none) and each of its lines. */
export interface SectionSize {
  header: number
  lines: number[]
}

/** Part of a section in a column: lines [from, to). */
export interface Fragment {
  section: number
  from: number
  to: number
  /** shows the heading (first part, or "cont." on later ones) */
  header: boolean
  continued: boolean
}

export type Column = Fragment[]
export type Page = Column[]

/**
 * `height` is the room in a column, `gap` the space after each part, `columns` per page.
 * `firstHeight` is the room on the first page (under the title). Always returns at least one page.
 */
export function paginate(sizes: SectionSize[], height: number, gap: number, columns: number, firstHeight = height): Page[] {
  const pages: Page[] = []
  let page: Page = []
  let column: Column = []
  let used = 0
  const room = () => (pages.length === 0 ? firstHeight : height)

  const nextColumn = () => {
    page.push(column)
    column = []
    used = 0
    if (page.length === columns) {
      pages.push(page)
      page = []
    }
  }

  sizes.forEach((size, s) => {
    const total = size.header + size.lines.reduce((a, b) => a + b, 0)
    // a section that would fit a fresh column moves there whole instead of splitting
    if (used > 0 && used + total > room() && total <= room()) nextColumn()

    let i = 0
    let first = true
    const n = size.lines.length
    while (first || i < n) {
      let take = 0
      let h = size.header
      while (i + take < n && used + h + size.lines[i + take] <= room()) h += size.lines[i + take++]
      if (take === 0 && n > 0 && used > 0) {
        // not even one line fits under the heading here: carry on in the next column
        nextColumn()
        continue
      }
      if (take === 0 && n > 0) h += size.lines[i + take++] // a single line taller than a column
      column.push({ section: s, from: i, to: i + take, header: size.header > 0, continued: !first })
      used += h + gap
      i += take
      first = false
      if (i < n) nextColumn()
    }
  })

  if (column.length > 0) nextColumn()
  if (page.length > 0) pages.push(page)
  return pages.length > 0 ? pages : [[[]]]
}

/** The page that shows the start of `section`, or -1. */
export function pageOf(pages: Page[], section: number): number {
  return pages.findIndex((p) => p.some((c) => c.some((f) => f.section === section && !f.continued)))
}
