<script setup lang="ts">
/**
 * SearchBar — el input de búsqueda con debounce de 400ms.
 *
 * Reemplaza `#searchInput` + `handleSearch`/`doSearchUnified` (líneas
 * ~2671-2676, ~7350-7361 y la variante TV `tvHandleSearch`/`openTvSearchBar`
 * ~6208-6275). El original hace `clearTimeout(window.searchTimeout)` +
 * `setTimeout(..., 400)` sobre una variable global y dispara la búsqueda +
 * navegación a la página de resultados directamente; aquí el componente solo
 * gestiona el debounce y emite `search`/`clear` — la vista padre (que conoce
 * el router y el cliente TMDB) decide qué hacer (`doSearchUnified` equivalente
 * vive en `SearchView.vue`, Fase 5).
 *
 * Se preserva:
 *   - el debounce EXACTO de 400ms (`SEARCH_DEBOUNCE_MS`, línea ~7350)
 *   - emitir "vacío" inmediatamente sin esperar el debounce (línea ~7351:
 *     `if(!val.trim()){ ...volver a home... ; return; }`)
 *   - Enter dispara la búsqueda al instante, cancelando el debounce pendiente
 */
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { SEARCH_DEBOUNCE_MS } from '../../services/catalog';

const props = defineProps<{
  placeholder?: string;
  /** Valor inicial (p.ej. al volver de resultados de búsqueda). */
  modelValue?: string;
  /** Enfocar el input al montar (p.ej. al abrir el overlay de búsqueda). */
  autofocus?: boolean;
}>();

const emit = defineEmits<{
  /** Disparado (con debounce de 400ms, o inmediato en Enter) con el query ya recortado (`trim()`). */
  (e: 'search', query: string): void;
  /** Disparado de inmediato cuando el input queda vacío — equivale a "volver a home" (línea ~7351). */
  (e: 'clear'): void;
  /** Disparado al presionar Enter (el original cierra el panel de búsqueda en ese momento). */
  (e: 'submit', query: string): void;
  (e: 'update:modelValue', value: string): void;
}>();

const value = ref(props.modelValue ?? '');
const inputRef = ref<HTMLInputElement | null>(null);
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

onMounted(() => {
  if (props.autofocus) inputRef.value?.focus();
});

function clearTimer() {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }
}

/** handleSearch — preservado de la línea ~7350-7353. */
function onInput() {
  emit('update:modelValue', value.value);
  clearTimer();

  const trimmed = value.value.trim();
  if (!trimmed) {
    emit('clear');
    return;
  }
  debounceTimer = setTimeout(() => {
    emit('search', trimmed);
  }, SEARCH_DEBOUNCE_MS);
}

/** Enter — busca de inmediato, sin esperar el debounce (comportamiento estándar de `<input type="search">`). */
function onEnter() {
  clearTimer();
  const trimmed = value.value.trim();
  if (trimmed) emit('search', trimmed);
  else emit('clear');
  emit('submit', trimmed); // el overlay de búsqueda se cierra en este momento (como el original)
}

onBeforeUnmount(clearTimer);
</script>

<template>
  <div class="search-bar">
    <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
    <input
      ref="inputRef"
      v-model="value"
      type="search"
      class="search-input"
      :placeholder="placeholder ?? 'Buscar título...'"
      autocomplete="off"
      @input="onInput"
      @keydown.enter="onEnter"
    />
  </div>
</template>

<style scoped>
/* Preservados de `#searchInput`/`.search-bar` (líneas ~2671-2676 y bloque de estilos asociado) */
.search-bar {
  position: relative;
  display: flex;
  align-items: center;
}
.search-icon {
  position: absolute;
  left: 12px;
  width: 16px;
  height: 16px;
  color: var(--text-muted, #9a9a9a);
  pointer-events: none;
}
.search-input {
  width: 100%;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 999px;
  color: var(--text, #f0f0f0);
  font-size: 0.8rem;
  padding: 8px 14px 8px 36px;
  outline: none;
  transition: background var(--trans, 0.25s ease), border-color var(--trans, 0.25s ease);
}
.search-input::placeholder {
  color: var(--text-muted, #9a9a9a);
}
.search-input:focus {
  background: rgba(255, 255, 255, 0.1);
  border-color: var(--accent, #3d5afe);
}
/* Oculta el ícono nativo de "limpiar" de Safari/Chrome para no duplicar con el propio diseño */
.search-input::-webkit-search-cancel-button {
  -webkit-appearance: none;
}
</style>
