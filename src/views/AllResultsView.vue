<script setup lang="ts">
/**
 * AllResultsView — la grilla paginada "VER TODO" con scroll infinito.
 *
 * Reemplaza `openAllResults`/`_openAllResultsOverlay`/`_loadArPage` +
 * `#allResultsPage` (índex.html líneas ~428-469, ~7600+): recibe el endpoint
 * base de una sección (p.ej. `/discover/movie?with_genres=27&sort_by=...`),
 * va pidiendo `&page=N` y acumulando resultados a medida que el usuario baja.
 *
 * Mejoras pedidas sobre el original:
 *   - Fondo "telón": el backdrop del primer resultado, desenfocado + oscurecido,
 *     para que los pósters resalten (estilo cine).
 *   - Pósters un poco MÁS GRANDES que en los carruseles.
 *   - Pensada para desktop y TV (grilla responsive con minmax mayor en TV).
 */
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import MovieCard from '../components/catalog/MovieCard.vue';
import { useAppServices } from '../composables/useAppServices';
import { useDeviceStore } from '../stores/device';
import { TMDB_IMG_BASE } from '../services/catalog';
import { safeStorage } from '../services/safeStorage';
import type { MediaItem } from '../types';

const props = defineProps<{
  title: string;
  endpoint: string;
  type: 'movie' | 'tv';
}>();

const { tmdbClient } = useAppServices();
const deviceStore = useDeviceStore();
const router = useRouter();

interface TmdbPage {
  results: MediaItem[];
  total_pages: number;
  total_results: number;
}

/**
 * Memoria de posición del "Ver todo" — por ENTRADA DEL HISTORIAL.
 *
 * Esta vista NO scrollea la ventana: `.all-results` es `position: fixed` con su
 * propio `overflow-y: auto`. Por eso el `scrollBehavior` del router (que restaura
 * `window`) nunca pudo devolver la posición acá: `savedPosition.top` siempre vale 0
 * porque el documento jamás se movió. Hay que guardar y restaurar el scroll del
 * contenedor a mano.
 *
 * La clave identifica la ENTRADA del historial: volver con "Volver"/atrás regresa a
 * la MISMA entrada → se restaura; entrar de nuevo desde el catálogo crea una entrada
 * NUEVA → arranca arriba, como siempre. Así no hace falta adivinar la dirección de la
 * navegación.
 *
 * Se compone de `position` (el índice que Vue Router lleva en `history.state`) MÁS la
 * URL de esa entrada. Verificado en el navegador contra el build real: este router NO
 * escribe `state.key`, solo `{back, current, forward, replaced, position, scroll}` —
 * usar `key` habría dejado esto sin guardar nada nunca. La URL acompaña al índice
 * porque `position` se reutiliza: si el usuario vuelve atrás y navega a otro lado, la
 * entrada nueva ocupa el mismo índice, y sin la URL restauraríamos la posición de una
 * lista sobre otra distinta.
 *
 * Se guarda en `safeStorage` (no en una variable del módulo) para que también sobreviva
 * a un refresco de la página, y porque así queda inspeccionable al depurar.
 */
interface SavedSpot {
  top: number;
  pages: number;
}
const SCROLL_KEY_PREFIX = 'verTodo:scroll:';

function historyKey(): string | null {
  const st = window.history.state as { position?: number; current?: string } | null;
  if (!st || typeof st.position !== 'number') return null;
  return `${SCROLL_KEY_PREFIX}${st.position}|${st.current ?? ''}`;
}

function readSpot(key: string | null): SavedSpot | null {
  if (!key) return null;
  try {
    const raw = safeStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedSpot;
    return typeof parsed?.top === 'number' && typeof parsed?.pages === 'number' ? parsed : null;
  } catch {
    return null;
  }
}

function writeSpot(key: string, spot: SavedSpot): void {
  try {
    safeStorage.setItem(key, JSON.stringify(spot));
  } catch {
    /* best effort — nunca debe romper la navegación */
  }
}

const items = ref<MediaItem[]>([]);
const rootRef = ref<HTMLElement | null>(null);
const page = ref(1);
const totalPages = ref(1);
const totalResults = ref(0);
const loading = ref(false);
const sentinel = ref<HTMLElement | null>(null);
let observer: IntersectionObserver | null = null;

// Fondo "telón" — backdrop del primer resultado (si tiene), desenfocado.
const backdropUrl = computed(() => {
  const bp = (items.value[0] as { backdrop_path?: string | null } | undefined)?.backdrop_path;
  return bp ? `${TMDB_IMG_BASE}w1280${bp}` : '';
});

const countLabel = computed(() =>
  totalResults.value ? `${totalResults.value.toLocaleString('es')} resultados` : 'Cargando…'
);

function pageEndpoint(p: number): string {
  const sep = props.endpoint.includes('?') ? '&' : '?';
  return `${props.endpoint}${sep}page=${p}`;
}

async function loadNext() {
  if (loading.value || page.value > totalPages.value || !props.endpoint) return;
  loading.value = true;
  try {
    const data = await tmdbClient.get<TmdbPage>(pageEndpoint(page.value));
    const results = Array.isArray(data?.results) ? data.results : [];
    // Dedup por id (algunos endpoints repiten entre páginas).
    const seen = new Set(items.value.map((i) => i.id));
    items.value = [...items.value, ...results.filter((r) => !seen.has(r.id))];
    totalPages.value = Math.min(data?.total_pages || 1, 500); // TMDB topa en 500 páginas
    totalResults.value = data?.total_results || items.value.length;
    page.value += 1;
  } catch {
    /* silenciar — se detiene la paginación */
  } finally {
    loading.value = false;
  }
  // Relleno automático: si tras cargar el sentinel sigue dentro del margen de
  // precarga (pantalla corta o buffer no lleno), encadena la siguiente página.
  await nextTick();
  const el = sentinel.value;
  if (el && page.value <= totalPages.value) {
    if (el.getBoundingClientRect().top <= window.innerHeight + 1200) void loadNext();
  }
}

function reset() {
  items.value = [];
  page.value = 1;
  totalPages.value = 1;
  totalResults.value = 0;
  void loadNext();
}

watch(() => props.endpoint, reset);

/**
 * loadUpTo — vuelve a cargar páginas hasta llegar a la que estaba cargada al salir.
 * Sin esto, restaurar el offset no serviría: al volver, la grilla arranca con una sola
 * página y el contenedor no mide lo suficiente como para que esa posición exista.
 * Respeta el `loading` de `loadNext` (esperando en vez de reentrar) y lleva un tope de
 * vueltas para no quedarse girando si TMDB deja de responder.
 */
async function loadUpTo(targetPage: number) {
  let vueltas = 0;
  while (page.value <= targetPage && page.value <= totalPages.value && vueltas++ < 40) {
    if (loading.value) {
      await new Promise((r) => setTimeout(r, 60));
      continue;
    }
    await loadNext();
  }
}

/**
 * Clave de ESTA vista, capturada al montar. No se puede leer al desmontar: para cuando
 * corre `onBeforeUnmount`, el router ya empujó la entrada de destino y `history.state`
 * apunta a la ficha, no a la grilla — guardar ahí escribía bajo la clave equivocada y la
 * restauración nunca encontraba nada (comprobado en el navegador antes de corregirlo).
 */
let myKey: string | null = null;

/**
 * esVueltaAtras — distingue "volví a esta lista" de "entré de nuevo a esta lista".
 *
 * Hace falta porque `position` se REUTILIZA: si el usuario sale de la grilla con
 * "Volver" y vuelve a entrar desde el catálogo, la entrada nueva ocupa el mismo índice
 * y la misma URL que la anterior, así que la clave sola no alcanza — la lista arrancaba
 * a mitad de camino en vez de arriba.
 *
 * `forward` es la señal del propio historial y se comprobó contra el build real:
 *   entrada nueva  -> {position: 11, forward: null}
 *   tras volver    -> {position: 11, forward: "/pelicula/860508"}
 * Solo hay algo "adelante" cuando efectivamente se retrocedió desde ahí.
 */
function esVueltaAtras(): boolean {
  return !!(window.history.state as { forward?: string | null } | null)?.forward;
}

/** restoreScroll — solo hace algo al VOLVER (misma entrada del historial). */
async function restoreScroll() {
  if (!esVueltaAtras()) return;
  const saved = readSpot(myKey);
  if (!saved || saved.top <= 0) return;
  await loadUpTo(saved.pages);
  await nextTick();
  if (rootRef.value) rootRef.value.scrollTop = saved.top;
}

onMounted(() => {
  myKey = historyKey();
  reset();
  void restoreScroll();
  observer = new IntersectionObserver(
    (entries) => {
      if (entries[0]?.isIntersecting) void loadNext();
    },
    // Precarga MUY anticipada (1500px antes de llegar al sentinel) para
    // disimular la latencia de TMDB: la página siguiente ya está cargando
    // mientras todavía estás viendo la actual.
    { rootMargin: '1500px' }
  );
  if (sentinel.value) observer.observe(sentinel.value);
});

onBeforeUnmount(() => {
  // Guardar dónde quedó el usuario ANTES de desmontar (al abrir una ficha). `page` apunta
  // a la SIGUIENTE por cargar, así que las ya cargadas son `page - 1`.
  if (myKey && rootRef.value && rootRef.value.scrollTop > 0) {
    writeSpot(myKey, { top: rootRef.value.scrollTop, pages: page.value - 1 });
  }
  observer?.disconnect();
  observer = null;
});

function onSelect({ id, type }: { id: MediaItem['id']; type: 'movie' | 'tv' }) {
  router.push(type === 'movie' ? `/pelicula/${id}` : `/serie/${id}/1/1`);
}

function goBack() {
  if (window.history.length > 1) router.back();
  else router.push('/');
}
</script>

<template>
  <div ref="rootRef" class="all-results">
    <!-- Telón: backdrop desenfocado + oscurecido para que resalten los pósters. -->
    <div
      class="all-results-backdrop"
      :style="backdropUrl ? { backgroundImage: `url(${backdropUrl})` } : undefined"
    ></div>

    <div class="all-results-header">
      <button class="all-results-back" @click="goBack">‹ Volver</button>
      <div>
        <h1 class="all-results-title">{{ title }}</h1>
        <div class="all-results-count">{{ countLabel }}</div>
      </div>
    </div>

    <div class="all-results-body">
      <div class="all-results-grid">
        <MovieCard
          v-for="item in items"
          :key="item.id"
          :item="item"
          :fallback-type="type"
          :is-tv-mode="deviceStore.isTV"
          @select="onSelect"
        />
      </div>
      <div v-if="loading" class="all-results-loading">Cargando más…</div>
      <div ref="sentinel" class="all-results-sentinel"></div>
    </div>
  </div>
</template>

<style scoped>
/* Overlay a pantalla completa con SU PROPIO scroll (preserva `.all-results-page`,
   índex.html ~428-432): así la cabecera `sticky` se queda fija de verdad arriba
   y no queda tapada por la barra de navegación. */
.all-results {
  position: fixed;
  inset: 0;
  z-index: 600;
  overflow-y: auto;
  overflow-x: hidden;
  background: #0a0a0a;
}
/* Telón cinematográfico — fijo detrás de la grilla. */
.all-results-backdrop {
  position: fixed;
  inset: 0;
  z-index: -1;
  background-color: #0a0a0a;
  background-size: cover;
  background-position: center top;
  filter: blur(28px) brightness(0.4) saturate(1.1);
  transform: scale(1.1); /* evita bordes claros al desenfocar */
}
/* Capa de oscurecimiento/vigneta extra para contraste de los pósters. */
.all-results-backdrop::after {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(ellipse at center, rgba(10, 10, 10, 0.55) 0%, rgba(10, 10, 10, 0.92) 100%),
    linear-gradient(180deg, rgba(10, 10, 10, 0.85) 0%, rgba(10, 10, 10, 0.6) 30%, rgba(10, 10, 10, 0.85) 100%);
}
.all-results-header {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 18px 52px 14px;
  background: linear-gradient(180deg, rgba(10, 10, 10, 0.85) 70%, transparent 100%);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}
.all-results-back {
  flex-shrink: 0;
  background: rgba(255, 255, 255, 0.08);
  border: 1.5px solid rgba(255, 255, 255, 0.14);
  color: var(--text, #f0f0f0);
  border-radius: 8px;
  padding: 8px 16px;
  cursor: pointer;
  font-size: 0.9rem;
  transition: all var(--trans, 0.25s ease);
}
.all-results-back:hover {
  background: rgba(255, 255, 255, 0.14);
  border-color: var(--accent, #3d5afe);
}
.all-results-title {
  font-family: 'Oswald', sans-serif;
  font-size: 1.4rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin: 0;
  line-height: 1.2;
}
.all-results-count {
  font-size: 0.78rem;
  color: var(--text-muted, #9a9a9a);
  margin-top: 2px;
}
.all-results-body {
  padding: 22px 52px 80px;
}
/* Grilla con pósters MÁS GRANDES que en los carruseles (≈210px vs 220 del rail
   pero ocupando todo el ancho disponible → se ven más amplios). */
.all-results-grid {
  display: grid;
  gap: 22px;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
}
.all-results-loading {
  text-align: center;
  color: var(--text-muted, #9a9a9a);
  font-size: 0.85rem;
  padding: 24px 0 8px;
}
.all-results-sentinel {
  height: 1px;
}

/* TV: pósters aún más grandes + más aire (preserva `html.tv-mode .all-results-grid`). */
:global(html.tv-mode) .all-results-grid {
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 28px;
}
:global(html.tv-mode) .all-results-header,
:global(html.tv-mode) .all-results-body {
  padding-left: 64px;
  padding-right: 64px;
}

@media (max-width: 640px) {
  .all-results-header,
  .all-results-body {
    padding-left: 16px;
    padding-right: 16px;
  }
  .all-results-grid {
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 12px;
  }
}
</style>
