/**
 * streamBlacklist — recuerda, por título, qué copia (`infoHash`) el USUARIO marcó
 * como "no sirve" (subtítulo ajeno, video incorrecto, etc.) para que no se vuelva a
 * elegir automáticamente en ese dispositivo.
 *
 * Por qué existe (2026-07-14, caso real "La muerte de Robin Hood"): la detección
 * por nombre de archivo (HC/PLSUBBED/origen de cine) tiene un techo real — una
 * copia que no declara NADA sospechoso puede igual traer un subtítulo extranjero
 * quemado, y no hay forma de saberlo sin ver el video. Para ese caso, la única
 * señal confiable es que el USUARIO lo confirme viéndolo — así que se le da un
 * control directo ("reportar y cambiar") en vez de seguir adivinando con regex.
 */

const STORAGE_KEY = 'sx_stream_blacklist';

export function blacklistKey(
  id: string | number,
  type: 'movie' | 'tv',
  season?: number,
  episode?: number
): string {
  return `${type}:${id}:${season ?? ''}:${episode ?? ''}`;
}

function readAll(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeAll(data: Record<string, string[]>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* silenciar — localStorage no disponible/lleno, no debe romper la reproducción */
  }
}

/** ¿El usuario ya reportó esta copia (infoHash) como mala para este título? */
export function isHashBlacklisted(key: string, infoHash: string | null | undefined): boolean {
  if (!infoHash) return false;
  const all = readAll();
  return (all[key] || []).includes(infoHash.toLowerCase());
}

/** Marca `infoHash` como reportado por el usuario para este título. */
export function addToBlacklist(key: string, infoHash: string | null | undefined): void {
  if (!infoHash) return;
  const all = readAll();
  const list = all[key] || [];
  const h = infoHash.toLowerCase();
  if (!list.includes(h)) {
    all[key] = [...list, h];
    writeAll(all);
  }
}
