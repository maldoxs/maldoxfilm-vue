// ── Compatibilidad CSS con navegadores viejos (LG webOS 3 / Chromium 38) — Paso 2/3 ──
//
// PROBLEMA: Chromium 38 NO soporta variables CSS (`var(--x)` llegó en Chromium 49). Cuando
// no las soporta, descarta la DECLARACIÓN ENTERA (`color: var(--accent)` se va a la basura,
// incluido el fallback inline) → el layout se rompe. La app define 34 tokens en un único
// `:root` (src/style.css) y los usa ~291 veces.
//
// SOLUCIÓN (aditiva, no destructiva): `postcss-custom-properties` inserta, ANTES de cada
// `var()`, una línea con el VALOR FIJO resuelto. La TV vieja usa esa línea; el navegador
// moderno ignora la línea fija (queda pisada) y usa el `var()` → render idéntico en moderno.
//   color: #3d5afe;            ← la usa Chromium 38
//   color: var(--accent);      ← la usa el navegador moderno (mismo valor)
//
// Como Vite procesa el CSS de cada componente .vue por SEPARADO, un componente que usa
// `var(--accent)` no "ve" el `:root` de style.css. `@csstools/postcss-global-data` inyecta
// ese `:root` en el contexto de cada archivo SOLO para resolución (no agrega código al output).
//
// `preserve: true` (default) = conserva el `var()` → cambio puramente ADITIVO. NO toca el JS
// (eso es plugin-legacy, Paso 1). Verificado: no hay theming dinámico (ningún setProperty).
import { fileURLToPath } from 'node:url';
import postcssGlobalData from '@csstools/postcss-global-data';
import postcssCustomProperties from 'postcss-custom-properties';

// Ruta absoluta al archivo con el bloque :root (robusto ante el cwd de ejecución).
const rootVarsFile = fileURLToPath(new URL('./src/style.css', import.meta.url));

export default {
  plugins: [
    // 1º inyecta el :root global para que TODOS los archivos puedan resolver los tokens.
    postcssGlobalData({ files: [rootVarsFile] }),
    // 2º agrega el valor fijo antes de cada var() (conservando el var() para navegadores modernos).
    postcssCustomProperties({ preserve: true }),
  ],
};
