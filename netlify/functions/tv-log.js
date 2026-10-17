/**
 * tv-log — recibe las lineas de log del reproductor cuando corre en TV y las escribe
 * en los logs de la function, que si se pueden leer (`netlify logs --function tv-log`).
 *
 * Existe porque el navegador de la smart-TV no tiene consola accesible. Sin esto, cada
 * diagnostico en TV se hacia a ciegas: habia que pedirle al usuario que sacara fotos de
 * carteles puestos a proposito en pantalla, y aun asi faltaban datos. Varias sesiones se
 * fueron en suponer cual de dos causas posibles era, teniendo la respuesta en un log que
 * nadie podia leer.
 *
 * No guarda nada ni devuelve nada util: solo imprime. El cliente llama en segundo plano
 * y descarta la respuesta, asi que un fallo aca nunca afecta la reproduccion.
 *
 * ESM porque package.json declara "type":"module".
 */

const MAX_BODY = 20000; // una tanda de lineas, no un volcado entero

export const handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': '*',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: '{"ok":false}' };

  try {
    const crudo = (event.body || '').slice(0, MAX_BODY);
    const { sesion, lineas } = JSON.parse(crudo);
    const marca = String(sesion || '?').slice(0, 12);
    for (const linea of Array.isArray(lineas) ? lineas.slice(0, 200) : []) {
      // eslint-disable-next-line no-console
      console.log(`[TV ${marca}] ${String(linea).slice(0, 600)}`);
    }
  } catch {
    /* un log mal formado no es motivo para devolver error al reproductor */
  }

  return { statusCode: 200, headers: cors, body: '{"ok":true}' };
};
