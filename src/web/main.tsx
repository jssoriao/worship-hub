import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import './index.css'
import App from './App.tsx'
import { AuthGate } from './components/AuthGate.tsx'
import { ChurchGate } from './lib/church.tsx'
import { NowPlayingProvider } from './lib/now-playing.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthGate>
      <ChurchGate>
        <BrowserRouter>
          <NowPlayingProvider>
            <App />
          </NowPlayingProvider>
        </BrowserRouter>
      </ChurchGate>
    </AuthGate>
  </StrictMode>,
)
