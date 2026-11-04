/**
 * Pruebas de Security Rules contra el emulador de Firestore.
 * Se ejecutan con: npm run test:rules  (requiere Java 21+).
 */
import { readFileSync } from 'node:fs'
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing'
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest'

const rules = readFileSync('firestore.rules', 'utf8')
/** El UID del administrador se toma de las propias reglas, para que no se desincronice. */
const ADMIN_UID = /request\.auth\.uid == '([^']+)'/.exec(rules)?.[1] ?? ''

let env: RulesTestEnvironment

beforeAll(async () => {
  if (!ADMIN_UID) throw new Error('No se encontró el UID del administrador en firestore.rules')
  env = await initializeTestEnvironment({
    projectId: 'demo-bar-kmilo',
    firestore: { rules, host: '127.0.0.1', port: 8080 },
  })
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
    await assertFails(getDoc(doc(admin(), 'products/p1')))
    await assertFails(setDoc(doc(admin(), 'orders/o1'), { total: 1000 }))
  })
})

describe('settings/general', () => {
  it('el administrador puede leer y guardar la configuración válida', async () => {
    await assertSucceeds(
      setDoc(doc(admin(), 'settings/general'), {
        businessName: 'Kmilo Bar',
        updatedAt: serverTimestamp(),
      }),
    )
    await assertSucceeds(getDoc(doc(admin(), 'settings/general')))
  })

  it('rechaza campos desconocidos o mal tipados', async () => {
    await assertFails(setDoc(doc(admin(), 'settings/general'), { businessName: 123 }))
    await assertFails(setDoc(doc(admin(), 'settings/general'), { businessName: '' }))
    await assertFails(setDoc(doc(admin(), 'settings/general'), { esAdmin: true }))
  })

  it('solo existe el documento "general" y no se puede borrar', async () => {
    await assertFails(setDoc(doc(admin(), 'settings/otro'), { businessName: 'x' }))
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'settings/general'), { businessName: 'Kmilo Bar' })
    })
    await assertFails(deleteDoc(doc(admin(), 'settings/general')))
  })
})
