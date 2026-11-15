# Worship Hub: mobile design rules

The app has two layouts, mobile and desktop. They are two designs, not one design squeezed: the audio
engine, analysis, edit logic and API are shared, the layout components are not. Read this before building or
changing any screen for phones or tablets.

## Which layout, and how to ask
- Rules live in `src/web/lib/layout.ts` (tested): under 768 px wide, or a touch screen under 500 px tall (a phone
  sideways), is mobile only with no switch. Any other touch screen (iPads) starts mobile and may switch to desktop. A mouse
  screen starts desktop from 1024 px, mobile below it, and may always switch. The person's choice is remembered on the device.
- `useLayout()` gives `layout`, `canSwitch`, `platform`, `choose`; `useIsMobileLayout()` is the short form
  (`src/web/lib/layout-context.ts`, provider `layout-provider.tsx` in `main.tsx`).
- The provider writes `data-layout` and `data-platform` on `<html>`. Tailwind variants `mobile:`, `desktop:`, `ios:` and
  `android:` read them (index.css); `ios:` and `android:` apply in the mobile layout only. Prefer a variant for a
  style difference. Use two components (chosen with `useIsMobileLayout()`) when the structure differs.
- Do not use `sm:`/`md:`/`lg:` to decide mobile or desktop. They stay fine for small tweaks inside one layout.

## Follow the platform (mobile layout, iOS and Android first; iPad and desktop styling is a later task)
- One design system, a few platform variants: colours, spacing and content are shared; the variants are things like
  corner radius, how a bar is filled, the active-tab indicator and motion. Never keep two copies of a screen for two platforms.
- iOS: glass bars and sheets (blur with saturation, a tint, a light edge). CSS cannot refract, only Chromium can bend
  what is behind the glass, so this is an approximation: do not chase it. Keep text readable over any background.
- Android: tonal, mostly solid surfaces, a bottom navigation bar with a pill around the active item, modal bottom
  sheets, the system Back button closes a sheet before it leaves the page.
- `platform` comes from the user agent (an iPad that says it is a Mac is told apart by its touch points); it only picks a
  look, never a feature.

## Touch and reach
- Touch targets are at least 44 px (the desktop icon buttons are 24 to 40 px: do not reuse them on mobile).
- The main actions sit in the bottom half of the screen. Settings and pickers open as bottom sheets, not popovers.
- Nothing needs hover. A gesture (swipe, long press) always has a visible button as well.
- Use `dvh`, never `vh`. Fixed bars add `pb-safe` / `pt-safe` (`pl-safe`, `pr-safe`) for the notch and the home bar; the
  viewport turns on `viewport-fit=cover` together with the mobile shell, not before.
- Text boxes and dropdowns are at least 16 px on touch screens (index.css), or iPhone Safari zooms in.
- Respect `prefers-reduced-motion`.

## Content
- Almost no hint text: labels are short, panels hold controls only.
- The play bar stays reachable on every page while a song is open.
- Edit mode in Practice hides whatever could change the song or the view, and asks "Save your changes?" before it is left with unsaved edits. Mobile keeps both.
- This repo is public: the look is our own. Do not copy another product's layout, copy, icons or colours, and do not name
  other products in code, commits or issues.
