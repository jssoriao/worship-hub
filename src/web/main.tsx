import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router'
import './index.css'
import App from './App.tsx'
import { AuthGate } from './components/AuthGate.tsx'
import { ChurchGate } from './lib/church.tsx'
import { NowPlayingProvider } from './lib/now-playing.tsx'
import { JoinPage } from './pages/JoinPage.tsx'

// a join link (/join/<token>) opens its own page instead of the app, signed in or not
const joinToken = /^\/join\/([^/]*)\/?$/.exec(location.pathname)?.[1]
/** The app's pages. A data router, so Practice can hold a page back to ask "Save your changes?" before edit mode ends. */
const appRouter = () =>
  createBrowserRouter([
    {
      path: '*',
      element: (
        <NowPlayingProvider>
          <App />
        </NowPlayingProvider>
      ),
    },
  ])
const app = joinToken !== undefined ? (
  <JoinPage token={joinToken} />
) : (
  <AuthGate>
    <ChurchGate>
      <RouterProvider router={appRouter()} />
    </ChurchGate>
  </AuthGate>
)
createRoot(document.getElementById('root')!).render(<StrictMode>{app}</StrictMode>)
