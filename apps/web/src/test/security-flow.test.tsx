// Tests de integración web de la gestión de autenticación (Iteración 8b,
// ADR-0013/0014): MFA con QR, backup codes, cambio/reset de contraseña y
// "tus dispositivos". Módulos REALES sobre jsdom; los códigos TOTP se
// generan con el TotpService real a partir del secret que muestra la UI.
import { describe, it, expect } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TotpService } from '@morningstar/authentication'
import {
  renderApp,
  modules,
  USER,
  fullSignUpAndLogin,
  loginViaUi,
  logoutViaUi,
  grabLatestTokenFromOutbox,
  openSecurity,
} from './helpers'

describe('Gestión de autenticación web (8b, integración real)', () => {
  it('cambio de contraseña: cierra las sesiones y vuelve al login con aviso', async () => {
    const user = userEvent.setup()
    renderApp()
    await fullSignUpAndLogin(user)

    await openSecurity(user)
    await user.click(screen.getByRole('tab', { name: /^contraseña$/i }))
    await user.type(screen.getByPlaceholderText(/contraseña actual/i), USER.password)
    await user.type(screen.getByPlaceholderText(/^nueva contraseña/i), 'NuevaClave456!')
    await user.type(screen.getByPlaceholderText(/repite la nueva contraseña/i), 'NuevaClave456!')
    await user.click(screen.getByRole('button', { name: /cambiar contraseña/i }))

    // El backend revocó todas las sesiones ('password-changed') ⇒ AuthScreen
    // + aviso transitorio del AuthContext.
    expect(await screen.findByRole('tablist', { name: /modo de acceso/i })).toBeInTheDocument()
    expect(await screen.findByText(/contraseña cambiada/i)).toBeInTheDocument()

    // La contraseña nueva funciona en el módulo real
    await loginViaUi(user, USER.username, 'NuevaClave456!')
    expect(await screen.findByTestId('current-user', {}, { timeout: 15_000 })).toHaveTextContent(
      USER.displayName
    )
  }, 60_000)

  it('MFA: enrolamiento por UI con QR + secret, código TOTP real y backup codes', async () => {
    const user = userEvent.setup()
    renderApp()
    await fullSignUpAndLogin(user)

    await openSecurity(user) // sección inicial: Dos pasos
    await user.click(screen.getByRole('button', { name: /activar verificación en dos pasos/i }))

    // QR renderizado (SVG) + secret manual de respaldo (ADR-0014)
    const qr = await screen.findByTestId('mfa-qr')
    expect(qr.querySelector('svg')).not.toBeNull()
    const secret = screen.getByTestId('mfa-secret').textContent!.trim()
    expect(secret).toMatch(/^[A-Z2-7]+={0,6}$/)

    // Código real calculado con TotpService a partir del secret mostrado
    const code = await new TotpService().generateCode(secret)
    await user.type(screen.getByPlaceholderText(/código de tu app/i), code)
    await user.click(screen.getByRole('button', { name: /confirmar y activar/i }))

    // Backup codes: entrega única, 10 códigos + copia/descarga
    const panel = await screen.findByTestId('backup-codes')
    const codes = within(panel).getAllByTestId('backup-code')
    expect(codes).toHaveLength(10)
    expect(within(panel).getByRole('button', { name: /^copiar$/i })).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: /descargar/i })).toBeInTheDocument()
    const firstBackupCode = codes[0]!.textContent!.trim()

    // El módulo real marca MFA como activo
    const snapshot = await modules().identity.getByUsername(USER.username)
    const status = await modules().authentication.getMfaStatus(snapshot!.id)
    expect(status).toEqual({ enrolled: true, active: true })

    // Desactivación con backup code (factor válido, ADR-0010)
    await user.click(within(panel).getByRole('button', { name: /^listo$/i }))
    expect(await screen.findByTestId('mfa-active')).toBeInTheDocument()
    await user.type(screen.getByPlaceholderText(/código actual/i), firstBackupCode)
    await user.click(screen.getByRole('button', { name: /desactivar/i }))

    expect(await screen.findByText(/desactivada/i)).toBeInTheDocument()
    const after = await modules().authentication.getMfaStatus(snapshot!.id)
    expect(after.active).toBe(false)
  }, 60_000)

  it('dispositivos: lista sesiones, marca la actual y revoca dispositivos remotos', async () => {
    const user = userEvent.setup()
    renderApp()
    await fullSignUpAndLogin(user)

    // Dos sesiones extra desde "otros dispositivos" (módulo real, sin UI)
    const otherA = await modules().authentication.login(USER.username, USER.password, {
      fingerprint: 'dev-b-000001',
    })
    const otherB = await modules().authentication.login(USER.username, USER.password, {
      fingerprint: 'dev-c-000002',
    })

    await openSecurity(user)
    await user.click(screen.getByRole('tab', { name: /dispositivos/i }))

    const items = await screen.findAllByTestId('session-item')
    expect(items).toHaveLength(3)
    // La sesión de esta UI está marcada (sessionId del AuthContext)
    expect(screen.getByTestId('current-device-badge')).toBeInTheDocument()

    // Revocación individual del dispositivo "dev-b-000001"
    const itemB = items.find((el) => el.textContent?.includes('dev-b-000001'))!
    expect(itemB).toBeDefined()
    await user.click(within(itemB).getByRole('button', { name: /^cerrar$/i }))

    await waitFor(() => expect(screen.getAllByTestId('session-item')).toHaveLength(2))
    expect(await modules().authentication.validateSession(otherA.session.token)).toBeNull()
    expect(await modules().authentication.validateSession(otherB.session.token)).not.toBeNull()

    // "Cerrar las demás sesiones" revoca la restante (la actual sobrevive)
    await user.click(screen.getByRole('button', { name: /cerrar las demás sesiones/i }))
    await waitFor(() => expect(screen.getAllByTestId('session-item')).toHaveLength(1))
    expect(await modules().authentication.validateSession(otherB.session.token)).toBeNull()
    expect(screen.getByTestId('current-device-badge')).toBeInTheDocument()
  }, 60_000)

  it('reset de contraseña: AuthScreen → Dev Outbox → token → login con la nueva', async () => {
    const user = userEvent.setup()
    renderApp()
    await fullSignUpAndLogin(user)
    await logoutViaUi(user)

    await user.click(screen.getByRole('button', { name: /olvidaste tu contraseña/i }))
    await user.type(screen.getByPlaceholderText(/usuario o email/i), USER.username)
    await user.click(screen.getByRole('button', { name: /enviar instrucciones/i }))

    // Anti-enumeración: mismo mensaje exista o no la cuenta
    expect(await screen.findByText(/si la cuenta existe/i)).toBeInTheDocument()

    // El token del reset llega al Dev Outbox (2º email tras el de verificación)
    const token = await grabLatestTokenFromOutbox(user, 2)
    await user.type(screen.getByPlaceholderText(/token de reset/i), token)
    await user.type(screen.getByPlaceholderText(/^nueva contraseña/i), 'OtraClave789!')
    await user.type(screen.getByPlaceholderText(/repite la nueva contraseña/i), 'OtraClave789!')
    await user.click(screen.getByRole('button', { name: /restablecer contraseña/i }))

    expect(await screen.findByText(/contraseña actualizada/i)).toBeInTheDocument()

    // Login con la nueva contraseña (el reset revocó todas las sesiones)
    await loginViaUi(user, USER.username, 'OtraClave789!')
    expect(await screen.findByTestId('current-user', {}, { timeout: 15_000 })).toHaveTextContent(
      USER.displayName
    )
  }, 60_000)
})
