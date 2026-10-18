/**
 * ffmpeg-probe — prueba de una sola cosa: si el servidor puede ejecutar ffmpeg.
 *
 * Es el paso previo al boton "ajustar al audio". Si esto no responde con la
 * version de ffmpeg, la medicion automatica no es posible en Netlify y hay que
 * cambiar de plan antes de escribir nada mas. Se borra una vez decidido.
 */

import { spawnSync } from 'node:child_process';
import { statSync } from 'node:fs';
import ffmpeg from 'ffmpeg-static';

export default async () => {
  const salida = { ruta: ffmpeg || null };
  try {
    salida.tamanoMb = +(statSync(ffmpeg).size / 1048576).toFixed(1);
  } catch (e) {
    salida.tamanoMb = null;
    salida.errorArchivo = (e?.message || String(e)).slice(0, 120);
  }
  try {
    const r = spawnSync(ffmpeg, ['-version'], { encoding: 'utf8', timeout: 8000 });
    salida.version = (r.stdout || r.stderr || '').split('\n')[0] || null;
    salida.codigo = r.status;
  } catch (e) {
    salida.version = null;
    salida.error = (e?.message || String(e)).slice(0, 120);
  }
  return new Response(JSON.stringify(salida), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
};
