// `defineConfig` se importa de `vitest/config` (no de `vite`): extiende
// `UserConfigExport` con la propiedad `test`, que `vue-tsc -b` rechaza
// (TS2769) si se usa la versión de `vite` a secas. Sigue produciendo la
// MISMA config de Vite — solo amplía el tipo para que el bloque `test:` tipe.
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue()],
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
