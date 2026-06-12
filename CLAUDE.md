# CLAUDE.md — maldoxfilm-vue

## Memoria del proyecto (SCP)

Toda la documentación, arquitectura, sesiones y decisiones de este proyecto viven
en el **Sistema de Conocimiento del Proyecto (SCP)**, SEPARADO del código, en:

```
/Users/angelomaldonado/Desktop/Cloude/Proyectos/MaldoxFilm/
```

> El código fuente es la **fuente de verdad**. Si la doc difiere → actualizar la doc.

---

## Leer ANTES de comenzar cualquier tarea (carga inteligente)

1. `project-memory.md` — estado vigente, decisiones, riesgos, próximos pasos
2. `current-sprint.md` — tablero del sprint (✅/🔄/⏳/⚠)
3. `architecture/project-map.md` — **§0 índice maestro del SCP** + mapa del código (dónde está cada cosa)
4. **Solo** la documentación necesaria según la tarea, p.ej.:
   - Reproductor / RD / DASH / subtítulos → `architecture/player.md`
   - APIs externas (TMDB/Torrentio/RD/OpenSubtitles) → `architecture/integrations.md`
   - Reglas de negocio / "por qué" → `architecture/business-rules.md`
   - Token RD / seguridad → `architecture/security.md`
   - Entornos / puertos / variables → `architecture/environment.md`
   - Correr / desplegar → `architecture/deployment.md`
   - Rutas → `architecture/routing.md` · Estado (Pinia) → `architecture/state-management.md` · Componentes → `architecture/components.md`
   - Convenciones → `coding-standards.md` · Decisiones → `adr/`

---

## Actualizar al FINALIZAR cualquier tarea

- `project-memory.md` — estado/decisiones/riesgos/próximos pasos
- `current-sprint.md` — mover ítems entre ✅/🔄/⏳/⚠
- `sessions/YYYY-MM-DD.md` — bitácora del día
- Documentación técnica de `architecture/` **solo si hubo cambios reales**

---

## Constraints permanentes del proyecto

- **Fidelidad 1:1** con el original (`/Users/angelomaldonado/Desktop/Streamix-local/assets/index.html`),
  incluidos quirks cosméticos.
- **RD_TOKEN server-side ONLY** — nunca en el bundle/git. Detalle en `security.md`.
- **Probar en local con `netlify dev`** (puerto 8888), NO `npm run dev`. No desplegar a
  Netlify ni `git push` sin permiso explícito; cada deploy con `--message`.
- **Responder en español**; describir lo que se hace.
- **No usar tools de preview/browser** para probar el reproductor — el usuario prueba en
  local y reporta logs.

---

## Datos rápidos

- **Stack:** Vue 3 + TS + Vite · Pinia · Vue Router · Vitest · Netlify Functions.
- **Verificación pre-entrega:** `npx vitest run` (251 tests) verde + `npx vue-tsc --noEmit` EXIT=0.
- **App:** catálogo TMDB + reproductor Real-Debrid (fallback iframe UnlimPlay/vidlink).
