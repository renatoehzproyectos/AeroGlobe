# Aeroglobe — como jugarlo

## 1. Pone tu Cesium ion token

Abri `config.js` (en la raiz del proyecto) y pega tu token ahi:

```js
export const CESIUM_ION_TOKEN = 'tu-token-real-aca';
```

Conseguilo gratis en https://ion.cesium.com/tokens (crear cuenta -> "Create Token").

## 2. Pone tu modelo de avion

Copia tu archivo `.glb` a:

```
aeroglobe/models/trainer.glb
```

(mismo nombre exacto: `trainer.glb`, dentro de la carpeta `models/`
junto a `index.html`). Si queres otro nombre/carpeta, cambia el campo
`"model"` en `src/aircraft/definitions/trainer-172.json`.

## 3. Levanta un servidor local

El proyecto usa `import`/`export` de ES modules directo en el navegador
(sin bundler), asi que necesita servirse por http (no funciona abriendo
`index.html` con doble click, `file://` bloquea los modules). Cualquiera
de estos sirve, parado en la carpeta `aeroglobe/`:

```bash
npx serve .
# o
python3 -m http.server 8000
```

## 4. Abrilo

`http://localhost:PUERTO/index.html` (el puerto que te haya dado el
comando de arriba — `npx serve` suele usar 3000, `http.server` el que le
pongas).

Si algo falla, la pantalla muestra el error en vez de quedar en blanco
(ver `src/app/bootstrap.js`) — abri tambien la consola del navegador
(F12) para el detalle completo.

## Que arranca por defecto

`src/app/bootstrap.js` carga el `trainer-172` (el Cessna 172 de
`src/aircraft/definitions/trainer-172.json`) en el aeropuerto de Palo
Alto (PAO), pista 31. Para cambiar avion/aeropuerto/posicion inicial,
edita las ultimas lineas de `bootstrap.js` (coordenadas `[lat, lon, alt,
heading, isAbsolute, speedKnots]`).

## Controles

Definidos en `src/app/controls.js` (teclado) — WASD/flechas para
control de vuelo, ver ese archivo para el mapeo exacto de cada tecla.

## Que es cada pieza nueva (agregada para que esto corra en un navegador real)

Todo el motor (fisica, terreno, clima, agua, camara) ya estaba completo
desde PARTE 1-12 del tutorial (ver `CHECKLIST.txt`). Lo que faltaba para
"jugarlo" de verdad, y se agrego ahora:

- `index.html` — carga Cesium (CDN) + `src/app/bootstrap.js` como modulo.
- `config.js` — donde va tu Cesium ion token.
- `src/app/bootstrap.js` — arma `createApp()` (PARTE 12) con Cesium real
  y arranca el `trainer-172` en PAO.
- `src/app/render-layer.js` — las 4 piezas que el motor esperaba
  inyectadas sin que el tutorial les diera codigo (`api.Model`,
  `api.Canvas`, `api.ParticleEmitter`, `setCameraPositionAndOrientation`),
  implementadas de verdad contra `Cesium.Model`/`Cesium.ParticleSystem`/
  `Cesium.Camera`.
- `models/` — donde va tu `.glb`.

De paso, al integrar contra Cesium real (no mocks) aparecieron 3 bugs de
wiring mas que no se habian visto en las pruebas con mocks de cada parte
por separado (documentados en el codigo, con comentario "BUGFIX" en cada
sitio):

1. `world-init.js` llamaba a `initTerrain(viewer, SRTM_URL)` con 2
   argumentos, pero `terrain-provider.js` espera
   `initTerrain(viewer, Cesium, srtmUrl, ...)` — `Cesium` faltaba.
2. `createGroundAltitudeApi()` (PARTE 4.3-4.5) nunca se llamaba en
   ningun lado de `start.js` pese a que el resto del motor ya usaba
   `api.getGroundAltitude*` desde PARTE 4 — ahora se llama en `start()`
   justo despues de `initWorld()`.
3. `elevation-management.js` leia `ac.lastLlaLocation` en el PRIMER
   frame de vida del avion, antes de que esa misma funcion lo hubiera
   escrito nunca (crash solo visible con terreno/API reales, no con los
   mocks simplificados de las pruebas de PARTE 4/12).
