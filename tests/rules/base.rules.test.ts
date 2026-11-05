/**
 * Pruebas de Security Rules contra el emulador de Firestore.
 * Se ejecutan con: npm run test:rules  (requiere Java 21+).
 */
import {
  assertFails,
  assertSucceeds,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'
import { ADMIN_UID, createEnv } from './helpers.ts'

let env: RulesTestEnvironment

beforeAll(async () => {
  env = await createEnv()
})

beforeEach(async () => {
  await env.clearFirestore()
})

afterAll(async () => {
  await env?.cleanup()
})

const admin = () => env.authenticatedContext(ADMIN_UID).firestore()
const stranger = () => env.authenticatedContext('usuario-cualquiera').firestore()
const anonymous = () => env.unauthenticatedContext().firestore()

describe('acceso por defecto', () => {
  it('un usuario anónimo no puede leer ni escribir', async () => {
    await assertFails(getDoc(doc(anonymous(), 'settings/general')))
    await assertFails(setDoc(doc(anonymous(), 'settings/general'), { businessName: 'x' }))
  })

  it('un usuario autenticado que no es el administrador tampoco', async () => {
    await assertFails(getDoc(doc(stranger(), 'settings/general')))
    await assertFails(setDoc(doc(stranger(), 'settings/general'), { businessName: 'x' }))
  })

  it('ni siquiera el administrador accede a colecciones aún no habilitadas', async () => {
    await assertFails(getDoc(doc(admin(), 'expenses/g1')))
    await assertFails(setDoc(doc(admin(), 'expenses/g1'), { total: 1000 }))
    await assertFails(getDoc(doc(admin(), 'payments/pg1')))
  })
})

describe('settings/general', () => {
  it('el administrador puede leer y guardar la configuración válida', async () => {
    await assertSucceeds(
      setDoc(doc(admin(), 'settings/general'), {
        businessName: 'Kmilo Bar',
        globalMarkupBp: 5000,
        roundingStep: 100,
        defaultMinStock: 6,
        reportEmail: null,
        updatedAt: serverTimestamp(),
      }),
    )
    await assertSucceeds(getDoc(doc(admin(), 'settings/general')))
  })

  it('rechaza campos desconocidos o mal tipados', async () => {
    await assertFails(setDoc(doc(admin(), 'settings/general'), { businessName: 123 }))
    await assertFails(setDoc(doc(admin(), 'settings/general'), { businessName: '' }))
    await assertFails(setDoc(doc(admin(), 'settings/general'), { esAdmin: true }))
    await assertFails(setDoc(doc(admin(), 'settings/general'), { roundingStep: 300 }))
    await assertFails(setDoc(doc(admin(), 'settings/general'), { globalMarkupBp: -1 }))
  })

  it('solo existe el documento "general" y no se puede borrar', async () => {
    await assertFails(setDoc(doc(admin(), 'settings/otro'), { businessName: 'x' }))
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'settings/general'), { businessName: 'Kmilo Bar' })
    })
    await assertFails(deleteDoc(doc(admin(), 'settings/general')))
  })
})
