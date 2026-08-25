// ============================================================================
// PARTE 12 — ENSAMBLADO Y ORDEN DE ARRANQUE
//
// Transcripcion del pseudocodigo de start()/frameCallback() del tutorial,
// adaptada al mismo patron de inyeccion de dependencias que TODO el resto
// del proyecto (nada de globals): en vez de `ui`, `preferences`, `fx`,
// `weather`, `camera`, `controls`, `sim`, `api` como variables de modulo
// compartidas, todo entra por `deps` y se devuelve un objeto `app` con
// las piezas ya conectadas, para que quien integre esto en un HTML real
// (index.html + Cesium cargado) solo tenga que llamar
// `await createApp(deps).start(aircraftId, coords)`.
//
// DESVIACIONES DOCUMENTADAS respecto al frameCallback() literal del
// tutorial (PARTE 12, seccion "```javascript... function frameCallback
// (now) {...}```"):
//
// 1) El loop real YA fue escrito en PARTE 10.4 (main-loop.js,
//    createMainLoop) enganchado a `viewer.scene.preRender`
//    (api.frameCallbackWrapper), NO a un `api.addFrameCallback(sim.
//    frameCallback)` separado como sugiere el pseudocodigo de PARTE 12.
//    Son dos formas distintas de "loop principal" para el MISMO
//    problema; se elige reusar PARTE 10.4 (ya construido, probado, y con
//    el orden correcto de terrainElevationManagement ANTES del tick)
//    en vez de escribir un segundo loop paralelo que duplicaria esa
//    logica y podria desincronizarse. Este archivo llama
//    createMainLoop() y initWorld() en el orden que world-init.js (PARTE
//    10.3) ya exige (frameCallbackWrapper debe existir ANTES de
//    initWorld).
//
// 2) `sim.pauseLevel < 3` (el pseudocodigo distingue varios niveles de
//    pausa: fisica pausada pero camara/clima siguen, vs. todo detenido)
//    NO se implementa: PARTE 10.4 ya establece doPause/undoPause como un
//    CONTADOR simple (pausado/no-pausado, ver nota en main-loop.js). Se
//    documenta como simplificacion deliberada -- anadir niveles de pausa
//    intermedios es una extension de UI (ej. "pausa de menu" vs "pausa
//    de camara libre") que el tutorial no especifica con codigo en
//    ningun lado, solo con el numero "3" sin definir que separa cada
//    nivel.
//
// 3) `instruments.update()` / `audio.update()` — PARTE 10 (checklist, ya
//    entregada) ya marco "instrumentos" como fuera de alcance (UI/HUD sin
//    codigo en el tutorial); audio nunca se menciona en ninguna otra
//    parte del tutorial. Ninguno de los dos se llama aca; animation.
//    values ya expone todo lo que un HUD/instrumentos necesitaria leer
//    (PARTE 10.0).
//
// 4) `ui.init()` / `readPreferences()` — mismo caso: capa de UI/
//    persistencia de preferencias del usuario, sin codigo dado por el
//    tutorial. Se aceptan como deps.readPreferences()/deps.ui (ambos
//    OPCIONALES, no-op si no se pasan) para no bloquear el arranque de
//    quien todavia no tiene esa capa construida.
// ============================================================================

import { createFlightTerrainManager, makeFlyTo, attachCautiousTerrainProbing } from '../terrain/elevation-management.js';
import { collectContacts } from '../terrain/contact-detection.js';
import { resolveContacts } from '../terrain/collision-response.js';
import { makeFlightTick, makeSetAnimationValues } from '../aircraft/flight-tick.js';
import { GRAVITY, METERS_TO_FEET, exponentialSmoothing } from '../core/constants.js';
import { Object3D } from '../core/object3d.js';
import { createAnimation } from './animation.js';
import { createControls, attachKeyboardControls } from './controls.js';
import { createCamera, attachMouseOrbit } from './camera.js';
import { initWorld } from './world-init.js';
import { createGroundAltitudeApi } from '../terrain/ground-sampling.js';
import { createMainLoop } from './main-loop.js';
import { createWeather, createDayNightManager } from '../weather/weather.js';
import { createAtmosphere } from '../aircraft/atmosphere.js';
import { createWaterDetection } from '../water/water-detection.js';
import { createWaterState, updateWaterState } from '../water/waves.js';
import { Aircraft } from '../aircraft/aircraft.js';

const MS_TO_KNOTS = 1.94384;

// deps: { Cesium, api (empieza vacio, se va poblando: {} basta),
//   sim (empieza vacio: {} basta), document (para teclado/mouse, default
//   globalThis.document), SRTM_URL, definitions/fetchDefinition (ver
//   Aircraft.load, PARTE 12), shadowUrl (opcional), wakeOptions
//   (opcional), readPreferences/ui (opcionales, ver desviacion 4 arriba),
//   containerId (default "view3d", mismo nombre que usa el tutorial en
//   `api.initWorld("view3d")`) }
export function createApp(deps) {
  const Cesium = deps.Cesium;
  const doc = deps.document || (typeof document !== 'undefined' ? document : null);
  const api = deps.api || {};
  const sim = deps.sim || {};
  const aircraft = { instance: null }; // wrapper {instance}, ver nota de cabecera de aircraft.js (PARTE 12)

  const animation = createAnimation();
  const controls = createControls();
  // camera.cam = api.camera (PARTE 10.2) recien lo puebla initWorld()
  // (PARTE 10.3, viewer.camera) -- pero createMainLoop() (abajo) tiene
  // que existir ANTES de initWorld (nota de cabecera de world-init.js).
  // Se resuelve creando el objeto `camera` YA (con .cam todavia
  // undefined) para que mainLoop cierre sobre esta MISMA referencia de
  // objeto; en start(), justo despues de initWorld(), se le asigna
  // camera.cam = api.camera -- como mainLoop.camera.update(dt) lee
  // camera.cam en cada frame (no una copia), la mutacion in-place es
  // visible sin tener que reconstruir mainLoop (a diferencia de weather/
  // waterDetection/dayNightManager, que SI son objetos nuevos creados
  // recien despues de cargar la aeronave y necesitan el wrapper
  // wrapWithWaterAndWeather() de mas abajo).
  const camera = createCamera({ api, sim, aircraft });
  const flight = createFlightTerrainManager(api, sim);

  let mainLoop = null;
  let weather = null;
  let dayNightManager = null;
  let waterDetection = null;
  let waterState = null;
  let flyTo = null;

  // --- 12.0 — motor del loop (ANTES de initWorld, ver nota (1) arriba) ---
  // Se crea sin weather/dayNightManager/waterDetection/water todavia
  // (no existen hasta que start() los arme mas abajo, DESPUES de
  // cargar la aeronave) -- se reconectan via wrapWithWaterAndWeather()
  // al final de start(), ver nota extensa ahi.
  mainLoop = createMainLoop({
    api, sim, aircraft, controls, camera, flight,
    dayNightManager: null,
    weather: null,
    waterDetection: null,
    water: null,
    MS_TO_KNOTS,
    animation,
  });

  // --- controles de teclado / orbita de mouse (PARTE 10.1/10.2) ---
  let detachKeyboard = null;
  let detachMouseOrbit = null;
  if (doc) {
    detachKeyboard = attachKeyboardControls(controls, doc, camera.cycleCamera);
  }

  async function start(aircraftId, coords) {
    // 1. preferencias/UI — opcionales, ver desviacion (4)
    if (deps.readPreferences) deps.readPreferences();
    if (deps.ui && deps.ui.init) deps.ui.init();

    // 2. sim.world = api.initWorld("view3d") -- world-init.js (PARTE 10.3)
    //    ya exige que api.frameCallbackWrapper exista ANTES de esta
    //    llamada; mainLoop ya lo definio arriba al construirse.
    sim.world = initWorld(
      { api, sim, Cesium, initTerrain: deps.initTerrain, SRTM_URL: deps.SRTM_URL },
      deps.containerId || 'view3d'
    );
    // Ver nota de arriba: recien ahora existe api.camera -- se completa
    // el objeto `camera` ya construido (misma referencia que mainLoop
    // ya tiene cerrada por closure).
    camera.cam = api.camera;

    // createGroundAltitudeApi (PARTE 4.3/4.4/4.5) -- OTRA pieza que el
    // resto del proyecto ya esperaba (flight.terrainElevationManagement,
    // makeFlyTo, contact-detection.js, todos llaman
    // api.getGroundAltitude*/api.getGuarantiedGroundAltitude desde PARTE
    // 4) sin que nada la hubiera invocado todavia -- mismo patron que
    // createAtmosphere/attachPlaceParts en PARTE 12.0. Necesita
    // api.viewer/api.Cesium/api.sim/api.renderingSettings ya listos, por
    // eso se llama justo aca, DESPUES de initWorld (que puebla
    // api.viewer) y ANTES de cargar la aeronave (que ya la necesita).
    api.Cesium = Cesium;
    api.sim = sim;
    api.renderingSettings = api.renderingSettings || { physicsDeltaMs: 10 };
    createGroundAltitudeApi(api);

    // afterInitWorld(api) — hook OPCIONAL para que el integrador cuelgue
    // dependencias que necesitan api.viewer/api.camera ya existentes
    // (ej. render-layer.js: api.Model/api.Canvas/api.ParticleEmitter/
    // setCameraPositionAndOrientation con Cesium real -- ver
    // src/app/bootstrap.js). No confundir con deps.initFx (paso 8, mas
    // abajo): este hook corre ANTES de cargar la aeronave (que ya
    // necesita api.Model para instanciar su glTF).
    if (deps.afterInitWorld) deps.afterInitWorld(api);

    if (api.renderingQuality && deps.preferences) {
      api.renderingQuality(deps.preferences.graphics && deps.preferences.graphics.quality);
    }

    // flyTo (PARTE 4.10) necesita mainLoop.doPause/undoPause -- recien
    // disponibles ahora que mainLoop existe. attachCautiousTerrainProbing
    // (PARTE 4.10) es quien define flight.probeTerrain -- se llama
    // SIEMPRE (no solo si hay `doc`), porque probeTerrain() se usa mas
    // abajo incondicionalmente al cargar la aeronave; viewport/doc nulos
    // solo desactivan el dispatchEvent()/listener de DOM, no rompen la
    // funcion en si (ver la guarda `if (viewport)`/`if (doc)` dentro de
    // attachCautiousTerrainProbing).
    flyTo = makeFlyTo(api, sim, flight, aircraft, MS_TO_KNOTS, mainLoop.doPause, mainLoop.undoPause);
    attachCautiousTerrainProbing(flight, sim, doc, doc);

    // 3-4. sim.aircraft.instance = new Aircraft(coords); probeTerrain();
    //      await instance.load(aircraftId, coords)
    aircraft.instance = new Aircraft(coords);
    flight.probeTerrain();
    await aircraft.instance.load(aircraftId, coords, {
      api, sim, MS_TO_KNOTS,
      definitions: deps.definitions,
      fetchDefinition: deps.fetchDefinition,
      shadowUrl: deps.shadowUrl,
      wakeOptions: deps.wakeOptions,
    });

    // 5. camera.init(coords) -- PARTE 10.2 ya expone buildDefinitions()
    //    (lee aircraft.definition.cameras, "camera.reset()" del punto 7
    //    de la lista de PARTE 12); se llama aca, DESPUES de que
    //    aircraft.instance.definition ya exista.
    camera.buildDefinitions();
    camera.lla = aircraft.instance.llaLocation.slice();
    if (doc && doc.getElementById && deps.viewportId) {
      const viewportEl = doc.getElementById(deps.viewportId);
      if (viewportEl) detachMouseOrbit = attachMouseOrbit(camera, viewportEl);
    }

    // 6. weather.init(coords) -- createWeather (PARTE 8.4) + viento
    //    inicial (initWind, PARTE 8.1) con los valores que traiga
    //    deps.initialWeather (direccion/velocidad de viento) o defaults
    //    razonables si no se pasan.
    weather = createWeather({ sim, api, camera, Cesium, animation, aircraft });
    // createAtmosphere (PARTE 5.2) puebla weather.atmosphere.* -- otro
    // caso de "el resto del codigo ya lo esperaba" (flight-tick.js,
    // airfoils.js, balloons.js, PARTE 5, ya leen weather.atmosphere.*
    // desde hace varias partes) sin que nada lo hubiera llamado todavia.
    // Se llama aca, justo despues de createWeather (que es quien crea
    // weather.definition, del que createAtmosphere depende).
    createAtmosphere(weather);
    const iw = deps.initialWeather || {};
    weather.initWind(iw.windDirection || 0, iw.windSpeed || 0);
    // fxState: objeto compartido y mutable pasado POR REFERENCIA tanto a
    // createDayNightManager() (que lo necesita YA, para fx.sunDotNormal/
    // fx.atmosphere) como a deps.initFx() mas abajo (paso 8) -- mismo
    // motivo que camera.cam antes: dayNightManager cierra sobre `fx` por
    // destructuring al construirse, asi que initFx() debe ESCRIBIR sobre
    // este mismo objeto (Object.assign) en vez de devolver uno nuevo, o
    // dayNightManager seguiria viendo el viejo.
    const fxState = {};
    dayNightManager = createDayNightManager({ api, sim, camera, Cesium, fx: fxState, aircraft });

    // 7. api.setWaterEffect(...) + PARTE 11 (agua/oleaje) — el tutorial
    //    solo pide un toggle visual (fx.water.update SOLO si
    //    preferences.graphics.waterEffect); PARTE 11 ya construye
    //    waterDetection/waterState reales, se instancian aca y quedan
    //    detras del mismo flag para no pagar el costo de un tile fetch
    //    por frame si el usuario lo desactivo.
    const waterEnabled = !deps.preferences || deps.preferences.graphics == null
      || deps.preferences.graphics.waterEffect !== false;
    if (api.setWaterEffect) api.setWaterEffect(waterEnabled);
    if (waterEnabled) {
      waterDetection = createWaterDetection({ api, sim, Canvas: deps.Canvas, LANDUSE_SERVER: deps.LANDUSE_SERVER });
      waterDetection.create();
      waterState = createWaterState({ api });
    }

    // 8. fx.init() -- CloudManager/atmosphere-stage (PARTE 6/7) y
    //    day-night (PARTE 8.3, dayNightManager ya creado arriba) son las
    //    piezas de "fx" que este proyecto construyo; su ensamblado fino
    //    (createCloudAtmosphere + createCloudManager con las texturas/
    //    shaders reales) depende de tener Cesium.PostProcessStage
    //    disponible de verdad, asi que queda como deps.initFx(...)
    //    OPCIONAL invocado aca si el llamador lo provee, en vez de
    //    hardcodear una unica forma de armar `fx` -- distintas
    //    aeronaves/escenas pueden querer distintas calidades de nube
    //    desde el arranque (ver CLOUD_QUALITY_LEVELS, PARTE 6.4).
    let fx = fxState;
    if (deps.initFx) {
      const built = await deps.initFx({ api, sim, weather, camera, Cesium, aircraft });
      Object.assign(fxState, built); // ver nota fxState mas arriba: NO reemplazar la referencia
    }

    // Reconectar el loop principal con las piezas que recien se crearon.
    // mainLoop ya existia (necesario para frameCallbackWrapper antes de
    // initWorld, nota (1)) pero corria sin flightTick/weather/
    // dayNightManager/water hasta este punto.
    // collectContacts/resolveContacts (PARTE 4.7/4.8): flight-tick.js
    // (PARTE 5.6) los invoca como `collectContacts(ac, subDt)` /
    // `resolveContacts(ac, contacts, subDt)` -- firmas MAS CORTAS que
    // las que contact-detection.js/collision-response.js exportan de
    // verdad (`collectContacts(api, sim, animation, aircraft, dt)` /
    // `resolveContacts(rb, sim, aircraft, contacts, dt)`). Se cierran
    // aca las dependencias fijas del frame (api/sim/animation) para
    // exponer exactamente la firma corta que flight-tick.js espera, en
    // vez de tocar ese archivo (ya entregado y probado en PARTE 4).
    mainLoop.setFlightTick(makeFlightTick(aircraft, {
      api, weather, controls, animation, Object3D, sim,
      collectContacts: (ac, dt) => collectContacts(api, sim, animation, ac, dt),
      resolveContacts: (ac, contacts, dt) => resolveContacts(ac.rigidBody, sim, ac, contacts, dt),
      autopilot: deps.autopilot,
      flight: Object.assign(flight, {
        setAnimationValues: makeSetAnimationValues(aircraft, {
          animation, controls, weather, sim, exponentialSmoothing,
          METERS_TO_FEET, MS_TO_KNOTS, GRAVITY,
        }),
      }),
    }));

    // createMainLoop (PARTE 10.4) cerro weather/dayNightManager/
    // waterDetection/water por closure AL CONSTRUIRSE (const {...} =
    // deps, arriba en main-loop.js) — reasignar esas variables locales
    // en mainLoop no las reconecta ahi dentro (limitacion conocida de
    // JS con closures, no un bug). En vez de tocar main-loop.js otra vez
    // (que ya esta probado y entregado), se envuelve
    // api.frameCallbackWrapper para correr weather.updateWind/
    // dayNightManager.update/updateWaterState alrededor del wrapper
    // original, en el MISMO orden relativo (fin de frame, despues de
    // camera.update, que ya corre dentro del wrapper original) que
    // main-loop.js documenta.
    api.frameCallbackWrapper = wrapWithWaterAndWeather(api.frameCallbackWrapper, {
      sim, aircraft, weather, dayNightManager, waterDetection, water: waterState && waterState.water,
    });

    return { aircraft, camera, weather, dayNightManager, waterDetection, waterState, fx, flyTo };
  }

  function destroy() {
    if (detachKeyboard) detachKeyboard();
    if (detachMouseOrbit) detachMouseOrbit();
  }

  return {
    start, destroy, api, sim, aircraft, camera, controls, animation, flight, mainLoop,
    get flyTo() { return flyTo; },
  };
}

// ----------------------------------------------------------------------------
// wrapWithWaterAndWeather — ver nota larga arriba (reconexion del loop):
// createMainLoop (PARTE 10.4) ya deja armado api.frameCallbackWrapper
// ANTES de que weather/waterDetection/waterState existan (initWorld
// necesita el wrapper antes que nada, nota (1)). Esta funcion envuelve
// ESE wrapper para, en cada frame, correr TAMBIEN weather.updateWind/
// dayNightManager.update/updateWaterState — exactamente lo que
// createMainLoop ya hace internamente cuando esas deps SI estan
// disponibles desde el principio. Reusa las MISMAS funciones que
// main-loop.js ya importa (updateWaterState, weather.updateWind) en vez
// de duplicar esa logica.
//
// sim.pause: se re-verifica aca (ademas de adentro del wrapper original)
// porque updateWaterState/weather.updateWind/dayNightManager.update NO
// deberian correr si el frame esta pausado -- el wrapper original ya
// hace `return` temprano si sim.pause, pero eso no evita que ESTE
// wrapper externo siga ejecutando el resto de su cuerpo despues de
// llamarlo.
// ----------------------------------------------------------------------------
function wrapWithWaterAndWeather(baseWrapper, ctx) {
  return function wrapped() {
    baseWrapper();
    if (ctx.sim.pause || !ctx.aircraft.instance) return;
    if (ctx.weather && ctx.weather.updateWind) ctx.weather.updateWind(ctx.aircraft.instance.llaLocation);
    if (ctx.dayNightManager) ctx.dayNightManager.update();
    if (ctx.waterDetection && ctx.water) {
      updateWaterState({}, ctx.waterDetection, ctx.water, ctx.sim, ctx.aircraft);
    }
  };
}
