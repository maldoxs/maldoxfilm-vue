// `defineConfig` se importa de `vitest/config` (no de `vite`): extiende
// `UserConfigExport` con la propiedad `test`, que `vue-tsc -b` rechaza
// (TS2769) si se usa la versión de `vite` a secas. Sigue produciendo la
// MISMA config de Vite — solo amplía el tipo para que el bloque `test:` tipe.
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import legacy from '@vitejs/plugin-legacy'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    vue(),
    // ── Compatibilidad con TVs/navegadores viejos (LG webOS 3 = Chromium 38, p.ej. UH8500) ──
    // Genera un SEGUNDO bundle "legacy" transpilado a ES5 + polyfills (core-js). El navegador
    // moderno carga el bundle moderno (`<script type=module>`); el viejo lo ignora y carga el
    // legacy vía `nomodule` + SystemJS. Cada dispositivo elige SOLO. No hay lógica por modelo:
    // se targetea un PISO (Chromium 38) y todo lo que esté por encima queda cubierto.
    // ⚠️ SOLO afecta el build de producción (`vite build`) — NO toca `vite dev`/`netlify dev`
    // ni el CSS (eso es un paso aparte). Es puramente aditivo.
    legacy({
      targets: ['chrome >= 38', 'safari >= 9', 'ios_saf >= 9', 'firefox >= 40'],
    }),
  ],
  server: {
    // Puerto FIJO (strictPort) para que `netlify dev` (netlify.toml → targetPort
    // 5173) siempre encuentre a Vite. Sin esto, si el 5173 estuviera ocupado
    // Vite saltaría al 5174 y Netlify proxearía un puerto equivocado.
    port: 5173,
    strictPort: true,
  },
  test: {
    // jsdom — necesario para los stores/servicios que tocan localStorage,
    // document.documentElement, navigator, etc. (device, myList, subtitles overlay...)
    environment: 'jsdom',
  },
})
