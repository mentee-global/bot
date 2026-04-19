import { PostHogProvider as BasePostHogProvider } from '@posthog/react'
import posthog from 'posthog-js'
import type { ReactNode } from 'react'
import { useIdentifySession } from '#/integrations/posthog/useIdentifySession'

if (typeof window !== 'undefined' && import.meta.env.VITE_POSTHOG_KEY) {
  posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
    api_host: import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com',
    person_profiles: 'identified_only',
    capture_pageview: false,
    defaults: '2025-11-30',
  })
}

interface PostHogProviderProps {
  children: ReactNode
}

function SessionIdentifier() {
  useIdentifySession()
  return null
}

export default function PostHogProvider({ children }: PostHogProviderProps) {
  return (
    <BasePostHogProvider client={posthog}>
      <SessionIdentifier />
      {children}
    </BasePostHogProvider>
  )
}
