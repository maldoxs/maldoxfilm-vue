import { describe, test, expect, beforeEach } from 'vitest';
import { blacklistKey, isHashBlacklisted, addToBlacklist } from '../src/services/streamBlacklist';

describe('streamBlacklist — reporte manual "esta copia no sirve" (2026-07-14)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('blacklistKey arma una clave estable por título (id+type+season+episode)', () => {
    expect(blacklistKey(1284465, 'movie')).toBe('movie:1284465::');
    expect(blacklistKey(1399, 'tv', 2, 5)).toBe('tv:1399:2:5');
  });

  test('nada bloqueado por defecto', () => {
    const key = blacklistKey(1284465, 'movie');
    expect(isHashBlacklisted(key, 'abc123')).toBe(false);
  });

  test('addToBlacklist bloquea el infoHash SOLO para esa clave (ese título)', () => {
    const key = blacklistKey(1284465, 'movie');
    addToBlacklist(key, 'AbC123');
    expect(isHashBlacklisted(key, 'abc123')).toBe(true); // case-insensitive
    expect(isHashBlacklisted(blacklistKey(999, 'movie'), 'abc123')).toBe(false); // no se filtra a otro título
  });

  test('no duplica entradas ni rompe con infoHash null/undefined', () => {
    const key = blacklistKey(1284465, 'movie');
    addToBlacklist(key, 'hash1');
    addToBlacklist(key, 'hash1');
    addToBlacklist(key, null);
    addToBlacklist(key, undefined);
    const raw = JSON.parse(localStorage.getItem('sx_stream_blacklist') || '{}');
    expect(raw[key]).toEqual(['hash1']);
    expect(isHashBlacklisted(key, null)).toBe(false);
    expect(isHashBlacklisted(key, undefined)).toBe(false);
  });

  test('persiste entre llamadas (localStorage real, no memoria)', () => {
    const key = blacklistKey(1284465, 'movie');
    addToBlacklist(key, 'hash-persistente');
    // Nueva "sesión" simulada: releer sin resetear localStorage.
    expect(isHashBlacklisted(key, 'hash-persistente')).toBe(true);
  });
});
