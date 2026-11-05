import { useEffect, useState } from 'react'

/** Hora actual que se refresca cada `intervalMs` (por defecto, cada minuto). */
export function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
