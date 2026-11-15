# Worship Hub: UI rules (both layouts)

One look and one way of doing each thing, on every page. Read this before adding or changing any screen. The phone
and tablet specifics are in `mobile.md`.

## Build once, reuse
- Layers: tokens (`src/web/index.css`: colours, `bg-app`, `surface-glass`, `bg-brand-gradient`) then primitives
  (`components/ui/`, shadcn adapted to our look) then shared app parts (`components/`: `PageHeader`, `Hint`, `SongPicker`,
  `Popover`, ...) then pages. Pages only compose.
- Anything used on two or more pages is a shared part, designed once. A page never restyles a shared part or hand-makes
  a button, a hint, a header or a panel that a shared part already covers: if it does not fit, change the part.
- A new control starts as a shared part when it could appear twice. When a new look is needed, make it a variant of the
  part (size, tone), with the same behaviour everywhere.
- Mobile and desktop share the same parts where they can (a part may take its size from the layout). Two components only
  when the structure really differs.

## Behaviour that is the same everywhere
- Header: every page starts with `PageHeader` (drawer toggle, title, the page's controls); the toggle and the title never
  move between pages, and the same holds in the mobile layout. Navigation is the sidebar (a drawer on mobile).
- Hints: `Hint` (hover and keyboard focus; no fixed hint text taking up room). Never the browser's `title=` attribute. Touch
  screens have no hover: the control's icon and label must be enough, or the mobile layout gets a small "i".
- Words: short labels, no explaining paragraphs inside the screen. An icon-only control has an `aria-label`.
- Compact: tight spacing, small corners, glass cards (`surface-glass`), the brand gradient only for the main action.
- Dropdowns, inputs, dialogs, sheets and popovers come from `components/ui/` and look the same on every page.
- Destructive or leaving actions ask once ("Save your changes?"), and Esc closes the top box first.
