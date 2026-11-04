import { render, screen } from '@testing-library/react'
import { DashboardPreview } from './dashboard-preview'

describe('DashboardPreview', () => {
  it('muestra el precio sugerido del ejemplo de referencia', () => {
    render(<DashboardPreview />)
    expect(screen.getByRole('heading', { level: 1, name: 'Inicio' })).toBeInTheDocument()
    expect(screen.getByText(/4\.500/)).toBeInTheDocument()
    expect(screen.getByText('Agotado')).toBeInTheDocument()
    expect(screen.getByText(/33,3/)).toBeInTheDocument()
  })
})
