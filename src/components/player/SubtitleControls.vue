<script setup lang="ts">
/**
 * SubtitleControls — los botones de ajuste de offset (-5s/+1s/reset/...) y
 * el indicador de estado ("🔍 Buscando..."/"✅ ES | offset: +1.0s").
 *
 * Reemplaza dos cosas del original:
 *   1. `<div id="subControls">` + `<span id="subStatus">` (línea ~3586-3588)
 *   2. el panel de ajustes ⚙️ → fila `#spOffsetRow` con sus 5 botones
 *      `.sp-offset-btn` (líneas ~3637-3647) y `_adjustSubOffset`/
 *      `_renderSubStatus` (líneas ~5192-5224)
 *
 * Se preservan los 5 deltas EXACTOS (−5000/−1000/reset/+1000/+5000 ms) y el
 * toast "Subtítulos: <label>" que confirma cada ajuste — el composable
 * `useSubtitles` ya hace el toast vía `status`; aquí solo se muestra el
 * estado y se delega el ajuste.
 */
import { computed } from 'vue';
import { useToast } from '../../composables/useToast';

const props = defineProps<{
  status: string;
  offsetMs: number;
  /** ¿Hay subtítulos cargados? Si no, los botones quedan deshabilitados. */
  hasSubtitles: boolean;
}>();

const emit = defineEmits<{
  (e: 'adjust', deltaMs: number): void;
  (e: 'reset'): void;
}>();

const { show: showToast } = useToast();

// Etiqueta "+1.0s"/"-5.0s" — preservada de la línea ~5195-5196:
//   sign = _subOffsetMs >= 0 ? '+' : ''; label = sign + (offset/1000).toFixed(1) + 's'
const offsetLabel = computed(() => {
  const sign = props.offsetMs >= 0 ? '+' : '';
  return sign + (props.offsetMs / 1000).toFixed(1) + 's';
});

function adjust(deltaMs: number) {
  if (!props.hasSubtitles) {
    showToast('Sin subtítulos cargados'); // línea ~5193
    return;
  }
  emit('adjust', deltaMs);
  showToast('Subtítulos: ' + offsetLabel.value); // línea ~5198 (label post-ajuste, igual que el original)
}

function reset() {
  if (!props.hasSubtitles) {
    showToast('Sin subtítulos cargados');
    return;
  }
  emit('reset');
  showToast('Subtítulos: +0.0s');
}
</script>

<template>
  <div class="sub-controls">
    <span class="sub-status">{{ status || '—' }}</span>
    <div class="sub-offset-row">
      <span class="sub-offset-label">
        Sincronización · <strong class="sub-offset-value">{{ offsetLabel }}</strong>
      </span>
      <div class="sub-offset-btns">
        <button class="sub-offset-btn" :disabled="!hasSubtitles" @click="adjust(-5000)">−5s</button>
        <button class="sub-offset-btn" :disabled="!hasSubtitles" @click="adjust(-1000)">−1s</button>
        <button class="sub-offset-btn sub-offset-reset" :disabled="!hasSubtitles" @click="reset">reset</button>
        <button class="sub-offset-btn" :disabled="!hasSubtitles" @click="adjust(1000)">+1s</button>
        <button class="sub-offset-btn" :disabled="!hasSubtitles" @click="adjust(5000)">+5s</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Preservados de `#subControls`/`#subStatus` (línea ~3586) y `.sp-offset-btn` (líneas ~1205-1210) */
.sub-controls {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  font-size: 0.7rem;
}
.sub-status {
  color: var(--text-muted, #aaa);
}
.sub-offset-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.sub-offset-label {
  font-size: 0.62rem;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: rgba(255, 255, 255, 0.4);
}
.sub-offset-value {
  color: var(--accent, #3d5afe);
}
.sub-offset-btns {
  display: flex;
  gap: 5px;
}
.sub-offset-btn {
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: var(--radius, 5px);
  color: #fff;
  padding: 6px 10px;
  font-size: 0.72rem;
  cursor: pointer;
  transition: background var(--trans, 0.25s ease), border-color var(--trans, 0.25s ease);
}
.sub-offset-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.16);
  border-color: rgba(255, 255, 255, 0.25);
}
.sub-offset-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.sub-offset-reset {
  font-weight: 600;
}
</style>
