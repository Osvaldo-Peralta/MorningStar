import './App.css'
import { PhotoFeed } from './components/PhotoFeed'
import { AuthScreen } from './components/auth/AuthScreen'
import { DevOutbox } from './components/auth/DevOutbox'
import { useAuth } from './context/AuthContext'

/**
 * AuthGate (ADR-0013): sin sesión ⇒ AuthScreen; con sesión ⇒ PhotoFeed.
 * El Dev Outbox acompaña siempre en development (verificación/reset de emails).
 */
function App() {
  const { status } = useAuth();

  return (
    <>
      {status === 'loading' && (
        <div className="flex h-screen items-center justify-center bg-gray-900 text-white">
          <p className="animate-pulse">Cargando sesión...</p>
        </div>
      )}
      {status === 'anonymous' && <AuthScreen />}
      {status === 'authenticated' && <PhotoFeed />}
      <DevOutbox />
    </>
  )
}

export default App
