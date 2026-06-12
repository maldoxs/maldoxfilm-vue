import { describe, test, expect, beforeEach, vi } from 'vitest';
import { useToast, TOAST_DURATION_MS } from '../src/composables/useToast';

describe('useToast — singleton de notificaciones efímeras', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  test('show() fija el mensaje y lo hace visible', () => {
    const { message, visible, show } = useToast();
    show('⚡ Hola');
    expect(message.value).toBe('⚡ Hola');
    expect(visible.value).toBe(true);
  });

  test('se oculta automáticamente tras TOAST_DURATION_MS (3200ms, preservado del original)', () => {
    const { visible, show } = useToast();
    show('Mensaje');
    expect(visible.value).toBe(true);
    vi.advanceTimersByTime(TOAST_DURATION_MS - 1);
    expect(visible.value).toBe(true);
    vi.advanceTimersByTime(1);
    expect(visible.value).toBe(false);
  });

  test('un nuevo show() reinicia el timer (igual que reasignar setTimeout en el original)', () => {
    const { visible, message, show } = useToast();
    show('Primero');
    vi.advanceTimersByTime(2000);
    show('Segundo');
    expect(message.value).toBe('Segundo');
    vi.advanceTimersByTime(2000);
    expect(visible.value).toBe(true); // aún no pasaron los 3200ms desde el segundo show
    vi.advanceTimersByTime(1200);
    expect(visible.value).toBe(false);
  });

  test('useToast() siempre devuelve el mismo singleton compartido', () => {
    const a = useToast();
    const b = useToast();
    a.show('Compartido');
    expect(b.message.value).toBe('Compartido');
    expect(b.visible.value).toBe(true);
  });
});
