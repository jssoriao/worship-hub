import { emailOTPClient, organizationClient } from 'better-auth/client/plugins'
import { createAuthClient } from 'better-auth/react'
import { ac, roles } from '../../shared/permissions'

// Same origin as the app: the Worker answers /api/auth/*, so no baseURL is needed.
export const authClient = createAuthClient({ plugins: [emailOTPClient(), organizationClient({ ac, roles })] })
