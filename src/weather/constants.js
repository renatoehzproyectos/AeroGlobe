// ============================================================================
// PARTE 8 — CLIMA: VALORES POR DEFECTO
//
// weather.definition arranca como una copia de WEATHER_DEFAULTS y se
// sobreescribe con lo que traiga el METAR/escenario activo. Nunca mutar
// WEATHER_DEFAULTS directamente (por eso createWeather() en weather.js
// hace Object.assign({}, WEATHER_DEFAULTS), no una referencia).
// ============================================================================

import { AIR_PRESSURE_SL, AIR_TEMP_SL } from '../core/constants.js';

export const WEATHER_DEFAULTS = {
  // Nubes (PARTE 6, ya consumido por CloudManager/atmosphere-stage)
  cloudCover: 0,
  cloudBase: 1000,
  cloudTop: 3000,
  cloudThickness: 4000,
  cloudCoverThickness: 200,       // grosor de "sopa" al estar in-cloud

  // Niebla / visibilidad
  fogDensity: 0,
  fogCeiling: 1000,
  fogBottom: 0,
  visibility: 10000,              // m

  // Precipitacion (PARTE 8, visual/gameplay — se consume en PARTE 11/12)
  precipitationType: 'none',      // 'none' | 'rain' | 'snow'
  precipitationAmount: 0,         // 0-1
  thunderstorm: 0,                // 0-1

  // Viento (8.1)
  windDirection: 0,               // grados FROM, meteorologico
  windSpeedMS: 0,
  windGustMS: 0,
  windLayerHeight: 7000,          // m, grosor tipico de cada capa
  windLayerNb: 3,                 // cantidad de capas generadas por initWind

  // Turbulencia y termicas (8.2)
  turbulences: 0,                 // 0-1
  thermals: 0,                    // 0-1

  // Atmosfera ISA de referencia (PARTE 5.2 la consume via createAtmosphere)
  airPressureSL: AIR_PRESSURE_SL,
  airTemperatureSL: AIR_TEMP_SL,
};
