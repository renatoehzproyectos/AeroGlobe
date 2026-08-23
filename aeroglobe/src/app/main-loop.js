// ============================================================================
// PARTE 10 — LOOP PRINCIPAL
//
// El tutorial titula esta seccion "Loop principal, camara, controles,
// instrumentos" pero el UNICO fragmento de "loop" que da es el render
// loop desacoplado de PARTE 10.3 (requestAnimationFrame -> viewer.render
// si !sim.pause) + la mencion de que existe `api.frameCallbackWrapper`
// (referenciado en initWorld: `viewer.scene.preRender.addEventListener
// (api.frameCallbackWrapper)`) sin dar su implementacion. ESTE archivo
// es esa implementacion faltante: el orquestador que cada frame llama,
// en orden:
//
//   1. controls.update(dt)                          (PARTE 10.1)
//   2. flight.terrainElevationManagement(ac)         (PARTE 4.9) — TIENE
//      que correr ANTES de flightTick: fija sim.withinCollisionRange y
//      sim.groundElevation, que collectContacts (PARTE 4.7) y
//      Wind.computeTerrainLift (PARTE 8.1) leen ese mismo frame.
//   3. flightTick(dt, dtMs, now)                     (PARTE 5.6, ya
//      entregado, la funcion que devuelve makeFlightTick())
//   4. camera.update(dt)                             (PARTE 10.2)
//   5. dayNightManager.update() si existe            (PARTE 8.3)
//   6. api.viewer.scene.requestRender()              ("triggerExplicit
//      Rendering() al final del frame", nota de PARTE 10.3)
//
// dt se mide con performance.now() y se clampea a un maximo (evita que
// un tab en background con requestAnimationFrame congelado, al volver a
// foco, le pase un dt de varios segundos a la fisica y el avion salte
// medio mapa de un frame al otro).
// ============================================================================

import { clamp } from '../core/constants.js';

const MAX_DT = 0.25; // s: clamp de hitches largos (tab en background, GC, etc)

// deps: { api, sim, aircraft, controls, camera, flight (de
//   createFlightTerrainManager, PARTE 4.9), flightTick (de
//   makeFlightTick, PARTE 5.6), dayNightManager (opcional, PARTE 8.3),
//   weather (opcional, para weather.updateWind por frame, PARTE 8.1) }
export function createMainLoop(deps) {
  const { api, sim, aircraft, controls, camera, flight, dayNightManager, weather } = deps;
  let flightTick = deps.flightTick; // puede setearse despues via loop.setFlightTick

  sim.pause = false;
  sim.pauseCount = 0;
  sim.lastFrameTime = null;

  // doPause/undoPause: contador de referencias, no un booleano plano.
  // makeFlyTo (PARTE 4.10, ya entregado) ya llama doPause(1)/undoPause(1)
  // alrededor del teletransporte async; si dos cosas piden pausa a la
  // vez (ej. flyTo Y el menu de pausa del usuario) un booleano simple
  // haria que la primera en soltar reanude el juego de golpe aunque la
  // segunda lo siga necesitando pausado.
  function doPause(n) {
    sim.pauseCount += n || 1;
    sim.pause = sim.pauseCount > 0;
  }
  function undoPause(n) {
    sim.pauseCount = Math.max(0, sim.pauseCount - (n || 1));
    sim.pause = sim.pauseCount > 0;
  }

  api.frameCallbackWrapper = function () {
    const now = performance.now();
    if (sim.lastFrameTime == null) sim.lastFrameTime = now;
    const dt = clamp((now - sim.lastFrameTime) / 1000, 0, MAX_DT);
    sim.lastFrameTime = now;
    const dtMs = dt * 1000;

    if (sim.pause || !aircraft.instance || !flightTick) return;

    controls.update(dt);
    flight.terrainElevationManagement(aircraft.instance);
    flightTick(dt, dtMs, now);
    camera.update(dt);
    if (weather && weather.updateWind) weather.updateWind(aircraft.instance.llaLocation);
    if (dayNightManager) dayNightManager.update();

    if (api.viewer && api.viewer.scene && api.viewer.scene.requestRender) {
      api.viewer.scene.requestRender();
    }
  };

  return {
    doPause,
    undoPause,
    // flightTick se crea con makeFlightTick(aircraft, {..., Object3D})
    // DESPUES de buildAircraftTree() (PARTE 9), que a su vez necesita
    // aircraft.instance ya cargado -- por eso el loop se arma ANTES de
    // tener flightTick listo (ver orden de arranque, PARTE 12) y este
    // setter lo conecta cuando esta disponible.
    setFlightTick(fn) { flightTick = fn; },
  };
}
