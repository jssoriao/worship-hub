// From shadcn/ui (MIT, see THIRD_PARTY_NOTICES.md): joins class names, later Tailwind classes winning.
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
