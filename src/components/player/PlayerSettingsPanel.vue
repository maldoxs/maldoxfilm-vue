<script setup lang="ts">
/**
 * PlayerSettingsPanel — el panel "⚙️" estilo Netflix con 2 vistas
 * (Audio+Subtítulos / Velocidad), anclado a los botones `#nfCCBtn`/`#nfSpeedBtn`
 * de la barra de controles custom.
 *
 * Reemplaza `#playerSettingsPanel` + `_spInit`/`_spUpdateSubRows`/`spSwitchAudio`/
 * `spSetSpeed`/`spSetSubs` (líneas ~3613-3673, ~4213-4459 de assets/index.html).
 *
 * Lo que NO vive aquí (preservado en otros lugares, evitando duplicar lógica):
 *   - El estado de offset/sincronización de subtítulos y su indicador de status
 *     ("🔍 Buscando.../✅ ES | offset: ...") → `<SubtitleControls>` ya los
 *     consolidó (línea ~3586-3588 + `#spOffsetRow`, ~3637-3647) — aquí solo
 *     se decide ON/OFF (`spSetSubs`), igual que las filas `#spSubRows`.
 *   - El cambio de pista DASH en sí (`_shakaLoad`/prewarm/watchdogs) → vive en
 *     `usePlayer.switchAudioTrack` — este panel solo expone las filas y delega.
 *   - Abrir/cerrar/anclar el panel (hover-intent `_nfWireHover`/`nfShowPanel`/
 *     `nfHidePanelDelayed`) → vive en `<VideoPlayer>`, junto a los botones
 *     `#nfCCBtn`/`#nfSpeedBtn` que lo disparan (mismo lugar que en el original).
 *
 * Preserva los 3 casos EXACTOS de `_spInit` (líneas ~4213-4277):
 *   Caso 1 — Solo español (`hasNativeSpanish && !spanishTrack`): fila única
 *            "Español" sin alternativa, sin onclick (direct-play mono-idioma).
 *   Caso 2 — Dual (`hasNativeSpanish && spanishTrack`): "Español/Latino" +
 *            "Inglés [Original]", ambas con `switchAudioTrack`; subtítulos
 *            arrancan OFF pero con alternativa "Español" disponible.
 *   Caso 3 — Solo inglés (`!hasNativeSpanish`): "Inglés [Original]" (+ "Español"
 *            si se detectó `spanishTrack`); subtítulos arrancan ON sin alternativa.
 *
 * Y preserva el "toggle de doble etiqueta" de `_spUpdateSubRows` (líneas
 * ~4304-4321): EN AMBOS estados (on/off) las 2 filas visibles llaman al MISMO
 * `spSetSubs(!subsOn)` — es decir, cualquiera de las 2 filas alterna el estado
 * (un detalle "raro" del original que se preserva tal cual, no se "corrige").
 */
import { computed } from 'vue';
import { useToast } from '../../composables/useToast';
import { SPEEDS } from '../../composables/useNetflixControls';

const props = defineProps<{
  /** ¿Panel visible? (preserva `#playerSettingsPanel.open`). */
  open: boolean;
  /** Vista activa — preserva `panel.dataset.mode` ('audiosubs'/'speed'). */
  mode: 'audiosubs' | 'speed';
  /** ¿El audio nativo del stream ya está en español? (`_hasNativeSpanish`/`_hasSpaDirect`). */
  hasNativeSpanish: boolean;
  /** Pista en español detectada en el manifest DASH, o `null` si no aplica (`_rdSpanishTrack`). */
  spanishTrack: string | null;
  /** Pista de audio activa actualmente (`_rdActiveTrack`, p.ej. 'eng1'/'spa1'/'lat1'). */
  activeTrack: string;
  /** ¿Hay manifest DASH cargado? Sin él, `switchAudioTrack` no puede hacer nada (preserva el guard de `spSwitchAudio`: `if(!_rdDashBase...) return`). */
  canSwitchAudio: boolean;
  /** ¿Subtítulos activos? (`_subsEnabled`). */
  subsEnabled: boolean;
  /** Offset de sincronización de subtítulos en ms (`_subOffsetMs`) — para `#spOffsetDisplay`. */
  offsetMs: number;
  /** Velocidad de reproducción activa — uno de {@link SPEEDS} (`_playerSpeed`). */
  speed: number;
}>();

const emit = defineEmits<{
  (e: 'switch-audio', track: string): void;
  (e: 'toggle-subs'): void;
  (e: 'adjust-offset', deltaMs: number): void;
  (e: 'reset-offset'): void;
  (e: 'set-speed', value: number): void;
  (e: 'mouseenter'): void;
  (e: 'mouseleave'): void;
}>();

const { show: showToast } = useToast();

// "Español Latino" vs "Español" — preserva la línea ~4216-4218.
const spaLabel = computed(() => (props.spanishTrack?.startsWith('lat') ? 'Español Latino' : 'Español'));

// Etiqueta del offset "+1.0s"/"-5.0s"/"0s" — preserva `#spOffsetDisplay`
// (línea ~3639) y el formato de `_adjustSubOffset` (líneas ~5195-5196).
const offsetLabel = computed(() => {
  if (props.offsetMs === 0) return '0s';
  const sign = props.offsetMs > 0 ? '+' : '';
  return sign + (props.offsetMs / 1000).toFixed(1) + 's';
});

interface AudioRow {
  key: string;
  label: string;
  selected: boolean;
  /** `null` → fila no clicable (Caso 1: direct-play mono-idioma, sin manifest DASH que cambiar). */
  track: string | null;
}

/**
 * audioRows — preserva los 3 casos de `_spInit` (líneas ~4233-4251).
 * Caso 2 (dual): Español/Latino primero (es el que se reproduce por defecto),
 * separador, Inglés [Original]. Caso 1: única fila Español sin onclick. Caso 3:
 * Inglés primero, + Español si se detectó `spanishTrack` (raro pero preservado).
 */
const audioRows = computed<AudioRow[]>(() => {
  const { hasNativeSpanish, spanishTrack, activeTrack } = props;
  if (hasNativeSpanish && spanishTrack) {
    return [
      { key: 'spa', label: spaLabel.value, selected: activeTrack === spanishTrack, track: spanishTrack },
      { key: 'eng', label: 'Inglés [Original]', selected: activeTrack === 'eng1', track: 'eng1' },
    ];
  }
  if (hasNativeSpanish) {
    return [{ key: 'spa', label: spaLabel.value, selected: true, track: null }];
  }
  const rows: AudioRow[] = [{ key: 'eng', label: 'Inglés [Original]', selected: activeTrack === 'eng1', track: 'eng1' }];
  if (spanishTrack) rows.push({ key: 'spa', label: spaLabel.value, selected: activeTrack === spanishTrack, track: spanishTrack });
  return rows;
});

/** _spShowSubAlt — Caso 2 (dual) es el ÚNICO que muestra la 2ª opción de subtítulos (línea ~4263-4264). */
const showSubAlt = computed(() => props.hasNativeSpanish && !!props.spanishTrack);

interface SubRow {
  key: string;
  label: string;
  selected: boolean;
}

/**
 * subRows — preserva `_spUpdateSubRows` (líneas ~4304-4321): en ambos estados
 * las filas visibles disparan el MISMO toggle (ver nota de cabecera).
 */
const subRows = computed<SubRow[]>(() => {
  if (!props.subsEnabled) {
    const rows: SubRow[] = [{ key: 'off', label: 'Desactivados', selected: true }];
    if (showSubAlt.value) rows.push({ key: 'on', label: 'Español', selected: false });
    return rows;
  }
  const rows: SubRow[] = [{ key: 'on', label: 'Español', selected: true }];
  if (showSubAlt.value) rows.push({ key: 'off', label: 'Desactivados', selected: false });
  return rows;
});

function onAudioRowClick(row: AudioRow) {
  // Caso 1 (track === null): fila no clicable — direct-play mono-idioma, sin DASH (línea ~4243: sin onclick).
  if (row.track === null) return;
  if (!props.canSwitchAudio || row.track === props.activeTrack) return;
  emit('switch-audio', row.track);
}

function onSubRowClick() {
  emit('toggle-subs');
}

// ── Velocidad — preserva `spSetSpeed` (líneas ~4429-4441): índice dentro de
// SPEEDS determina qué dot/label se marca activo y el % de la barra de relleno. ──
const speedIdx = computed(() => SPEEDS.indexOf(props.speed as (typeof SPEEDS)[number]));
const speedFillPct = computed(() => (speedIdx.value >= 0 ? (speedIdx.value / (SPEEDS.length - 1)) * 100 : 40));

function onSetSpeed(value: number) {
  emit('set-speed', value);
  showToast('⏩ ' + value + 'x'); // preserva el toast de `spSetSpeed` (línea ~4440), salvo el caso `silent` (reset interno, ver useNetflixControls.attach)
}
</script>

<template>
  <div
    class="player-settings-panel"
    :class="{ open }"
    @mouseenter="emit('mouseenter')"
    @mouseleave="emit('mouseleave')"
    @click.stop
  >
    <!-- Vista: Audio + Subtítulos (preserva `#nfPanelAudioSubs`, líneas ~3615-3650) -->
    <div v-if="mode === 'audiosubs'" class="nf-panel-cols">
      <div class="nf-panel-col">
        <div class="nf-panel-colhead">Audio</div>
        <div>
          <template v-for="(row, i) in audioRows" :key="row.key">
            <div v-if="i > 0" class="sp-sep"></div>
            <button
              class="sp-row"
              :class="{ selected: row.selected, 'sp-row-disabled': row.track === null }"
              @click="onAudioRowClick(row)"
            >
              <svg class="sp-check" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><polyline points="20 6 9 17 4 12" /></svg>
              <span class="sp-row-label">{{ row.label }}</span>
            </button>
          </template>
        </div>
      </div>
      <div class="nf-panel-col-divider"></div>
      <div class="nf-panel-col">
        <div class="nf-panel-colhead">Subtítulos</div>
        <div>
          <template v-for="(row, i) in subRows" :key="row.key">
            <div v-if="i > 0" class="sp-sep"></div>
            <button class="sp-row" :class="{ selected: row.selected }" @click="onSubRowClick">
              <svg class="sp-check" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.5"><polyline points="20 6 9 17 4 12" /></svg>
              <span class="sp-row-label">{{ row.label }}</span>
            </button>
          </template>

          <!-- Offset sincronización — preserva `#spOffsetRow` (líneas ~3637-3648):
               vive DENTRO del panel ⚙️ y solo se muestra cuando los subtítulos
               están activos (en el original era `display:none` hasta `subsOn`). -->
          <div v-if="subsEnabled" class="sp-offset-row">
            <div class="sp-offset-head">
              Sincronización · <span class="sp-offset-display">{{ offsetLabel }}</span>
            </div>
            <div class="sp-offset-btns">
              <button class="sp-offset-btn" @click="emit('adjust-offset', -5000)">−5s</button>
              <button class="sp-offset-btn" @click="emit('adjust-offset', -1000)">−1s</button>
              <button class="sp-offset-btn sp-offset-reset" @click="emit('reset-offset')">reset</button>
              <button class="sp-offset-btn" @click="emit('adjust-offset', 1000)">+1s</button>
              <button class="sp-offset-btn" @click="emit('adjust-offset', 5000)">+5s</button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Vista: Velocidad (preserva `#nfPanelSpeed`, líneas ~3653-3672) -->
    <div v-else class="nf-panel-speed">
      <div class="nf-panel-speed-title">Velocidad de reproducción</div>
      <div class="nf-speed-track">
        <div class="nf-speed-fill" :style="{ width: speedFillPct + '%' }"></div>
        <div class="nf-speed-dots">
          <button
            v-for="(s, i) in SPEEDS"
            :key="'dot-' + s"
            class="nf-speed-dot"
            :class="{ active: i === speedIdx }"
            @click="onSetSpeed(s)"
          ></button>
        </div>
      </div>
      <div class="nf-speed-labels">
        <button
          v-for="(s, i) in SPEEDS"
          :key="'lbl-' + s"
          class="nf-speed-lbl"
          :class="{ active: i === speedIdx }"
          @click="onSetSpeed(s)"
        >
          {{ s }}x<br v-if="s === 1" /><span v-if="s === 1" style="font-size: 0.6rem; opacity: 0.6">(Normal)</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Preservados de `#playerSettingsPanel`/`.nf-panel-*`/`.sp-*` (líneas ~1147-1213) */
.player-settings-panel {
  display: none;
  position: absolute;
  bottom: 64px;
  right: 12px;
  z-index: 800;
  background: rgba(20, 20, 20, 0.97);
  border-radius: 6px;
  width: 360px;
  overflow: hidden;
  box-shadow: 0 4px 40px rgba(0, 0, 0, 0.95);
  border: 1px solid rgba(255, 255, 255, 0.1);
  font-family: 'Roboto', sans-serif;
}
.player-settings-panel.open {
  display: block;
  animation: spFadeIn 0.18s ease;
}
@keyframes spFadeIn {
  from {
    opacity: 0;
    transform: translateY(6px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.nf-panel-cols {
  display: flex;
}
.nf-panel-col {
  flex: 1;
  padding: 20px 0 8px;
}
.nf-panel-col-divider {
  width: 1px;
  background: rgba(255, 255, 255, 0.1);
  margin: 16px 0;
}
.nf-panel-colhead {
  font-size: 1rem;
  font-weight: 700;
  color: #fff;
  padding: 0 28px 14px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  margin-bottom: 6px;
}
.sp-row {
  display: flex;
  align-items: center;
  padding: 11px 28px;
  gap: 12px;
  font-size: 0.9rem;
  color: rgba(255, 255, 255, 0.6);
  border: none;
  background: none;
  width: 100%;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s;
}
.sp-row:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #fff;
}
.sp-row.selected {
  color: #fff;
  font-weight: 500;
}
.sp-row.sp-row-disabled {
  cursor: default;
}
.sp-check {
  width: 18px;
  height: 18px;
  flex-shrink: 0;
  opacity: 0;
}
.sp-row.selected .sp-check {
  opacity: 1;
}
.sp-row-label {
  flex: 1;
  white-space: nowrap; /* "Inglés [Original]" en UNA línea (al lado del check, no debajo) */
}
.sp-sep {
  height: 1px;
  background: rgba(255, 255, 255, 0.07);
  margin: 4px 0;
}

/* Offset sincronización — preserva `#spOffsetRow` + `.sp-offset-btn` (líneas ~3637-3648, ~1274-1281) */
.sp-offset-head {
  font-size: 0.62rem;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: rgba(255, 255, 255, 0.4);
  padding: 12px 28px 8px;
}
.sp-offset-display {
  color: #3d5afe;
}
.sp-offset-btns {
  display: flex;
  gap: 5px;
  padding: 0 16px 16px;
  justify-content: center; /* sincronización centrada, no cortada */
  flex-wrap: wrap;
}

/* ── TV: panel más ancho para que el audio no se corte y la sincronización entre ── */
:global(html.tv-mode) .player-settings-panel {
  width: 560px;
}
:global(html.tv-mode) .sp-row {
  font-size: 1rem;
  padding: 13px 28px;
}
:global(html.tv-mode) .sp-offset-btn {
  font-size: 0.82rem;
  padding: 8px 13px;
}
.sp-offset-btn {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 5px;
  color: #fff;
  padding: 6px 10px;
  font-size: 0.72rem;
  cursor: pointer;
  transition: background 0.25s ease, border-color 0.25s ease;
}
.sp-offset-btn:hover {
  background: rgba(255, 255, 255, 0.16);
  border-color: rgba(255, 255, 255, 0.25);
}
.sp-offset-reset {
  color: rgba(255, 255, 255, 0.45);
  font-weight: 400;
}
.sp-offset-reset:hover {
  color: #fff;
}

.nf-panel-speed {
  padding: 22px 28px 26px;
}
.nf-panel-speed-title {
  font-size: 0.7rem;
  color: rgba(255, 255, 255, 0.4);
  text-transform: uppercase;
  letter-spacing: 1px;
  margin-bottom: 18px;
}
.nf-speed-track {
  position: relative;
  height: 2px;
  background: rgba(255, 255, 255, 0.18);
  border-radius: 2px;
  margin: 0 6px 12px;
}
.nf-speed-fill {
  position: absolute;
  left: 0;
  top: 0;
  height: 100%;
  background: #fff;
  border-radius: 2px;
  transition: width 0.2s;
}
.nf-speed-dots {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 100%;
  display: flex;
  justify-content: space-between;
  pointer-events: none;
}
.nf-speed-dot {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.35);
  border: none;
  cursor: pointer;
  pointer-events: all;
  transition: all 0.15s;
}
.nf-speed-dot.active {
  background: #fff;
  width: 15px;
  height: 15px;
  box-shadow: 0 0 0 3px rgba(255, 255, 255, 0.2);
}
.nf-speed-labels {
  display: flex;
  justify-content: space-between;
  padding: 0 2px;
}
.nf-speed-lbl {
  font-size: 0.73rem;
  color: rgba(255, 255, 255, 0.4);
  cursor: pointer;
  background: none;
  border: none;
  flex: 1;
  text-align: center;
  line-height: 1.4;
  transition: color 0.15s;
  padding: 4px 0;
}
.nf-speed-lbl.active {
  color: #fff;
  font-weight: 600;
}
</style>
