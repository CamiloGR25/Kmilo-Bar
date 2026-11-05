import { describe, expect, it } from 'vitest'
import { detectDelimiter, normalizeHeader, parseCsv, parseCsvRows, toCsv } from '@/domain/csv'

describe('CSV', () => {
  it('detecta coma o punto y coma', () => {
    expect(detectDelimiter('a,b,c\n1,2,3')).toBe(',')
    expect(detectDelimiter('a;b;c\n1;2;3')).toBe(';')
  })
  it('respeta comillas, comillas escapadas, saltos de línea y BOM', () => {
    const text = '﻿nombre;nota\r\n"Ron; añejo";"dice ""hola"""\n"Dos\nlíneas";x\n'
    expect(parseCsvRows(text)).toEqual([
      ['nombre', 'nota'],
      ['Ron; añejo', 'dice "hola"'],
      ['Dos\nlíneas', 'x'],
    ])
  })
  it('ignora filas vacías', () => {
    expect(parseCsvRows('a,b\n\n1,2\n,\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })
  it('normaliza encabezados en español', () => {
    expect(normalizeHeader(' Stock mínimo ')).toBe('stock_minimo')
    expect(normalizeHeader('Categoría')).toBe('categoria')
  })
  it('convierte filas en objetos', () => {
    expect(parseCsv('Nombre,Costo\nAgua, 1200 ')).toEqual({
      headers: ['nombre', 'costo'],
      rows: [{ nombre: 'Agua', costo: '1200' }],
    })
  })
  it('genera CSV con ; que vuelve a leerse igual', () => {
    const out = toCsv(['nombre', 'nota'], [['Ron; añejo', 'ok']])
    expect(out.startsWith('﻿')).toBe(true)
    expect(parseCsvRows(out)).toEqual([
      ['nombre', 'nota'],
      ['Ron; añejo', 'ok'],
    ])
  })
})
