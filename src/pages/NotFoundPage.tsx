import { Link } from 'react-router'

export default function NotFoundPage() {
  return (
    <div className="mx-auto max-w-3xl px-3 pb-24 pt-10 text-center">
      <h1 className="text-xl font-semibold tracking-tight">Page not found</h1>
      <p className="mt-2 text-slate-400">There's nothing at this address.</p>
      <Link
        to="/"
        className="mt-5 inline-block rounded-full bg-teal-600 px-4 py-1.5 text-sm font-medium text-white outline-none focus-visible:ring-2 focus-visible:ring-teal-300"
      >
        Back to Home
      </Link>
    </div>
  )
}
