// Tests de integración web (ADR-0013): módulos REALES (identity,
// authentication, authorization, photo-feed) con adaptadores InMemory sobre
// jsdom. Prueban la plataforma de punta a punta a través de la UI.
// Harness compartido en ./helpers (8b).
import { describe, it, expect } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TotpService } from '@morningstar/authentication'
import {
  renderApp,
  modules,
  USER,
  registerViaUi,
  loginViaUi,
  fullSignUpAndLogin,
} from './helpers'

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
      expect(photos[0]?.ownerId).toBeTruthy()
    }, { timeout: 10_000 })

    const owner = await modules().identity.getByUsername(USER.username)
    expect(modules().photoFeed.listEntries()[0].ownerId).toBe(owner!.id)
  }, 45_000)
})
