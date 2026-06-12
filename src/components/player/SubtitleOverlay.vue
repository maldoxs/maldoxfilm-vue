<script setup lang="ts">
/**
 * SubtitleOverlay — el overlay reactivo de subtítulos (Fase 4 del plan:
 * "SubtitleOverlay.vue — los subtítulos, ahora reactivo").
 *
 * Reemplaza `_injectSubtitle`/`_ensureSubOverlay`/`_subTimeUpdate` (líneas
 * ~5117-5190 de assets/index.html) — el bloque MÁS retorcido del original:
 * ese código tenía que MOVER el `<div id="subOverlay">` entre `document.body`
 * (position:fixed) y el elemento en fullscreen (position:absolute) cada vez
 * que cambiaba el estado de fullscreen, porque un overlay fuera del árbol
 * del elemento fullscreen queda invisible (limitación del Fullscreen API).
 *
 * GANANCIA REAL: en Vue, `<VideoPlayer>` (que contiene este overlay) ES el
 * elemento que entra en fullscreen (vía `useFullscreen` → `#playerPage`).
 * Como el overlay SIEMPRE vive dentro de ese contenedor en el árbol del DOM
 * — fullscreen o no — el truco de "reubicar y cambiar position:fixed↔absolute"
 * deja de ser necesario: con `position:absolute` sobre el contenedor
 * `position:relative` alcanza en AMBOS casos. `_ensureSubOverlay` (30 líneas
 * de lógica DOM) se reemplaza por una sola regla CSS.
 *
 * El render del cue (antes `curBox.innerHTML = '<span style=...>' + ...`)
 * se reemplaza por interpolación reactiva de `activeCueText`.
 *
 * ⚠️ SEGURIDAD — XSS: el texto del cue viene de archivos .srt descargados de
 * OpenSubtitles (red no confiable). El original (y una versión intermedia de
 * este componente) volcaba ese texto vía `innerHTML`/`v-html` tras un
 * "saneo" por regex (`<[^>]+>` en `parseSrt`) — el sanitizado de HTML por
 * regex es un anti-patrón documentado por OWASP (vulnerable a "mutation
 * XSS"/diferencias de parseo). Aquí se usa interpolación de texto plano
 * (`{{ text }}`) — Vue escapa automáticamente cualquier carácter especial —
 * y los saltos de línea se preservan con `white-space: pre-line` (CSS puro,
 * sin tocar `innerHTML`). Cero superficie de inyección, mismo resultado visual.
 */
defineProps<{
  /** Texto plano del cue activo (puede contener '\n' — se renderiza con `white-space: pre-line`), o '' si no hay. */
  text: string;
  /** ¿Subtítulos activados? Si es false, no se renderiza nada (preserva el check `!_subsEnabled`). */
  enabled: boolean;
}>();
</script>

<template>
  <div v-if="enabled && text" class="sub-overlay" aria-live="polite">
    <span class="sub-overlay-text">{{ text }}</span>
  </div>
</template>

<style scoped>
/* Posición/tipografía preservadas EXACTO de `_subCssFixed`/`_subCssAbs` y el
   `<span style="...">` inline del cue (líneas ~5126-5127, ~5182). */
.sub-overlay {
  position: absolute;
  bottom: 90px;
  left: 0;
  right: 0;
  text-align: center;
  pointer-events: none;
  z-index: 50;
  padding: 0 6%;
}
.sub-overlay-text {
  color: #fff;
  font-size: 1.8rem;
  font-weight: 700;
  line-height: 1.6;
  display: inline-block;
  white-space: pre-line; /* renderiza '\n' como salto de línea sin inyectar <br> */
  text-shadow:
    0 0 6px #000,
    0 2px 6px #000,
    0 -2px 6px #000,
    2px 0 6px #000,
    -2px 0 6px #000,
    0 3px 12px rgba(0, 0, 0, 0.9);
}

@media (max-width: 640px) {
  .sub-overlay-text {
    font-size: 1.25rem;
  }
}
</style>
