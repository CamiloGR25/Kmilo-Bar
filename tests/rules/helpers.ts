import { readFileSync } from 'node:fs'
import { initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing'

export const rules = readFileSync('firestore.rules', 'utf8')

/** El UID del administrador se toma de las propias reglas, para que no se desincronice. */
export const ADMIN_UID = /request\.auth\.uid == '([^']+)'/.exec(rules)?.[1] ?? ''

export async function createEnv(): Promise<RulesTestEnvironment> {
  if (!ADMIN_UID) throw new Error('No se encontró el UID del administrador en firestore.rules')
  return initializeTestEnvironment({
    projectId: 'demo-bar-kmilo',
    firestore: { rules, host: '127.0.0.1', port: 8080 },
  })
}
