<script setup lang="ts">
/**
 * Toast — la notificación efímera global (`<div class="toast" id="toast">`,
 * línea ~3867 de assets/index.html). Renderiza el estado reactivo de
 * `useToast()` — reemplaza el `t.textContent = msg; t.classList.add('show')`
 * manual de `showToast()`.
 */
import { useToast } from '../composables/useToast';

const { message, visible } = useToast();
</script>

<template>
  <div class="toast" :class="{ show: visible }">{{ message }}</div>
</template>

<!-- Estilos centralizados en src/style.css (.toast / .toast.show) — sin scoped CSS duplicado -->
