import { Link } from 'react-router'
import { buttonVariants } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { PageHeader } from '../components/PageHeader'

export default function NotFoundPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 pt-3 pb-24 md:px-6">
      <PageHeader title="Not found" />
      <Card className="mx-auto mt-10 max-w-md items-center gap-3 p-8 text-center">
        <p className="text-lg font-medium">Page not found</p>
        <p className="text-sm text-muted-foreground">There's nothing at this address.</p>
        <Link to="/" className={buttonVariants()}>
          Back to Home
        </Link>
      </Card>
    </div>
  )
}
