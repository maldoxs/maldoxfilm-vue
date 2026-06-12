<script setup lang="ts">
/**
 * ContinueWatching — la sección "Continuar viendo" del Inicio.
 *
 * Reemplaza `#continueSection` + `renderContinueWatching`/`buildContinueCard`/
 * `removeContinueItem`/`clearAllProgress` (índex.html líneas ~2711-2727 y
 * ~7484-7530). Preserva EXACTO:
 *   - filtro `pct>3 && pct<97`, orden por `ts` descendente, máximo 20 ítems
 *     (línea ~7487-7490),
 *   - el fetch en PARALELO de los detalles (poster) vía `Promise.allSettled`
 *     (el "[FIX 3]" del original, línea ~7498),
 *   - la tarjeta compacta con poster, título, subtítulo (`T1·E2` / `X% visto`),
 *     barra de progreso roja y botón ✕ para quitar,
 *   - el botón "Limpiar historial".
 * La sección NO se muestra si no hay ítems (preserva `if(!items.length) return`).
 */
import { ref, computed, onMounted } from 'vue';
import { useAppServices } from '../../composables/useAppServices';
import { useProgressStore } from '../../stores/progress';
import { useDeviceStore } from '../../stores/device';
import { buildPosterUrl, CAROUSEL_SCROLL_PX } from '../../services/catalog';
import type { ProgressEntry } from '../../services/progress';
import { progressKey } from '../../services/progress';
import type { MediaItem } from '../../types';

const emit = defineEmits<{
  (e: 'select', payload: { id: MediaItem['id']; type: 'movie' | 'tv' }): void;
}>();

const { tmdbClient } = useAppServices();
const progressStore = useProgressStore();
const deviceStore = useDeviceStore();

const LANG = 'es-ES';
const railRef = ref<HTMLElement | null>(null);

// Detalles (poster/título) cacheados por clave de progreso — se llenan al montar.
interface FetchedDetail {
  poster_path?: string | null;
  title?: string;
  name?: string;
}
const details = ref<Record<string, FetchedDetail>>({});

/** Ítems en progreso — preserva el filtro/orden/slice del original (líneas ~7487-7490). */
const progressItems = computed<ProgressEntry[]>(() =>
  Object.values(progressStore.all)
    .filter((p) => p.pct > 3 && p.pct < 97)
    .sort((a, b) => b.ts - a.ts)
    .slice(0, 20)
);

interface ContinueCard {
  key: string;
  id: string | number;
  type: 'movie' | 'tv';
  title: string;
  poster: string;
  sub: string;
  pct: number;
}

const cards = computed<ContinueCard[]>(() =>
  progressItems.value.map((p) => {
    const key = progressKey(p.id, p.type);
    const d = details.value[key];
    const title = d?.title || d?.name || p.title || '';
    const pct = Math.round(p.pct);
    const sub = p.type === 'tv' && p.season ? `T${p.season} · E${p.episode}` : `${pct}% visto`;
    return {
      key,
      id: p.id,
      type: p.type,
      title,
      poster: buildPosterUrl(d?.poster_path, deviceStore.isTV),
      sub,
      pct,
    };
  })
);

onMounted(async () => {
  // Fetch de detalles en PARALELO (preserva el "[FIX 3]" del original, línea ~7498).
  const results = await Promise.allSettled(
    progressItems.value.map((p) =>
      tmdbClient
        .get<FetchedDetail>(`/${p.type}/${p.id}?language=${LANG}`)
        .then((item) => ({ key: progressKey(p.id, p.type), item }))
    )
  );
  const next: Record<string, FetchedDetail> = {};
  for (const r of results) {
    if (r.status === 'fulfilled') next[r.value.key] = r.value.item;
  }
  details.value = next;
});

function scroll(direction: -1 | 1) {
  railRef.value?.scrollBy({ left: direction * CAROUSEL_SCROLL_PX, behavior: 'smooth' });
}

function onSelect(c: ContinueCard) {
  emit('select', { id: c.id, type: c.type });
}

/** removeContinueItem — preserva línea ~7524: quita el ítem del historial. */
function removeCard(c: ContinueCard) {
  progressStore.remove(c.id, c.type);
}

/** clearAllProgress — preserva el botón "Limpiar historial" (línea ~2717). */
function clearHistory() {
  progressStore.clearAll();
}
</script>

<template>
  <div v-if="cards.length" class="continue-section">
    <div class="section-header">
      <div class="section-title">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--red)" stroke-width="2.5">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
        Continuar viendo
      </div>
      <button class="see-all-btn" @click="clearHistory">Limpiar historial</button>
    </div>
    <div class="carousel-wrapper">
      <button class="carousel-arrow prev" aria-label="Anterior" @click="scroll(-1)">‹</button>
      <div ref="railRef" class="continue-carousel">
        <div v-for="c in cards" :key="c.key" class="continue-card" @click="onSelect(c)">
          <img v-if="c.poster" :src="c.poster" :alt="c.title" loading="lazy" decoding="async" />
          <div v-else class="continue-card-fallback">{{ c.title }}</div>
          <button class="continue-card-remove" title="Quitar" @click.stop="removeCard(c)">✕</button>
          <div class="continue-card-overlay">
            <div class="continue-card-title">{{ c.title }}</div>
            <div class="continue-card-sub">{{ c.sub }}</div>
            <div class="continue-card-bar"><div class="continue-card-fill" :style="{ width: c.pct + '%' }"></div></div>
          </div>
        </div>
      </div>
      <button class="carousel-arrow next" aria-label="Siguiente" @click="scroll(1)">›</button>
    </div>
  </div>
</template>

<style scoped>
/* Preservados de `#continueSection`/`.continue-*` (índex.html líneas ~583-616). */
.continue-section {
  margin-bottom: 8px;
}
.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 52px;
  margin-bottom: 10px;
}
.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 1.15rem;
  font-weight: 700;
  color: #fff;
}
.see-all-btn {
  background: none;
  border: none;
  color: var(--text-muted, #9a9a9a);
  font-size: 0.78rem;
  cursor: pointer;
  transition: color var(--trans, 0.25s ease);
}
.see-all-btn:hover {
  color: #fff;
}
.carousel-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}
.continue-carousel {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: 155px;
  gap: 8px;
  overflow-x: auto;
  /* Evita el scroll vertical atrapado (ver nota en Carousel.vue). */
  overflow-y: hidden;
  scroll-behavior: smooth;
  padding: 14px 52px;
  scrollbar-width: none;
}
.continue-carousel::-webkit-scrollbar {
  display: none;
}
.continue-card {
  cursor: pointer;
  position: relative;
  border-radius: var(--radius, 5px);
  overflow: hidden;
  aspect-ratio: 2 / 3;
  width: 155px;
  background: var(--surface, #1c1c1c);
  transition: transform var(--trans, 0.25s ease), box-shadow var(--trans, 0.25s ease);
}
.continue-card:hover {
  transform: scale(1.05) translateY(-4px);
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(61, 90, 254, 0.2);
  z-index: 10;
}
.continue-card img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  display: block;
}
.continue-card-fallback {
  width: 100%;
  height: 100%;
  background: var(--surface2, #252525);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.7rem;
  text-align: center;
  padding: 8px;
  color: var(--text-dim, #555);
}
.continue-card-overlay {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: linear-gradient(0deg, rgba(14, 14, 14, 0.98) 0%, transparent 60%);
  padding: 28px 7px 7px;
}
.continue-card-title {
  font-size: 0.67rem;
  font-weight: 600;
  line-height: 1.3;
  margin-bottom: 4px;
  color: #fff;
}
.continue-card-sub {
  font-size: 0.58rem;
  color: var(--text-muted, #9a9a9a);
  margin-bottom: 5px;
}
.continue-card-bar {
  height: 3px;
  background: rgba(255, 255, 255, 0.18);
  border-radius: 2px;
  overflow: hidden;
}
.continue-card-fill {
  height: 100%;
  background: var(--red, #e05c3a);
  border-radius: 2px;
}
.continue-card-remove {
  position: absolute;
  top: 5px;
  right: 5px;
  z-index: 5;
  background: rgba(0, 0, 0, 0.7);
  border: 1px solid rgba(255, 255, 255, 0.2);
  color: #fff;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.6rem;
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--trans, 0.25s ease);
}
.continue-card:hover .continue-card-remove {
  opacity: 1;
}
.carousel-arrow {
  position: absolute;
  z-index: 5;
  top: 0;
  bottom: 0;
  width: 44px;
  border: none;
  background: linear-gradient(to right, rgba(14, 14, 14, 0.85), transparent);
  color: #fff;
  font-size: 1.6rem;
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--trans, 0.25s ease);
}
.carousel-wrapper:hover .carousel-arrow {
  opacity: 1;
}
.carousel-arrow.prev {
  left: 0;
}
.carousel-arrow.next {
  right: 0;
  background: linear-gradient(to left, rgba(14, 14, 14, 0.85), transparent);
}
</style>
