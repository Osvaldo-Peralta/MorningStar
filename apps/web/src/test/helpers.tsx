// web/src/test/helpers.tsx
/*
--- Harness compartido de los tests de integración web (ADR-0013):
--- módulos REALES (identity, authentication, authorization, photo-feed) con
--- adaptadores InMemory/localStorage sobre jsdom + flujos UI reutilizables.
*/
import React from 'react'
import { expect } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from '../App'
import { AppProvider, useApp, type AppContextType } from '../context/AppContext'
import { AuthProvider } from '../context/AuthContext'

let app: AppContextType | null = null

/** Captura los módulos reales para aserciones y operaciones de soporte. */
const Capture: React.FC = () => {
  app = useApp()
  return null
}

export const renderApp = () => {
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

export const modules = () => {
  if (!app) throw new Error('AppContext no disponible')
  return app
}

export const USER = {
  username: 'osvaldo42',
  email: 'osvaldo@test.dev',
  displayName: 'Osvaldo Peralta',
  password: 'ClaveSegura123!',
}

export type TestUser = ReturnType<typeof userEvent.setup>

/** Registra una cuenta por UI y la deja en la pantalla 'pending'. */
export const registerViaUi = async (user: TestUser) => {
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
export const verifyViaOutbox = async (user: TestUser) => {
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

export const loginViaUi = async (
  user: TestUser,
  identifier = USER.username,
  password = USER.password
) => {
  const identifierInput = screen.getByPlaceholderText(/usuario o email/i)
  const passwordInput = screen.getByPlaceholderText(/^contraseña$/i)
  await user.clear(identifierInput)
  await user.clear(passwordInput)
  await user.type(identifierInput, identifier)
  await user.type(passwordInput, password)
  await user.click(screen.getByRole('button', { name: /^entrar$/i }))
}

/** Flujo completo: registro → verificación → login. Termina autenticado. */
export const fullSignUpAndLogin = async (user: TestUser) => {
  await screen.findByRole('tablist', { name: /modo de acceso/i })
  await registerViaUi(user)
  await verifyViaOutbox(user)
  await loginViaUi(user)
  await screen.findByTestId('current-user', {}, { timeout: 15_000 })
}

/** Cierra sesión desde el header y espera el AuthScreen. */
export const logoutViaUi = async (user: TestUser) => {
  await user.click(await screen.findByRole('button', { name: /cerrar sesión/i }))
  await screen.findByRole('tablist', { name: /modo de acceso/i })
}

/**
 * Abre el Dev Outbox y devuelve el token del email MÁS RECIENTE
 * (verificación o reset; los emails se listan en orden cronológico).
 */
export const grabLatestTokenFromOutbox = async (user: TestUser, minCount = 1): Promise<string> => {
  const outbox = await screen.findByTestId('dev-outbox')
  const toggle = outbox.querySelector('button')!
  if (toggle.textContent?.includes('▸')) await user.click(toggle)

  await waitFor(() => {
    expect(
      outbox.querySelectorAll('button[title="Copiar token"]').length
    ).toBeGreaterThanOrEqual(minCount)
  }, { timeout: 4000 })

  const buttons = outbox.querySelectorAll<HTMLButtonElement>('button[title="Copiar token"]')
  return buttons[buttons.length - 1]!.textContent!.trim()
}

/** Abre el modal de Seguridad (8b) y espera sus secciones. */
export const openSecurity = async (user: TestUser) => {
  await user.click(await screen.findByRole('button', { name: /seguridad/i }))
  await screen.findByRole('tablist', { name: /secciones de seguridad/i })
}
