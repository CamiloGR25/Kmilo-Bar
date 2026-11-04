import { render, screen } from '@testing-library/react'
import App from './App'

describe('App (Fase 0)', () => {
  it('muestra el precio sugerido del ejemplo de referencia', () => {
    render(<App />)
    expect(screen.getByRole('heading', { name: 'Bar · Administración' })).toBeInTheDocument()
    expect(screen.getByText(/4\.500/)).toBeInTheDocument()
    expect(screen.getByText(/33,3/)).toBeInTheDocument()
  })
})
