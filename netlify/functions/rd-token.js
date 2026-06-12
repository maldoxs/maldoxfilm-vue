/**
 * rd-token — Netlify Function (server-side) que entrega el RD_TOKEN al cliente
 * en runtime, SIN que el token viva nunca en el bundle del navegador ni en git.
 *
 * ⚠️ SEGURIDAD (ver services/bootstrap.ts): el RD_TOKEN se lee EXCLUSIVAMENTE
 * de `process.env.RD_TOKEN` — una variable de entorno que vive:
 *   - en local: en `.env` (gitignored, servido por `netlify dev`)
 *   - en producción: en las "Environment variables" del panel de Netlify
 * Nunca se hardcodea aquí ni se commitea. Si la variable falta, devuelve `''`
 * y la app entra en "modo degradado" (RD inactivo) sin romperse — exactamente
 * el caso que `fetchRdToken()`/`emptySelectedStream()` ya manejan.
 *
 * Nota: se usa `export const handler` (ESM) porque el `package.json` del
 * proyecto declara `"type": "module"`; con `exports.handler` (CommonJS) Netlify
 * avisaría que el archivo debería ser `.cjs`.
 *
 * Esta es la "Fase 1" de seguridad (la function devuelve el token al cliente).
 * La "Fase 2" ideal (proxy completo, el navegador nunca recibe el token) queda
 * documentada en bootstrap.ts como mejora futura.
 */
export const handler = async () => {
  const token = process.env.RD_TOKEN || '';
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      // No cachear — el token podría rotarse en cualquier momento.
      'Cache-Control': 'no-store',
    },
    body: JSON.stringify({ token }),
  };
};
