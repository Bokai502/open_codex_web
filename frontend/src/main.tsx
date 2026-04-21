import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'

const Viewer3D = lazy(() => import('./pages/Viewer3D.tsx'))
const Earth = lazy(() => import('./pages/Earth.tsx'))

const isViewer = window.location.pathname === '/viewer'
const isEarth = window.location.pathname === '/earth'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {isViewer ? (
      <Suspense fallback={<div style={{ background: '#1a1a2e', width: '100vw', height: '100vh' }} />}>
        <Viewer3D />
      </Suspense>
    ) : isEarth ? (
      <Suspense fallback={<div style={{ background: '#000', width: '100vw', height: '100vh' }} />}>
        <Earth />
      </Suspense>
    ) : (
      <App />
    )}
  </StrictMode>,
)

