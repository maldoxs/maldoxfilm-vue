/**
 * useAppServices — acceso tipado a los clientes de red provistos en
 * `main.ts` (`app.provide(APP_SERVICES_KEY, services)`, ver `services/bootstrap.ts`).
 *
 * Reemplaza el acceso directo a las funciones globales `tmdb()`/`rdGetStream`
 * que cualquier función del original podía invocar — aquí las vistas piden
 * los clientes vía `inject`, lo que las hace testeables (se puede `provide`
 * un mock en tests de montaje) sin tocar módulos globales.
 */
import { inject } from 'vue';
import { APP_SERVICES_KEY, type AppServices } from '../services/bootstrap';

export function useAppServices(): AppServices {
  const services = inject<AppServices>(APP_SERVICES_KEY);
  if (!services) {
    throw new Error('useAppServices() llamado fuera del árbol de la app — falta app.provide(APP_SERVICES_KEY, ...) en main.ts');
  }
  return services;
}
