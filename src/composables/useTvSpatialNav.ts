/**
 * useTvSpatialNav — navegación espacial con flechas (D-pad / puntero Magic remote)
 * por los carruseles del catálogo en modo TV.
 *
 * Replica el sistema D-pad del original (assets/index.html ~líneas 9322-9495):
 *   - ←/→  : mueve el foco card por card DENTRO del carrusel enfocado (y lo centra).
 *   - ↓/↑  : salta a la primera card del carrusel siguiente/anterior (otra categoría);
 *            ↑ desde el primer carrusel devuelve el foco al nav superior.
 *   - Enter: lo maneja cada card con su propio `@keydown.enter` (no aquí).
 *
 * Por qué hacía falta: la migración trajo el roving-focus del NAV (NavTV) pero NO
 * la navegación entre cards/carruseles → con el control el foco quedaba "pegado"
 * en la primera categoría y no recorría película por película.
 *
 * Cooperación con NavTV: este handler hace `if (e.defaultPrevented) return` primero,
 * así NO pisa las teclas que NavTV ya gestionó (←/→ entre ítems del nav, ↓ al primer
 * card). NavTV `preventDefault()` lo que maneja, por lo que aquí se omite.
 */

import { onMounted, onBeforeUnmount } from 'vue';

// Clases de carrusel/card de los 3 tipos (Carousel, TopNumbered, ContinueWatching).
const CAROUSEL_SEL = '.carousel, .top-carousel, .continue-carousel';
const CARD_SEL = '.card, .top-card, .continue-card';

export function useTvSpatialNav(isEnabled: () => boolean) {
  function getVisibleCarousels(): HTMLElement[] {
    return Array.from(document.querySelectorAll<HTMLElement>(CAROUSEL_SEL)).filter(
      (c) => c.offsetParent !== null && c.children.length > 0
    );
  }

  function cardsOf(carousel: HTMLElement): HTMLElement[] {
    return Array.from(carousel.querySelectorAll<HTMLElement>(CARD_SEL));
  }

  /** Centra la card enfocada dentro de su carrusel (scroll horizontal) — original ~9344. */
  function scrollToFocused(card: HTMLElement) {
    const carousel = card.closest<HTMLElement>(CAROUSEL_SEL);
    if (!carousel) return;
    const scrollTo = card.offsetLeft - carousel.offsetWidth / 2 + card.offsetWidth / 2;
    carousel.scrollTo({ left: Math.max(0, scrollTo), behavior: 'smooth' });
  }

  function focusCard(card: HTMLElement) {
    card.setAttribute('tabindex', '0');
    card.focus();
    scrollToFocused(card);
  }

  /** ←/→ dentro de un carrusel — original `navigateCarousel` (~9354-9379). */
  function navigateCarousel(carousel: HTMLElement, dir: 1 | -1) {
    const cards = cardsOf(carousel);
    if (!cards.length) return;
    const idx = cards.indexOf(document.activeElement as HTMLElement);
    if (idx === -1) {
      focusCard(cards[0]);
      return;
    }
    const next = Math.max(0, Math.min(cards.length - 1, idx + dir));
    focusCard(cards[next]);
  }

  /** ↓/↑ entre carruseles (categorías) — original `navigateSection` (~9381-9424). */
  function navigateSection(dir: 1 | -1) {
    const carousels = getVisibleCarousels();
    if (!carousels.length) return;
    const active = document.activeElement as HTMLElement | null;
    const cur = active ? active.closest<HTMLElement>(CAROUSEL_SEL) : null;

    if (!cur) {
      const first = cardsOf(carousels[0])[0];
      if (first) focusCard(first);
      return;
    }

    const idx = carousels.indexOf(cur);
    let nextIdx = idx + dir;
    if (nextIdx < 0) {
      // ↑ desde el primer carrusel → si hay barra de géneros TV, ir al género activo
      // (integrada al flujo: películas ↑ géneros ↑ nav); si no, directo al nav.
      const genre = document.querySelector<HTMLElement>('.tv-genre-chip.active');
      if (genre) {
        genre.focus();
        return;
      }
      const navItem =
        document.querySelector<HTMLElement>('.tv-topnav-item.active') ||
        document.querySelector<HTMLElement>('.tv-topnav-item');
      if (navItem) {
        navItem.focus();
        return;
      }
      nextIdx = 0;
    }
    if (nextIdx >= carousels.length) nextIdx = carousels.length - 1;

    const nextCard = cardsOf(carousels[nextIdx])[0];
    if (nextCard) {
      carousels[nextIdx]
        .closest('.section, [class*="section"]')
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      focusCard(nextCard);
    }
  }

  /**
   * Foco sigue al puntero (Magic remote): al pasar el puntero por una card, esa
   * queda enfocada = ancla del desplazamiento. Así "donde te posicionás con el
   * puntero tiene prioridad" y las flechas recorren DESDE ahí (no desde un foco
   * viejo del nav). `preventScroll` evita que el hover mueva la página.
   */
  function onPointerOver(e: Event) {
    if (!isEnabled()) return;
    const active = document.activeElement as HTMLElement | null;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;
    const card = (e.target as HTMLElement | null)?.closest<HTMLElement>(CARD_SEL);
    if (card && card !== active) {
      card.setAttribute('tabindex', '0');
      card.focus({ preventScroll: true });
    }
  }

  function onKeydown(e: KeyboardEvent) {
    if (!isEnabled()) return;
    // NavTV (y otros handlers) ya gestionaron + preventDefault → no pisar.
    if (e.defaultPrevented) return;

    const active = document.activeElement as HTMLElement | null;
    if (!active) return;
    // No interferir con nav, géneros, inputs ni el reproductor.
    if (active.closest('.tv-topnav')) return;
    if (active.classList.contains('genre-pill') || active.classList.contains('tv-genre-chip')) return;
    if (active.closest('.player-page')) return;
    if (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') return;

    const inCarousel = active.closest<HTMLElement>(CAROUSEL_SEL);

    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        if (inCarousel) navigateCarousel(inCarousel, 1);
        else {
          const first = cardsOf(getVisibleCarousels()[0] ?? document.createElement('div'))[0];
          if (first) focusCard(first);
        }
        break;
      case 'ArrowLeft':
        e.preventDefault();
        if (inCarousel) navigateCarousel(inCarousel, -1);
        break;
      case 'ArrowDown':
        e.preventDefault();
        navigateSection(1);
        break;
      case 'ArrowUp':
        e.preventDefault();
        navigateSection(-1);
        break;
    }
  }

  onMounted(() => {
    document.addEventListener('keydown', onKeydown);
    document.addEventListener('mouseover', onPointerOver);
  });
  onBeforeUnmount(() => {
    document.removeEventListener('keydown', onKeydown);
    document.removeEventListener('mouseover', onPointerOver);
  });
}
