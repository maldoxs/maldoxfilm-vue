/**
 * lib/rd — lo que las functions necesitan saber de Real-Debrid.
 *
 * Vive fuera de `netlify/functions/` a propósito: ahí dentro, cada archivo .js
 * es una function publicada.
 */

/** Solo se aceptan enlaces de Real-Debrid y de quien los resuelve. */
const HOSTS_PERMITIDOS = [/(^|\.)real-debrid\.com$/i, /(^|\.)strem\.fun$/i];

export function hostPermitido(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    return HOSTS_PERMITIDOS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

/**
 * enlaceDirectoDeRd — enlace de descarga del archivo que se está reproduciendo.
 *
 * `rdId` es el identificador de una DESCARGA (el mismo que usa
 * `streaming/mediaInfos`), no el de un torrent: pedirlo como torrent devuelve
 * 404. Se busca en la lista de descargas de la cuenta.
 *
 * Hace falta porque el enlace que usa el reproductor es el de Torrentio, y
 * Torrentio le responde 403 a los servidores: solo atiende navegadores.
 *
 * El token vive solo en el servidor y no aparece en ningún registro. Devuelve
 * null ante cualquier problema.
 */
export async function enlaceDirectoDeRd(rdId) {
  const token = process.env.RD_TOKEN || '';
  if (!token || !/^[A-Z0-9]{1,30}$/i.test(rdId || '')) return null;
  try {
    const lista = await fetch('https://api.real-debrid.com/rest/1.0/downloads?limit=100', {
      headers: { Authorization: `Bearer ${token}` },
    }).then((r) => (r.ok ? r.json() : null));
    if (!Array.isArray(lista)) return null;
    const suyo = lista.find((x) => x?.id === rdId);
    const descarga = suyo?.download;
    return typeof descarga === 'string' && hostPermitido(descarga) ? descarga : null;
  } catch {
    return null;
  }
}
