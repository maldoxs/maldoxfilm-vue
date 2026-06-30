<script setup lang="ts">
/**
 * BackButtonMobile — flecha "‹ volver" arriba a la izquierda, SOLO visible en
 * móvil (estilo Netflix). En desktop/TV no se muestra (esas vistas tienen su
 * propia navegación). Vuelve a la pantalla anterior; si no hay historial, al home.
 */
import { useRouter } from 'vue-router';
import { useDeviceStore } from '../../stores/device';

const router = useRouter();
const deviceStore = useDeviceStore();

function goBack() {
  if (window.history.length > 1) router.back();
  else router.push('/');
}
</script>

<template>
  <button v-if="deviceStore.isMobile" class="back-btn-mobile" aria-label="Volver" @click="goBack">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="15 18 9 12 15 6" />
    </svg>
  </button>
</template>

<style scoped>
.back-btn-mobile {
  position: absolute;
  top: 14px;
  left: 12px;
  z-index: 20;
  width: 38px;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: #fff;
  cursor: pointer;
}
.back-btn-mobile svg {
  width: 26px;
  height: 26px;
}
</style>
