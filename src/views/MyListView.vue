<script setup lang="ts">
/**
 * MyListView — "Mi Lista": grid de favoritos persistidos, con botón ✕ para
 * quitar cada item y mensaje de lista vacía.
 *
 * Reemplaza `showMiListaPage`/`mlRemoveItem` (líneas ~9059-9128 de
 * assets/index.html). El estado/persistencia ya viven en `useMyListStore`
 * (Pinia) — esta vista solo orquesta el grid y la navegación al detalle.
 *
 * Preserva: orden "más reciente primero" (`reversedItems` = `.reverse()`),
 * el contador "N título(s)"/mensaje "Tus películas y series guardadas", el
 * mensaje de lista vacía EXACTO, el fallback visual cuando no hay poster
 * (texto centrado sobre fondo `--surface2`), y el botón de eliminar con
 * `stopPropagation` (para no disparar la apertura del detalle al borrar).
 */
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useMyListStore } from '../stores/myList';
import { useToast } from '../composables/useToast';
import { TMDB_IMG_BASE } from '../services/catalog';

const myListStore = useMyListStore();
const router = useRouter();
const toast = useToast();

const IMG = `${TMDB_IMG_BASE}w342`;

/** countText — preserva el contador del header: "Tus películas y series guardadas" cuando está vacía, "N título(s)" cuando no (línea ~9074-9079). */
const countText = computed(() => (myListStore.isEmpty ? 'Tus películas y series guardadas' : myListStore.countLabel));

function posterUrl(poster: string): string {
  return poster ? `${IMG}${poster}` : '';
}

/**
 * displayTitle — el texto del `alt`/fallback visual (línea ~9094-9095:
 * `escapeHtml(title)||'Sin imagen'`). En el original `escapeHtml` era
 * necesario porque el resultado se volcaba con `innerHTML`; aquí se usa
 * interpolación de texto/atributo de Vue (`{{ }}`/`:alt`), que YA escapa
 * automáticamente — aplicar `escapeHtml` de nuevo causaría DOBLE escape
 * (p.ej. "Tom & Jerry" se vería como "Tom &amp; Jerry" en pantalla). Se
 * preserva el mismo resultado visual sin la capa de saneo redundante.
 */
function displayTitle(title: string): string {
  return title || 'Sin imagen';
}

/** openItem — preserva `closeMiLista(); showDetailPage(id, type)` (línea ~9092). */
function openItem(id: string, type: 'movie' | 'tv') {
  router.push(type === 'tv' ? `/serie/${id}/1/1` : `/pelicula/${id}`);
}

/** removeItem — preserva `mlRemoveItem` (líneas ~9119-9127): quita, persiste y muestra el toast con el mismo texto. */
function removeItem(id: string) {
  const result = myListStore.remove(id);
  if (result.toast) toast.show(result.toast);
}

function onCardKeydown(e: KeyboardEvent, id: string, type: 'movie' | 'tv') {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    openItem(id, type);
  }
}

function onDeleteKeydown(e: KeyboardEvent, id: string) {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    e.stopPropagation();
    removeItem(id);
  }
}
</script>

<template>
  <div class="mi-lista-page">
    <div class="ml-header">
      <div class="ml-bar"></div>
      <div>
        <div class="ml-title">Mi Lista</div>
        <div class="ml-count">{{ countText }}</div>
      </div>
    </div>

    <div class="ml-body">
      <p v-if="myListStore.isEmpty" class="ml-empty">Tu lista está vacía.<br />Añade películas y series desde su página de detalle.</p>

      <div v-else class="all-results-grid">
        <div v-for="item in myListStore.reversedItems" :key="item.id" class="ml-card-wrap">
          <div class="card" tabindex="0" @click="openItem(item.id, item.type)" @keydown="onCardKeydown($event, item.id, item.type)">
            <img v-if="item.poster" class="card-img" :src="posterUrl(item.poster)" :alt="displayTitle(item.title)" loading="lazy" />
            <div v-else class="card-img card-img-fallback">{{ displayTitle(item.title) }}</div>
            <div v-if="item.title" class="card-title">{{ item.title }}</div>
          </div>
          <button
            class="ml-del-btn"
            title="Eliminar de Mi Lista"
            @click.stop="removeItem(item.id)"
            @keydown="onDeleteKeydown($event, item.id)"
          >
            ✕
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Preservados de `.mi-lista-page`/header inline (líneas ~9606-9618) y `.ml-card-wrap`/`.ml-del-btn` (líneas ~807-821) */
.mi-lista-page {
  padding-top: 12px;
  padding-bottom: 48px;
}
.ml-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 20px;
  padding: 28px 40px 0;
}
.ml-bar {
  width: 4px;
  height: 32px;
  background: var(--accent, #3d5afe);
  border-radius: 2px;
  flex-shrink: 0;
}
.ml-title {
  font-family: 'Oswald', sans-serif;
  font-size: 1.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 1px;
}
.ml-count {
  font-size: 0.78rem;
  color: var(--text-muted, #9a9a9a);
  margin-top: 2px;
}
.ml-body {
  padding: 0 40px 80px;
}

/* ── Móvil: cabecera centrada estilo Netflix (igual que Series/Películas/Anime) ── */
@media (max-width: 640px) {
  .ml-header {
    justify-content: center;
    padding: 16px 16px 8px;
    margin-bottom: 12px;
  }
  .ml-bar {
    display: none;
  }
  .ml-title {
    font-size: 1.25rem;
    text-align: center;
  }
  .ml-count {
    display: none;
  }
  .ml-body {
    padding: 0 16px 80px;
  }
}
.ml-empty {
  color: var(--text-muted, #9a9a9a);
  text-align: center;
  padding: 60px;
  grid-column: 1 / -1;
}

.all-results-grid {
  display: grid;
  gap: 12px;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
}
/* TV: posters y texto más grandes en Mi Lista (a pedido) */
:global(html.tv-mode) .all-results-grid {
  gap: 22px;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
}
:global(html.tv-mode) .card-title {
  font-size: 1.05rem;
  margin-top: 10px;
}
.all-results-grid .card {
  min-width: unset;
  width: 100%;
  cursor: pointer;
}
.card-img {
  display: block;
  width: 100%;
  aspect-ratio: 2 / 3;
  border-radius: var(--radius, 8px);
  object-fit: cover;
}
.card-img-fallback {
  background: var(--surface2, #1a1a1a);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-muted, #9a9a9a);
  font-size: 0.75rem;
  text-align: center;
  padding: 8px;
}
.card-title {
  margin-top: 6px;
  font-size: 0.82rem;
  color: var(--text, #f0f0f0);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ml-card-wrap {
  position: relative;
}
.ml-del-btn {
  position: absolute;
  top: 5px;
  right: 5px;
  z-index: 10;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.75);
  border: 1.5px solid rgba(255, 255, 255, 0.25);
  color: #fff;
  font-size: 0.85rem;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  transition: opacity 0.18s, background 0.18s;
  pointer-events: auto;
}
.ml-card-wrap:hover .ml-del-btn {
  opacity: 1;
}
.ml-del-btn:hover {
  background: rgba(220, 50, 50, 0.85);
  border-color: rgba(255, 80, 80, 0.6);
}

/* En TV: siempre visible (sin hover) — preservado de `html.tv-mode .ml-del-btn` */
:global(html.tv-mode) .ml-del-btn {
  opacity: 0.7;
  width: 32px;
  height: 32px;
  font-size: 1rem;
}
/* El foco del botón borrar en TV se define en `style.css` (global): aquí en scoped,
   `:global(html.tv-mode) .x:focus` rompía el compilador y aplicaba el outline a
   `<html>` entero. */

@media (max-width: 640px) {
  .ml-header,
  .ml-body {
    padding-left: 14px;
    padding-right: 14px;
  }
}
</style>
