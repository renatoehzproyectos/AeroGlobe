// ============================================================================
// PARTE 8 — CLIMA: ENSAMBLADO
//
// createWeather(deps) arma el objeto `weather` completo: definition
// (copia de WEATHER_DEFAULTS), el generador de ruido Perlin compartido
// (en sim.perlin), turbulencia/termicas, y el sistema de viento en capas
// (Wind, initWind, updateWind). Este es el objeto que PARTE 5.7
// (src/aircraft/airfoils.js) y PARTE 6 (CloudManager/atmosphere-stage)
// ya esperan recibir inyectado como `weather`.
//
// createDayNight(deps) es una pieza aparte (PARTE 8.3): no vive dentro
// de `weather` porque toca fx/camera/api directamente y en PARTE 10 se
// llama desde el loop principal, no desde el tick de fisica.
//
// deps (superset de lo que piden wind.js/turbulence.js — ver esos
// archivos para el detalle de cada dependencia):
//   sim, api, camera, Cesium, animation, aircraft
// ============================================================================

import { WEATHER_DEFAULTS } from './constants.js';
import { attachPerlin, attachTurbulenceAndThermals } from './turbulence.js';
import { createWindSystem } from './wind.js';

export { createDayNightManager } from './day-night.js';

export function createWeather(deps) {
  const { sim } = deps;
  const weather = {};

  // Nunca una referencia directa a WEATHER_DEFAULTS: cada vuelo tiene su
  // propia copia mutable (METAR, escenario, o el usuario cambiando
  // cloudCover/thermals a mano en el panel de clima).
  weather.definition = Object.assign({}, WEATHER_DEFAULTS);

  weather.currentWindVector = [0, 0, 0];
  weather.currentWindVectorLla = [0, 0, 0];
  weather.currentWindVectorWC = null;   // se llena en cuanto haya una capa de viento activa
  weather.currentWindDirection = 0;
  weather.currentWindSpeedMs = 0;
  weather.currentWindSpeed = 0;

  if (!sim.perlin) attachPerlin(sim);
  attachTurbulenceAndThermals(weather, sim);
  createWindSystem(weather, deps);

  return weather;
}
