import { describe, it, expect } from 'vitest';
import { parseCSVRows } from '../csv';

describe('parseCSVRows', () => {
  it('campos simples y coma dentro de comillas', () => {
    expect(parseCSVRows('a,b,c\n"x, y",2,3\n')).toEqual([['a','b','c'],['x, y','2','3']]);
  });
  it('comillas dobles escapadas', () => {
    expect(parseCSVRows('a,b\n"Dijo ""hola"" al médico",z\n')[1][0]).toBe('Dijo "hola" al médico');
  });
  it('saltos de línea dentro de un campo entrecomillado', () => {
    const r = parseCSVRows('a,b\n"línea1\nlínea2",z\n');
    expect(r).toHaveLength(2);
    expect(r[1]).toEqual(['línea1\nlínea2', 'z']);
  });
  it('finales de línea CRLF (Excel/Windows)', () => {
    expect(parseCSVRows('a,b\r\n1,2\r\n3,4\r\n')).toEqual([['a','b'],['1','2'],['3','4']]);
  });
  it('BOM inicial (Excel "CSV UTF-8")', () => {
    expect(parseCSVRows('\uFEFFtext,x\nhola,1')[0][0]).toBe('text');
  });
  it('líneas vacías y sin salto final', () => {
    expect(parseCSVRows('a,b\n\n1,2')).toEqual([['a','b'],['1','2']]);
  });
  it('fila real de MIRai: 11 columnas', () => {
    const line = '"Mujer de 58 años con fiebre. ¿Germen más probable?",infec,c,3,2023,"S. pneumoniae es el más frecuente.",Legionella,Mycoplasma,"S. pneumoniae",Staphylococcus,Klebsiella';
    const r = parseCSVRows('h\n' + line)[1];
    expect(r).toHaveLength(11);
    expect(r[8]).toBe('S. pneumoniae');
  });
});
