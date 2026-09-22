# Tasks — 018 De qué anuncio llegó cada conversación

## Datos

- [ ] T001 `image_asset_id` e índice `ad_attribution_org_source_idx` en `schema.ts`
- [ ] T002 `pnpm db:generate` → `0014_anuncio_de_origen`, editada re-ejecutable
- [ ] T003 Migrar una base vacía y una base en `0013` con datos

## Servidor

- [ ] T004 `referral.ts`: normalización pura del referral de WhatsApp, con cotas
- [ ] T005 `creativo.ts`: URL permitida, descarga acotada con reintento, copia única por anuncio
- [ ] T006 `deleteMediaFile` en `server/whatsapp/media.ts`
- [ ] T007 `store.ts`: registrar (sin `ctwa_clid` con la bandera apagada), leer, reparar con freno, serializar
- [ ] T008 Ingesta: captura siempre, antes del dedup, sin romper el mensaje
- [ ] T009 `queries.ts` y rutas: anuncio en la lista, el detalle y el evento SSE
- [ ] T010 Fuente deducida «anuncio»

## UI

- [ ] T011 `lib/anuncios.ts` y `components/anuncio-origen.tsx`
- [ ] T012 Marca y filtro «Anuncios» en la lista
- [ ] T013 Tarjeta en el panel del contacto y en el cajón del trato

## Mocks, pruebas y documentación

- [ ] T014 wa-mock: `referral` libre en el inbound; creativos de prueba en `media-file`
- [ ] T015 Unitarias: normalización, URL permitida, descarga, bandera, freno de reparación
- [ ] T016 Arnés: sección 018 y la 016 apagada comprueba el origen visible sin clic
- [ ] T017 Guion de navegador con capturas
- [ ] T018 `flag.ts`, `docs/atribucion-capi.md`, `tests/e2e/us-atribucion.md`, `.env.example`, `CLAUDE.md`
- [ ] T019 Gate técnico, `pnpm test:e2e` con la bandera apagada y encendida
