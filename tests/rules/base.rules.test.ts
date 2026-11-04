/**
 * Pruebas de Security Rules contra el emulador de Firestore.
 * Se ejecutan con: npm run test:rules  (requiere Java 21+).
 */
import { readFileSync } from 'node:fs'
import {
  assertFails,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { doc, getDoc, setDoc } from 'firebase/firestore'
import { afterAll, beforeAll, describe, it } from 'vitest'

let env: RulesTestEnvironment

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-bar-kmilo',
    firestore: { rules: readFileSync('firestore.rules', 'utf8'), host: '127.0.0.1', port: 8080 },
  })
})

afterAll(async () => {
  await env?.cleanup()
})

describe('Fase 0 · todo denegado por defecto', () => {
  it('un usuario anónimo no puede leer ni escribir', async () => {
    const db = env.unauthenticatedContext().firestore()
    await assertFails(getDoc(doc(db, 'settings/general')))
    await assertFails(setDoc(doc(db, 'settings/general'), { businessName: 'x' }))
  })

  it('un usuario autenticado cualquiera tampoco', async () => {
    const db = env.authenticatedContext('usuario-cualquiera').firestore()
    await assertFails(getDoc(doc(db, 'products/p1')))
    await assertFails(setDoc(doc(db, 'products/p1'), { name: 'Cerveza' }))
  })
})
