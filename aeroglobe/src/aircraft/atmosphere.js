// ============================================================================
// PARTE 5.2 — ATMOSFERA ISA
//
// Modelo lineal de la troposfera: temperatura cae con TEMPERATURE_LAPSE_RATE
// hasta la altitud dada (el modelo NO aplana en la tropopausa a 11 km; es
// una limitacion aceptable para GA y jets civiles mientras no se pase de
// ~FL500). La densidad alimenta TODA la aerodinamica (lift, drag, y de
// forma indirecta el empuje de helice via el ASI/mach).
//
// Valores de referencia a verificar tras integrar:
//   SL:      rho = 1.225 kg/m3,  T = 15 C,    p = 101325 Pa
//   3000 m:  rho ~ 0.909
//   11000m:  rho ~ 0.364, T = -56.5 C
// ============================================================================

import { clamp } from '../core/constants.js';
import {
  KELVIN_OFFSET,
  TEMPERATURE_LAPSE_RATE,
  GM_RL,
  IDEAL_GAS_CONSTANT,
  MOLAR_MASS_DRY_AIR,
} from '../core/constants.js';

// weather: objeto de estado inyectado con:
//   weather.definition = { airTemperatureSL (C), airPressureSL (Pa), ... }
//   weather.contrailTemperatureThreshold  (C, tipicamente -40)
// Este modulo escribe weather.atmosphere.* y weather.contrailAltitude.
export function createAtmosphere(weather) {
  weather.atmosphere = {};

  weather.atmosphere.update = function (altMeters) {
    altMeters = altMeters || 0;
    const T0k = weather.definition.airTemperatureSL + KELVIN_OFFSET; // 288.15 tipico
    const T = weather.definition.airTemperatureSL - altMeters * TEMPERATURE_LAPSE_RATE;
    weather.atmosphere.airTempAtAltitude = T;
    weather.atmosphere.airTempAtAltitudeKelvin = T + KELVIN_OFFSET;

    const sigmaT = clamp(1 - (altMeters * TEMPERATURE_LAPSE_RATE) / T0k, 0, 1);
    weather.atmosphere.airPressureAtAltitude =
      weather.definition.airPressureSL * Math.pow(sigmaT, GM_RL);

    weather.atmosphere.airDensityAtAltitude =
      (weather.atmosphere.airPressureAtAltitude * MOLAR_MASS_DRY_AIR) /
      (IDEAL_GAS_CONSTANT * weather.atmosphere.airTempAtAltitudeKelvin);

    // Contrails cuando T < contrailTemperatureThreshold (tipicamente -40 C).
    weather.contrailAltitude =
      -((weather.contrailTemperatureThreshold - weather.definition.airTemperatureSL) /
        TEMPERATURE_LAPSE_RATE);
  };

  // a = velocidad del sonido local (formula empirica, C -> m/s).
  weather.atmosphere.msToMach = function (ms) {
    const a = 331.3 + 0.606 * weather.atmosphere.airTempAtAltitude;
    return ms / a;
  };
  weather.atmosphere.machToMs = function (m) {
    const a = 331.3 + 0.606 * weather.atmosphere.airTempAtAltitude;
    return m * a;
  };

  return weather.atmosphere;
}

// Version standalone (no atada a un objeto `weather`), util para tests
// y para IAS/mach fuera del contexto del loop principal.
export function msToMach(ms, airTempAtAltitude) {
  const a = 331.3 + 0.606 * airTempAtAltitude;
  return ms / a;
}
export function machToMs(m, airTempAtAltitude) {
  const a = 331.3 + 0.606 * airTempAtAltitude;
  return m * a;
}

// IAS = TAS * sqrt(rho / rho_SL). El stall ocurre a IAS ~constante, no a
// TAS constante: si el ASI del panel usa TAS directamente ("kias = ktas",
// ver PARTE 5.9), es una mentira util pero notoria a media/alta altitud.
export function tasToIas(tas, airDensityAtAltitude, airDensitySL) {
  return tas * Math.sqrt(airDensityAtAltitude / airDensitySL);
}
