import { useEffect, useState } from 'react'

export interface SubscriptionState<T> {
  data: T | undefined
  loading: boolean
  error: Error | null
}

/**
 * Se suscribe a una fuente en tiempo real (onSnapshot) y expone datos, carga y error.
 * `subscribe` recibe callbacks y devuelve la función para cancelar.
 * `key` controla cuándo volver a suscribirse.
 */
export function useSubscription<T>(
  subscribe: (onData: (data: T) => void, onError: (error: Error) => void) => () => void,
  key: string,
): SubscriptionState<T> {
  const [state, setState] = useState<SubscriptionState<T>>({
    data: undefined,
    loading: true,
    error: null,
  })

  useEffect(() => {
    let active = true
    const unsubscribe = subscribe(
      (data) => active && setState({ data, loading: false, error: null }),
      (error) => active && setState((s) => ({ ...s, loading: false, error })),
    )
    return () => {
      active = false
      unsubscribe()
    }
    // `subscribe` se recrea en cada render; la identidad estable la da `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return state
}

/** Convierte un Timestamp de Firestore (o null) en Date. */
export function toDate(value: unknown): Date | null {
  if (value && typeof value === 'object' && 'toDate' in value) {
    return (value as { toDate: () => Date }).toDate()
  }
  return null
}
