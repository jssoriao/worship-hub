import type { SelectHTMLAttributes } from 'react'

interface Props extends SelectHTMLAttributes<HTMLSelectElement> {
  /** smaller text, for toolbars */
  compact?: boolean
}

/**
 * The app's dropdown: a native select (keyboard, screen readers and phone pickers for free) with
 * the browser arrow replaced by our own chevron, padded off the right edge.
 */
export function Select({ compact = false, className = '', children, ...rest }: Props) {
  return (
    <span className={`relative inline-flex ${className}`}>
      <select
        {...rest}
        className={`wh-select w-full appearance-none rounded-lg border border-slate-700 bg-slate-900 pl-2.5 pr-8 text-slate-100 outline-none hover:border-slate-600 focus-visible:ring-2 focus-visible:ring-teal-400 disabled:opacity-50 ${
          compact ? 'py-1.5 text-xs' : 'py-1.5 text-sm'
        }`}
      >
        {children}
      </select>
      <svg aria-hidden="true" viewBox="0 0 20 20" className="pointer-events-none absolute right-2.5 top-1/2 size-3.5 -translate-y-1/2 text-slate-400">
        <path d="m5 8 5 5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  )
}
