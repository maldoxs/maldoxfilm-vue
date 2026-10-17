/**
 * tvLog — espeja los logs del reproductor a una Netlify Function cuando corre en TV.
 *
 * El navegador de la smart-TV no tiene consola accesible, asi que cada diagnostico ahi
 * se venia haciendo a ciegas: carteles puestos a proposito en pantalla, fotos, y aun asi
 * faltaban datos. Varias vueltas se fueron en suponer cual de dos causas era, teniendo la
 * respuesta en un log que nadie podia leer. Con esto las mismas lineas que se ven en la
 * consola del escritorio quedan disponibles en los logs de la function.
 *
 * Solo se activa en TV. En escritorio y movil no se engancha nada: ahi ya hay consola.
 *
 * Es best effort de punta a punta. Si la red falla, si la function no responde o si el
 * JSON sale mal, se descarta en silencio: un log no puede romper una reproduccion.
 */

const ENDPOINT = '/.netlify/functions/tv-log';
const INTERVALO_MS = 3000; // se agrupan las lineas para no hacer una peticion por linea
const MAX_EN_COLA = 120; // si se desborda, se tiran las mas viejas
const PREFIJOS = ['[RD]', '[/t/]', '[PLAYER]', '[SUB]'];

let enganchado = false;
let cola: string[] = [];
/**
 * Ultima linea enviada, para no repetir. Un reproductor en PAUSA late cada pocos
 * segundos con el mismo texto; una sola pestaña olvidada asi llenaba el log y tapaba
 * la reproduccion que se queria diagnosticar (visto el 2026-10-17 buscando el caso de
 * "Scrapbook"). Las lineas repetidas consecutivas no aportan nada.
 */
let ultima = '';
let repetidas = 0;
let temporizador: ReturnType<typeof setInterval> | null = null;
const sesion = Math.random().toString(36).slice(2, 8);

function enviar(fetchImpl: typeof fetch) {
  if (!cola.length) return;
  const lineas = cola;
  cola = [];
  try {
    void fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sesion, lineas }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* noop */
  }
}

/** ¿Es una linea del reproductor y no ruido de terceros? */
export function esLineaDelReproductor(texto: string): boolean {
  return PREFIJOS.some((p) => texto.startsWith(p));
}

export function formatearArgumentos(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === 'string') return a;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
}

/**
 * engancharLogsDeTv — empieza a espejar. Idempotente: llamarla dos veces no duplica.
 * Devuelve la funcion para desenganchar, que hoy solo usan los tests.
 */
export function engancharLogsDeTv(fetchImpl: typeof fetch = fetch): () => void {
  if (enganchado) return () => {};
  enganchado = true;

  const original = console.warn.bind(console);
  console.warn = (...args: unknown[]) => {
    original(...(args as []));
    try {
      const texto = formatearArgumentos(args);
      if (!esLineaDelReproductor(texto)) return;
      if (texto === ultima) {
        repetidas++;
        return;
      }
      if (repetidas > 0) {
        cola.push(`(la línea anterior se repitió ${repetidas} veces)`);
        repetidas = 0;
      }
      ultima = texto;
      cola.push(texto);
      if (cola.length > MAX_EN_COLA) cola = cola.slice(-MAX_EN_COLA);
    } catch {
      /* noop */
    }
  };

  temporizador = setInterval(() => enviar(fetchImpl), INTERVALO_MS);
  // Si la pagina se cierra, se manda lo que quede pendiente.
  window.addEventListener('pagehide', () => enviar(fetchImpl));

  return () => {
    console.warn = original;
    if (temporizador) clearInterval(temporizador);
    temporizador = null;
    enganchado = false;
    cola = [];
    ultima = '';
    repetidas = 0;
  };
}
