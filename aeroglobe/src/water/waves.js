// ============================================================================
// PARTE 11.2 — fx.water: oleaje de mar abierto + ensamblado por frame
//
// fx.water.getWaveHeight(lat, lon, tOffset) es transcripcion literal del
// tutorial (Math.sin/cos de lat/lon escalados + fase temporal desde
// api.precisionTime). Todo lo demas en este archivo es COMPLETADO -- el
// tutorial dice en prosa "Si groundElevation < 0.1 m y hay agua, es MAR
// (no un lago de montana) y puedes anadir oleaje" y "La boyancia ya esta
// en 4.7" pero nunca escribe el codigo que:
//   a) decide, frame a frame, si el punto actual del avion es mar,
//   b) puebla sim.waterDepth / sim.waveHeight / sim.waveVerticalSpeed,
//      que contact-detection.js (PARTE 4.7) y collision-response.js
//      (PARTE 4.8, YA ENTREGADAS) leen desde hace varias partes sin que
//      nada las haya escrito todavia.
//
// sim.waterDepth: se deja en 0 (no 'null'/'undefined') cuando NO hay mar,
// porque contact-detection.js lo usa en una condicion numerica directa
// (`sim.waterDepth > 0`) -- un NaN ahi rompe la comparacion silenciosamente
// en vez de simplemente evaluar a false.
//
// waveVerticalSpeed: el tutorial NO da su formula (solo getWaveHeight,
// que es la ALTURA de la ola, no su velocidad). collision-response.js
// (PARTE 4.8) sin embargo ya suma sim.waveVerticalSpeed a la velocidad
// relativa del punto de contacto antes de resolver el impulso de
// colision -- sin esto un flotador posado en una ola que sube recibiria
// un impulso de "aterrizaje duro" espurio cada vez que la ola lo empuja
// hacia arriba. Se estima por diferencia finita centrada de
// getWaveHeight en el tiempo (dt chico, WATER_DEFAULTS.waveDerivativeDt),
// reutilizando la MISMA formula analitica en vez de duplicarla a mano
// derivada simbolicamente -- mas facil de mantener en sync si alguien
// cambia las frecuencias de WATER_DEFAULTS despues.
// ============================================================================

import { WATER_DEFAULTS } from './constants.js';

// deps: { api (precisionTime), waveAmplitude/waveSpatialFreqLat/
//         waveSpatialFreqLon/waveTemporalFreq/waveTemporalFreqLonRatio/
//         waveDerivativeDt/seaLevelThreshold (default WATER_DEFAULTS) }
export function createWaterState(deps) {
  const { api } = deps;
  const cfg = { ...WATER_DEFAULTS, ...deps };

  const water = {
    // Transcripcion literal del fragmento del tutorial (PARTE 11), con
    // las constantes 0.4 / 6000 / 6000 / 1 / 0.7 movidas a WATER_DEFAULTS
    // (ver constants.js) en vez de quedar literales sueltos en el codigo.
    getWaveHeight(lat, lon, tOffset) {
      const t = api.precisionTime * 0.001 + (tOffset || 0);
      return (
        cfg.waveAmplitude *
        Math.sin(lat * cfg.waveSpatialFreqLat + t) *
        Math.cos(lon * cfg.waveSpatialFreqLon + t * cfg.waveTemporalFreqLonRatio)
      );
    },

    // COMPLETADO: derivada temporal de getWaveHeight por diferencia finita
    // centrada. tOffset se usa (en vez de mover `t` con api.precisionTime,
    // que ya avanzo entre frames) para no depender de si esta funcion se
    // llama antes o despues de que precisionTime se actualice ese frame.
    getWaveVerticalSpeed(lat, lon) {
      const dt = cfg.waveDerivativeDt;
      const hPlus = this.getWaveHeight(lat, lon, dt);
      const hMinus = this.getWaveHeight(lat, lon, -dt);
      return (hPlus - hMinus) / (2 * dt);
    },
  };

  // COMPLETADO: puebla sim.waterDepth/waveHeight/waveVerticalSpeed una vez
  // por frame, ANTES de flightTick (igual que
  // flight.terrainElevationManagement en main-loop.js, PARTE 10.4, del
  // que este mismo patron de "fijar estado que collectContacts va a leer
  // ese mismo frame" ya estaba documentado) -- contact-detection.js
  // (PARTE 4.7) y collision-response.js (PARTE 4.8) esperan estos tres
  // campos ya frescos cuando corren dentro del subpaso de fisica.
  //
  // sim.groundElevation lo fija flight.terrainElevationManagement
  // (PARTE 4.9) ANTES de esta llamada (ver orden en main-loop.js abajo);
  // por eso este modulo solo LEE sim.groundElevation, nunca lo escribe.
  function update(sim, aircraft) {
    const lla = aircraft && aircraft.llaLocation;
    const isSea =
      lla &&
      sim.groundElevation != null &&
      sim.groundElevation < cfg.seaLevelThreshold &&
      sim.waterDetected;

    if (!isSea) {
      sim.waterDepth = 0;
      sim.waveHeight = 0;
      sim.waveVerticalSpeed = 0;
      return;
    }

    sim.waveHeight = water.getWaveHeight(lla[0], lla[1]);
    sim.waveVerticalSpeed = water.getWaveVerticalSpeed(lla[0], lla[1]);
    // waterDepth en si NO viene del oleaje sino del tile de landuse
    // (PARTE 11.1); quien orquesta el frame (PARTE 12) es responsable de
    // setear sim.waterDetected = (waterDetection.getWaterDepth(...) > 0)
    // y sim.waterDepth = ese mismo valor ANTES de llamar a este update()
    // -- ver updateWaterState() mas abajo, que hace exactamente eso en
    // un solo paso para no duplicar la logica de "cuando hay agua" en
    // dos lugares.
  }

  return { water, update };
}

// ----------------------------------------------------------------------------
// updateWaterState — junta waterDetection (11.1) + oleaje (arriba) en la
// UNICA llamada por frame que PARTE 12 (loop principal) necesita, en vez
// de tener que orquestar "primero pedi profundidad, despues decidi si es
// mar, despues actualice el oleaje" a mano en main-loop.js cada vez.
// Sigue el mismo patron que weather.updateWind(lla) (PARTE 8.1) / que
// flight.terrainElevationManagement(ac) (PARTE 4.9): una funcion, un
// llamado por frame, deja sim.* listo para el subpaso de fisica.
// ----------------------------------------------------------------------------
export function updateWaterState(deps, waterDetection, water, sim, aircraft) {
  const lla = aircraft && aircraft.instance && aircraft.instance.llaLocation;
  if (!lla || !waterDetection || !waterDetection.initialized) {
    sim.waterDetected = false;
    sim.waterDepth = 0;
    sim.waveHeight = 0;
    sim.waveVerticalSpeed = 0;
    return;
  }

  const depth = waterDetection.getWaterDepth(lla[0], lla[1]);
  sim.waterDetected = depth != null && depth > 0;
  sim.waterDepth = sim.waterDetected ? depth : 0;

  water.update
    ? water.update(sim, aircraft.instance)
    : updateWaveOnly(water, sim, lla);
}

// Fallback interno si a `water` se le pasa el objeto crudo de getWaveHeight
// (sin el `update` de createWaterState) -- no deberia usarse en la
// integracion normal, pero evita un TypeError si alguien arma `water` a
// mano en un test.
function updateWaveOnly(water, sim, lla) {
  const isSea = sim.waterDetected && sim.groundElevation < WATER_DEFAULTS.seaLevelThreshold;
  if (!isSea) {
    sim.waveHeight = 0;
    sim.waveVerticalSpeed = 0;
    return;
  }
  sim.waveHeight = water.getWaveHeight(lla[0], lla[1]);
  sim.waveVerticalSpeed = water.getWaveVerticalSpeed(lla[0], lla[1]);
}
