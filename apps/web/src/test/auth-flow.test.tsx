// Tests de integración web (ADR-0013): módulos REALES (identity,
// authentication, authorization, photo-feed) con adaptadores InMemory sobre
// jsdom. Prueban la plataforma de punta a punta a través de la UI.
import { describe, it, expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import React from 'react'
import App from '../App'
import { AppProvider, useApp, type AppContextType } from '../context/AppContext'
import { AuthProvider } from '../context/AuthContext'
import { TotpService } from '@morningstar/authentication'

let app: AppContextType | null = null

/** Captura los módulos reales para aserciones y operaciones de soporte. */
const Capture: React.FC = () => {
  app = useApp()
  return null
}

const renderApp = () => {
  app = null
  return render(
    <AppProvider>
      <AuthProvider>
        <Capture />
        <App />
      </AuthProvider>
    </AppProvider>
  )
}

const modules = () => {
  if (!app) throw new Error('AppContext no disponible')
  return app
}

const USER = {
  username: 'osvaldo42',
  email: 'osvaldo@test.dev',
  displayName: 'Osvaldo Peralta',
  password: 'ClaveSegura123!',
}

/** Registra una cuenta por UI y la deja en la pantalla 'pending'. */
const registerViaUi = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole('tab', { name: /crear cuenta/i }))
  await user.type(screen.getByPlaceholderText(/usuario \(a-z/i), USER.username)
  await user.type(screen.getByPlaceholderText(/email/i), USER.email)
  await user.type(screen.getByPlaceholderText(/nombre visible/i), USER.displayName)
  await user.type(screen.getByPlaceholderText(/contraseña \(mín/i), USER.password)
  await user.type(screen.getByPlaceholderText(/repite la contraseña/i), USER.password)
  await user.click(screen.getByRole('button', { name: /crear cuenta/i }))
  await screen.findByLabelText(/verificación de email/i)
}

/** Abre el Dev Outbox, extrae el token del email y verifica la cuenta por UI. */
const verifyViaOutbox = async (user: ReturnType<typeof userEvent.setup>) => {
  const outbox = await screen.findByTestId('dev-outbox')
  await user.click(outbox.querySelector('button')!)

  const copyButton = await waitFor(() => {
    const found = outbox.querySelector<HTMLButtonElement>('button[title="Copiar token"]')
    if (!found) throw new Error('token aún no visible en el outbox')
    return found
  }, { timeout: 4000 })

  await user.type(screen.getByPlaceholderText(/token de verificación/i), copyButton.textContent!.trim())
  await user.click(screen.getByRole('button', { name: /verificar cuenta/i }))
  await screen.findByText(/cuenta verificada/i)
}

const loginViaUi = async (user: ReturnType<typeof userEvent.setup>, identifier = USER.username, password = USER.password) => {
  const identifierInput = screen.getByPlaceholderText(/usuario o email/i)
  const passwordInput = screen.getByPlaceholderText(/^contraseña$/i)
  await user.clear(identifierInput)
  await user.clear(passwordInput)
  await user.type(identifierInput, identifier)
  await user.type(passwordInput, password)
  await user.click(screen.getByRole('button', { name: /^entrar$/i }))
}

/** Flujo completo: registro → verificación → login. Termina autenticado. */
const fullSignUpAndLogin = async (user: ReturnType<typeof userEvent.setup>) => {
  await screen.findByRole('tablist', { name: /modo de acceso/i })
  await registerViaUi(user)
  await verifyViaOutbox(user)
  await loginViaUi(user)
  await screen.findByTestId('current-user', {}, { timeout: 15_000 })
}

describe('Autenticación web (integración real)', () => {
  it('anónimo: muestra el AuthScreen con acceso y registro', async () => {
    renderApp()
    expect(await screen.findByRole('tablist', { name: /modo de acceso/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /iniciar sesión/i })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /crear cuenta/i })).toBeInTheDocument()
  }, 15_000)

  it('registro: queda pendiente de verificación y el email llega al Dev Outbox', async () => {
    const user = userEvent.setup()
    renderApp()
    await registerViaUi(user)

    expect(screen.getByText(/pendiente de verificación/i)).toBeInTheDocument()
    const outbox = await screen.findByTestId('dev-outbox')
    await waitFor(() => expect(outbox.textContent).toContain('Dev Outbox (1)'), { timeout: 4000 })
  }, 15_000)

  it('credenciales inválidas: error inline, sin alert', async () => {
    const user = userEvent.setup()
    renderApp()
    await screen.findByRole('tablist', { name: /modo de acceso/i })

    await loginViaUi(user, 'usuario-fantasma', 'da-igual-8')

    expect(await screen.findByRole('alert')).toHaveTextContent(/invalid credentials/i)
  }, 15_000)

  it('flujo completo: registro → verificación (outbox) → login → PhotoFeed con usuario', async () => {
    const user = userEvent.setup()
    renderApp()
    await fullSignUpAndLogin(user)

    expect(screen.getByTestId('current-user')).toHaveTextContent(USER.displayName)
    expect(screen.getByRole('button', { name: /cerrar sesión/i })).toBeInTheDocument()
  }, 30_000)

  it('logout devuelve al AuthScreen', async () => {
    const user = userEvent.setup()
    renderApp()
    await fullSignUpAndLogin(user)

    await user.click(screen.getByRole('button', { name: /cerrar sesión/i }))

    expect(await screen.findByRole('tablist', { name: /modo de acceso/i })).toBeInTheDocument()
  }, 30_000)

  it('MFA: con enrolamiento activo, el login pide segundo paso y el código TOTP entra', async () => {
    const user = userEvent.setup()
    renderApp()
    await fullSignUpAndLogin(user)

    // Enrolamiento MFA contra los módulos reales (la UI de gestión es 8b)
    const snapshot = await modules().identity.getByUsername(USER.username)
    const enrollment = await modules().authentication.enrollMfa(snapshot!.id)
    const activation = await modules().authentication.confirmMfa(
      snapshot!.id,
      await new TotpService().generateCode(enrollment.secret)
    )
    expect(activation.backupCodes).toHaveLength(10)

    // Logout y nuevo login ⇒ pantalla de segundo paso
    await user.click(screen.getByRole('button', { name: /cerrar sesión/i }))
    await screen.findByRole('tablist', { name: /modo de acceso/i })
    await loginViaUi(user)

    expect(await screen.findByLabelText(/verificación en dos pasos/i)).toBeInTheDocument()

    // Backup code (determinista; el TOTP dependería de la ventana de 30 s)
    await user.type(screen.getByPlaceholderText(/código \(6 dígitos o backup\)/i), activation.backupCodes[0]!)
    await user.click(screen.getByRole('button', { name: /^verificar$/i }))

    expect(await screen.findByTestId('current-user', {}, { timeout: 15_000 })).toHaveTextContent(USER.displayName)
  }, 45_000)

  it('PhotoFeed con actor: la foto agregada queda con ownerId del usuario', async () => {
    const user = userEvent.setup()
    renderApp()
    await fullSignUpAndLogin(user)

    await user.click(screen.getByRole('button', { name: /^upload$/i }))
    await user.click(await screen.findByRole('button', { name: /por url/i }))
    await user.type(screen.getByPlaceholderText(/enlace de la imagen/i), 'https://example.com/mia.jpg')
    await user.click(screen.getByRole('button', { name: /^añadir$/i }))

    await waitFor(() => {
      const photos = modules().photoFeed.listEntries()
      expect(photos).toHaveLength(1)
      const snapshot = app && photos[0]
      expect(snapshot?.ownerId).toBeTruthy()
    }, { timeout: 10_000 })

    const owner = await modules().identity.getByUsername(USER.username)
    expect(modules().photoFeed.listEntries()[0].ownerId).toBe(owner!.id)
  }, 45_000)
})
