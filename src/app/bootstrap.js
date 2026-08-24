// ============================================================================
// BOOTSTRAP — arranca el simulador en un navegador real con Cesium.
//
// Este es el UNICO archivo que un integrador (vos) deberia necesitar
// tocar para cambiar el aeropuerto/avion inicial. Todo lo demas
// (fisica, terreno, clima, agua, camara) ya esta armado por
// src/app/start.js (PARTE 12).
// ============================================================================

import { CESIUM_ION_TOKEN } from '../../config.js';
import { createApp } from './start.js';
import { attachRenderLayer } from './render-layer.js';
import { initTerrain } from '../terrain/terrain-provider.js';
import { attachTouchControls, isTouchDevice } from './touch-controls.js';
import trainer172 from '../aircraft/definitions/trainer-172.json' with { type: 'json' };

// Cesium se carga como global `Cesium` via <script> en index.html (CDN
// oficial) -- no via import, para no necesitar un bundler/npm install.
const Cesium = window.Cesium;

async function main() {
  if (!CESIUM_ION_TOKEN || CESIUM_ION_TOKEN === 'PEGA_TU_TOKEN_DE_CESIUM_ION_ACA') {
    document.getElementById('view3d').innerHTML =
      '<p style="color:#fff;font-family:sans-serif;padding:2em">' +
      'Falta el token de Cesium ion. Abri <code>config.js</code> y pega tu ' +
      'token (gratis en <a href="https://ion.cesium.com/tokens" style="color:#6cf">ion.cesium.com/tokens</a>).' +
      '</p>';
    return;
  }
  Cesium.Ion.defaultAccessToken = CESIUM_ION_TOKEN;

  // api empieza como objeto vacio; createApp()/start() lo va poblando
  // (api.viewer, api.camera, api.getGroundAltitude*, etc, ver
  // start.js/ground-sampling.js). attachRenderLayer() cuelga las 4
  // piezas que necesitan Cesium de verdad (Model/Canvas/ParticleEmitter/
  // setCameraPositionAndOrientation) -- pero esas necesitan `viewer`,
  // que recien existe DESPUES de que start() llame a initWorld() por
  // dentro. deps.afterInitWorld(api) es el hook que start() invoca en
  // ese momento exacto (ver start.js) para no tener que exponer
  // initWorld como un paso separado que el integrador orqueste a mano.
  const app = createApp({
    Cesium,
    api: {},
    sim: {},
    containerId: 'view3d',
    viewportId: 'view3d',

    // Terreno: Cesium World Terrain (asset ID 1, el terreno global
    // gratuito de Cesium ion) -- CesiumTerrainProvider.fromUrl acepta un
    // IonResource directamente.
    SRTM_URL: await Cesium.IonResource.fromAssetId(1),
    initTerrain,

    // Definicion de aeronave: el trainer-172.json ya entregado. Su
    // unico "model" (parte "root") apunta a "models/trainer.glb" --
    // PONE TU ARCHIVO .glb EXACTAMENTE AHI: aeroglobe/models/trainer.glb
    // (mismo nombre, mismo directorio "models" junto a index.html). Si
    // preferis otro nombre/carpeta, cambia el campo "model" en
    // src/aircraft/definitions/trainer-172.json.
    definitions: { 'trainer-172': trainer172 },

    afterInitWorld: (api) => attachRenderLayer(api, api.viewer, Cesium),
  });

  // Coords = [lat, lon, alt, heading, isAbsolute, speedKnots].
  // alt=0 + isAbsolute=false = "en tierra, altura la calcula el motor
  // solo" (ver Aircraft.load, PARTE 12.0). Punto de partida: aeropuerto
  // de Palo Alto (PAO), 37.4611 N, -122.1150 W, pista 31 (heading ~310).
  // Cambialo por las coordenadas que quieras.
  await app.start('trainer-172', [37.4611, -122.1150, 0, 310, false, null]);

  // Movil: no hay teclado fisico, asi que controls.js (solo keydown/
  // keyup) nunca recibiria pitch/roll/yaw/throttle sin esto. Se agrega
  // una capa de joystick/throttle/botones en pantalla que escribe sobre
  // los MISMOS ejes que el teclado (ver touch-controls.js) -- el resto
  // del simulador no distingue el origen. Solo se monta si el
  // dispositivo reporta soporte touch, para no tapar la pantalla en
  // desktop.
  if (isTouchDevice()) {
    attachTouchControls(app.controls, app.camera, document.getElementById('view3d'));
  }

  console.log('Aeroglobe arrancado. app:', app);
  window.aeroglobe = app; // para poder inspeccionar/debuggear desde la consola
}

main().catch((err) => {
  console.error('Error arrancando Aeroglobe:', err);
  document.getElementById('view3d').innerHTML =
    '<pre style="color:#f66;background:#000;padding:1em;white-space:pre-wrap">' +
    'Error arrancando: ' + (err && err.stack || err) + '</pre>';
});
