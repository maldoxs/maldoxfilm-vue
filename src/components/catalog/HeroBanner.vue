<script setup lang="ts">
/**
 * HeroBanner — el banner rotativo del Inicio (preserva `#hero` +
 * `loadHero`/`renderHero`/`jumpHero`, índex.html líneas ~2689-2695,
 * ~6088-6153). Rota entre los 8 primeros de `/trending/movie/day` cada 7s,
 * mostrando backdrop, título, rating/año/tipo, sinopsis y botones
 * Reproducir / Más Info (ambos van al detalle, como el original).
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { useAppServices } from '../../composables/useAppServices';
import { TMDB_IMG_BASE } from '../../services/catalog';
import type { MediaItem } from '../../types';

const { tmdbClient } = useAppServices();
const router = useRouter();
const LANG = 'es-ES';

const items = ref<MediaItem[]>([]);
const index = ref(0);
let timer: ReturnType<typeof setInterval> | null = null;

const current = computed<MediaItem | null>(() => items.value[index.value] ?? null);

const backdropUrl = computed(() => {
  const bp = (current.value as { backdrop_path?: string | null } | null)?.backdrop_path;
  return bp ? `${TMDB_IMG_BASE}original${bp}` : '';
});
const heroTitle = computed(() => current.value?.title || current.value?.name || '');
const heroYear = computed(() => (current.value?.release_date || current.value?.first_air_date || '').slice(0, 4));
const heroRating = computed(() => (current.value?.vote_average ? current.value.vote_average.toFixed(1) : ''));
const heroType = computed<'movie' | 'tv'>(() => (current.value?.media_type === 'tv' ? 'tv' : 'movie'));
const heroOverview = computed(() => (current.value as { overview?: string } | null)?.overview || '');

function startRotation() {
  if (timer) clearInterval(timer);
  timer = setInterval(() => {
    if (items.value.length) index.value = (index.value + 1) % items.value.length;
  }, 7000); // preserva el intervalo de 7s del original (línea ~6095)
}

onMounted(async () => {
  try {
    const d = await tmdbClient.get<{ results: MediaItem[] }>(`/trending/movie/day?language=${LANG}`);
    items.value = (d.results || []).slice(0, 8);
    index.value = 0;
    startRotation();
  } catch {
    /* silenciar — el original muestra un error inline; aquí el hero queda vacío */
  }
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});

function goToDetail() {
  const item = current.value;
  if (!item) return;
  router.push(heroType.value === 'tv' ? `/serie/${item.id}/1/1` : `/pelicula/${item.id}`);
}
</script>

<template>
  <div v-if="current" class="hero">
    <div class="hero-bg" :style="{ backgroundImage: backdropUrl ? `url(${backdropUrl})` : 'none' }"></div>
    <div :key="index" class="hero-content">
      <div class="hero-badge">Tendencia</div>
      <div class="hero-title">{{ heroTitle }}</div>
      <div class="hero-meta">
        <div class="hero-rating">★ {{ heroRating }}</div>
        <div class="hero-dot"></div>
        <span>{{ heroYear }}</span>
        <div class="hero-dot"></div>
        <span class="hero-type-badge">{{ heroType === 'tv' ? 'Serie' : 'Película' }}</span>
      </div>
      <div class="hero-overview">{{ heroOverview }}</div>
      <div class="hero-actions">
        <button class="btn-play" @click="goToDetail">▶ Reproducir</button>
        <button class="btn-info" @click="goToDetail">+ Mi Lista</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Preservados de `.hero*`/`.btn-play`/`.btn-info` (índex.html líneas ~243-327). */
.hero {
  position: relative;
  height: 80vh;
  min-height: 480px;
  display: flex;
  align-items: center;
  padding: 0 60px;
  overflow: hidden;
}
.hero-bg {
  position: absolute;
  inset: 0;
  background-size: cover;
  background-position: center;
  transition: opacity 0.5s ease;
  will-change: opacity;
}
.hero-bg::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, rgba(14, 14, 14, 0.95) 0%, rgba(14, 14, 14, 0.7) 45%, rgba(14, 14, 14, 0.1) 75%, transparent 100%),
    linear-gradient(0deg, rgba(14, 14, 14, 0.8) 0%, transparent 40%);
}
.hero-content {
  position: relative;
  z-index: 2;
  max-width: 560px;
  animation: heroFadeIn 0.5s ease forwards;
}
@keyframes heroFadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}
.hero-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--accent, #3d5afe);
  color: #000;
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 2px;
  text-transform: uppercase;
  padding: 3px 10px;
  border-radius: 3px;
  margin-bottom: 14px;
}
.hero-title {
  font-family: 'Oswald', sans-serif;
  font-size: clamp(2.2rem, 5vw, 4rem);
  font-weight: 700;
  line-height: 1.05;
  margin-bottom: 12px;
  text-transform: uppercase;
  text-shadow: 0 2px 12px rgba(0, 0, 0, 0.8);
}
.hero-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
  font-size: 0.83rem;
  color: var(--text-muted, #9a9a9a);
}
.hero-rating {
  color: var(--accent, #3d5afe);
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 3px;
}
.hero-dot {
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--text-dim, #555);
}
.hero-type-badge {
  background: var(--surface3, #2e2e2e);
  border: 1px solid var(--border, #333);
  color: var(--text-muted, #9a9a9a);
  font-size: 0.7rem;
  padding: 2px 8px;
  border-radius: 3px;
}
.hero-overview {
  font-size: 0.88rem;
  line-height: 1.65;
  color: rgba(240, 240, 240, 0.78);
  margin-bottom: 24px;
  max-width: 480px;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.hero-actions {
  display: flex;
  gap: 10px;
  align-items: center;
}
.btn-play {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--accent, #3d5afe);
  color: #000;
  border: none;
  padding: 11px 26px;
  border-radius: var(--radius, 5px);
  font-weight: 700;
  font-size: 0.88rem;
  cursor: pointer;
  transition: all var(--trans, 0.25s ease);
  letter-spacing: 0.3px;
}
.btn-play:hover {
  background: var(--accent2, #2a46e0);
  transform: scale(1.03);
  box-shadow: 0 4px 20px var(--accent-glow, rgba(61, 90, 254, 0.25));
}
.btn-info {
  display: flex;
  align-items: center;
  gap: 8px;
  background: rgba(255, 255, 255, 0.1);
  color: var(--text, #f0f0f0);
  border: 1px solid rgba(255, 255, 255, 0.2);
  padding: 11px 22px;
  border-radius: var(--radius, 5px);
  font-weight: 500;
  font-size: 0.85rem;
  cursor: pointer;
  transition: all var(--trans, 0.25s ease);
}
.btn-info:hover {
  background: rgba(255, 255, 255, 0.18);
}
@media (max-width: 640px) {
  .hero {
    height: 75vw;
    min-height: 420px;
    padding: 0;
    align-items: flex-end;
  }
  .hero-bg::after {
    background: linear-gradient(0deg, rgba(14,14,14,1) 0%, rgba(14,14,14,0.6) 50%, rgba(14,14,14,0.1) 100%);
  }
  .hero-content {
    max-width: 100%;
    width: 100%;
    padding: 0 16px 20px;
    text-align: center;
  }
  .hero-badge {
    display: none;
  }
  .hero-title {
    font-size: 1.7rem;
    text-transform: none;
    margin-bottom: 6px;
  }
  .hero-meta {
    justify-content: center;
    margin-bottom: 14px;
    font-size: 0.78rem;
  }
  .hero-overview {
    display: none;
  }
  .hero-actions {
    justify-content: center;
    gap: 10px;
  }
  .btn-play {
    flex: 1;
    max-width: 160px;
    justify-content: center;
    background: #fff;
    color: #000;
    padding: 10px 16px;
    font-size: 0.85rem;
    border-radius: 4px;
  }
  .btn-info {
    flex: 1;
    max-width: 160px;
    justify-content: center;
    background: rgba(109,109,110,0.7);
    color: #fff;
    border: none;
    padding: 10px 16px;
    font-size: 0.85rem;
    border-radius: 4px;
  }
}
</style>
