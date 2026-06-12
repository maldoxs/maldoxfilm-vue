/**
 * useToast — el toast global de notificaciones efímeras.
 *
 * Reemplaza `showToast(msg)` (línea ~8841 de assets/index.html):
 *   function showToast(msg){
 *     const t = document.getElementById('toast');
 *     t.textContent = msg;
 *     t.classList.add('show');
 *     setTimeout(()=>t.classList.remove('show'), 3200);
 *   }
 *
 * En el original era un singleton de DOM (`getElementById('toast')`).
 * Aquí se preserva como singleton de MÓDULO (estado compartido entre todos
 * los `useToast()`) — exactamente la misma semántica ("solo hay UN toast en
 * toda la app"), pero reactivo: `<Toast>` (Fase 4) solo necesita renderizar
 * `message`/`visible`, sin tocar `classList` manualmente.
 *
 * Se preserva el tiempo EXACTO: 3200ms (línea ~8841).
 */

import { ref } from 'vue';

export const TOAST_DURATION_MS = 3200;

const message = ref('');
const visible = ref(false);
let hideTimer: ReturnType<typeof setTimeout> | null = null;

function show(msg: string) {
  message.value = msg;
  visible.value = true;
  if (hideTimer) clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    visible.value = false;
  }, TOAST_DURATION_MS);
}

export interface UseToastReturn {
  message: typeof message;
  visible: typeof visible;
  show: typeof show;
}

/** useToast — devuelve el singleton compartido (mismo patrón que el `#toast` único del original). */
export function useToast(): UseToastReturn {
  return { message, visible, show };
}
