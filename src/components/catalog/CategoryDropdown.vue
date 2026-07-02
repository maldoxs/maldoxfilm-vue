<script setup lang="ts">
/**
 * CategoryDropdown — selector de categorías estilo Netflix móvil: un botón
 * centrado "Categorías ▼" que despliega un menú vertical con los géneros.
 *
 * SOLO se usa en móvil (lo decide `GenreFilter` según `deviceStore.isMobile`).
 * Desktop y TV siguen con sus propios renders (barra de pills / TvGenreBar),
 * intactos. Mismo contrato que `GenreFilter`: `options` + `activeId` + `select`.
 */
import { ref, computed, onBeforeUnmount } from 'vue';
import type { GenreOption } from '../../services/catalog';

const props = defineProps<{
  options: GenreOption[];
  activeId: number;
}>();

const emit = defineEmits<{
  (e: 'select', id: number): void;
}>();

const open = ref(false);

const activeLabel = computed(
  () => props.options.find((o) => o.id === props.activeId)?.label ?? 'Categorías'
);

function toggle() {
  open.value = !open.value;
}

function close() {
  open.value = false;
}

function pick(id: number) {
  emit('select', id);
  close();
}

// Cerrar con la tecla Escape (por accesibilidad / teclados externos).
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') close();
}
if (typeof window !== 'undefined') window.addEventListener('keydown', onKey);
onBeforeUnmount(() => {
  if (typeof window !== 'undefined') window.removeEventListener('keydown', onKey);
});
</script>

<template>
  <div class="cat-dd">
    <button class="cat-dd-btn" :class="{ open }" @click="toggle">
      <span>{{ activeId === options[0]?.id ? 'Categorías' : activeLabel }}</span>
      <svg class="cat-dd-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>

    <!-- Overlay + menú -->
    <Teleport to="body">
      <div v-if="open" class="cat-dd-overlay" @click="close">
        <div class="cat-dd-menu" @click.stop>
          <button
            v-for="opt in options"
            :key="opt.id"
            class="cat-dd-item"
            :class="{ active: activeId === opt.id }"
            @click="pick(opt.id)"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.cat-dd {
  display: flex;
  justify-content: center;
  margin: 4px 0 16px;
}
.cat-dd-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: rgba(42, 42, 42, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.22);
  color: #fff;
  font-size: 0.9rem;
  font-weight: 600;
  padding: 7px 18px;
  border-radius: 20px;
  cursor: pointer;
}
.cat-dd-caret {
  width: 16px;
  height: 16px;
  transition: transform 0.2s ease;
}
.cat-dd-btn.open .cat-dd-caret {
  transform: rotate(180deg);
}

/* Overlay a pantalla completa — el menú baja desde arriba como Netflix. */
.cat-dd-overlay {
  position: fixed;
  inset: 0;
  z-index: 200;
  background: rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(2px);
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 96px;
}
.cat-dd-menu {
  /* Fallback Chromium 38 (LG webOS 3): sin min() → 360px acotado por max-width:78vw = min(78vw,360px). Moderno usa la línea min() de abajo. */
  width: 360px;
  max-width: 78vw;
  width: min(78vw, 360px);
  max-height: 70vh;
  overflow-y: auto;
  background: rgba(20, 20, 20, 0.98);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
  padding: 8px 0;
  box-shadow: 0 18px 50px rgba(0, 0, 0, 0.6);
  -webkit-overflow-scrolling: touch;
}
.cat-dd-item {
  display: block;
  width: 100%;
  text-align: left;
  background: none;
  border: none;
  color: rgba(240, 240, 240, 0.85);
  font-size: 1.05rem;
  padding: 13px 24px;
  cursor: pointer;
}
.cat-dd-item.active {
  color: #fff;
  font-weight: 700;
}
</style>
