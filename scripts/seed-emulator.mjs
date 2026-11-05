/**
 * Crea el usuario administrador de PRUEBA en el emulador de Auth (solo local).
 * Usa el mismo UID que firestore.rules para que las reglas lo traten como administrador.
 * Credenciales de prueba (solo emulador, no sirven en producción):
 *   correo:     admin@kmilo.test
 *   contraseña: kmilo-emulador-2026
 * Uso: con los emuladores encendidos, `npm run seed:emu`.
 */
import { readFileSync } from 'node:fs'

const PROJECT = 'demo-bar-kmilo'
const AUTH = 'http://127.0.0.1:9099'
const uid = /request\.auth\.uid == '([^']+)'/.exec(readFileSync('firestore.rules', 'utf8'))?.[1]
if (!uid) throw new Error('No se encontró el UID del administrador en firestore.rules')

const res = await fetch(
  `${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT}/accounts:batchCreate`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({
      users: [
        {
          localId: uid,
          email: 'admin@kmilo.test',
          rawPassword: 'kmilo-emulador-2026',
          emailVerified: true,
        },
      ],
    }),
  },
)
const body = await res.json()
if (!res.ok || body.error?.length) {
  console.error('No se pudo crear el usuario de prueba:', JSON.stringify(body))
  process.exit(1)
}
console.warn(`Usuario de prueba listo en el emulador (uid ${uid}): admin@kmilo.test`)
