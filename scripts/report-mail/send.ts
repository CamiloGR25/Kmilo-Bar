/* oxlint-disable no-console -- scripts de línea de comandos */
/**
 * Envío del resumen por correo (Fase 10, M11). Lo ejecuta GitHub Actions (`reports.yml`) o
 * a mano. Variables:
 *   REPORT_KIND        semanal | mensual (por defecto, según el día: lunes = semanal, día 1 = mensual)
 *   REPORT_TO          destinatarios separados por coma (secreto)
 *   GMAIL_USER         cuenta de Gmail que envía (secreto)
 *   GMAIL_APP_PASSWORD contraseña de aplicación de esa cuenta (secreto)
 *   FIREBASE_SERVICE_ACCOUNT  JSON de la cuenta de servicio (secreto)
 *   DRY_RUN=1          no envía: guarda el correo en `out/` para revisarlo
 *   TODAY=AAAA-MM-DD   fecha de referencia (pruebas)
 * Nunca imprime cifras ni destinatarios: los registros de Actions son públicos en este repo.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { createTransport } from 'nodemailer'
import { businessDateOf, isBusinessDate, type BusinessDate } from '../../src/domain/dates'
import {
  mailRange,
  buildReportMail,
  type MailKind,
} from '../../src/features/mail/domain/report-mail'
import { buildReport, REPORT_IDS, type ReportId } from '../../src/features/reports/domain/reports'
import { fileNameFor, reportToCsv } from '../../src/features/reports/services/export'
import { adminDb, loadInputAdmin } from './admin-data'

const MAIL_REPORTS: ReportId[] = [
  'resumen_financiero',
  'ventas_diarias',
  'ventas_semanales',
  'ventas_mensuales',
  'gastos',
  'cierres_caja',
  'compras_proveedor',
  'inventario_actual',
]

function todayBogota(): BusinessDate {
  const t = process.env.TODAY
  if (t) {
    if (!isBusinessDate(t)) throw new Error('TODAY debe ser AAAA-MM-DD')
    return t
  }
  return businessDateOf(new Date())
}

function kindFor(today: BusinessDate): MailKind {
  const explicit = process.env.REPORT_KIND
  if (explicit === 'semanal' || explicit === 'mensual') return explicit
  // 1 = lunes (semanal); día 1 del mes = mensual.
  if (today.endsWith('-01')) return 'mensual'
  return 'semanal'
}

async function main() {
  const today = todayBogota()
  const kind = kindFor(today)
  const range = mailRange(kind, today)
  const db = adminDb()
  const input = await loadInputAdmin(db, range)
  const tables = MAIL_REPORTS.filter((id) => REPORT_IDS.includes(id)).map((id) =>
    buildReport(id, input),
  )
  const mail = buildReportMail({
    kind,
    range,
    tables,
    csvOf: reportToCsv,
    filenameOf: (t) => fileNameFor(t, 'csv'),
  })

  if (process.env.DRY_RUN === '1') {
    const dir = join('out', `correo-${kind}-${range.from}`)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'correo.html'), mail.html, 'utf8')
    writeFileSync(join(dir, 'correo.txt'), mail.text, 'utf8')
    for (const a of mail.attachments) writeFileSync(join(dir, a.filename), a.csv, 'utf8')
    console.log(`Simulación: correo guardado en ${dir} (no se envió).`)
    return
  }

  const to = process.env.REPORT_TO
  const user = process.env.GMAIL_USER
  const pass = process.env.GMAIL_APP_PASSWORD
  if (!to || !user || !pass) throw new Error('Faltan REPORT_TO, GMAIL_USER o GMAIL_APP_PASSWORD.')

  const transport = createTransport({
    service: 'gmail',
    auth: { user, pass },
  })
  await transport.sendMail({
    from: `Kmilo Bar <${user}>`,
    to: to
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
    attachments: mail.attachments.map((a) => ({
      filename: a.filename,
      content: a.csv,
      contentType: 'text/csv; charset=utf-8',
    })),
  })
  console.log(`Correo ${kind} enviado (${mail.attachments.length} adjuntos).`)
}

main().catch((err: unknown) => {
  // Sin datos sensibles en el mensaje: solo el error.
  console.error(err instanceof Error ? err.message : 'Error desconocido')
  process.exit(1)
})
