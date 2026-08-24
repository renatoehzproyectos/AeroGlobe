// ============================================================================
// PARTE 11.0 — Constantes de agua (tile de landuse, oleaje)
//
// El tutorial no da un objeto de defaults; los numeros literales del
// fragmento de PARTE 11 (tileSize 256, zoomLevel 11, depthSlope 0.03,
// depthOffset 1.5, k=0.02 en getWaveHeight, amplitud 0.4, frecuencias
// espaciales 6000/6000 y temporal 1/0.7) se centralizan aca en vez de
// quedar hardcodeados en water-detection.js / waves.js, siguiendo el
// mismo patron que src/weather/constants.js (PARTE 8.0) y
// src/clouds/constants.js (PARTE 6.4).
// ============================================================================

export const WATER_DEFAULTS = {
  // --- deteccion de agua (tile PNG de landuse, canal B = profundidad) ---
  tileSize: 256,
  zoomLevel: 11,
  depthSlope: 0.03,
  depthOffset: 1.5,

  // --- oleaje de mar abierto (PARTE 11, fx.water.getWaveHeight) ---
  waveAmplitude: 0.4,
  waveSpatialFreqLat: 6000,
  waveSpatialFreqLon: 6000,
  waveTemporalFreq: 1,
  waveTemporalFreqLonRatio: 0.7,

  // Umbral bajo el cual groundElevation cuenta como "mar" (vs. un lago
  // de montana con groundElevation alto pero igual marcado como agua
  // por el landuse tile) — mencionado en prosa en PARTE 11
  // ("Si groundElevation < 0.1 m y hay agua, es MAR").
  seaLevelThreshold: 0.1,

  // dt pequeno usado para estimar waveVerticalSpeed por diferencia finita
  // (d/dt de getWaveHeight); no viene del tutorial (el tutorial solo da
  // la posicion de la ola, no su derivada, pero collision-response.js
  // PARTE 4.8 ya lee sim.waveVerticalSpeed) — ver NOTA en waves.js.
  waveDerivativeDt: 0.05,
};

// LANDUSE_SERVER: el tutorial lo referencia como constante ya existente
// (`LANDUSE_SERVER + this.zoomLevel + ...`) sin definirla en ningun lado
// visible del texto (como SRTM_URL en PARTE 10.3, que world-init.js ya
// recibe inyectada en vez de asumir un global). Se deja aca como default
// razonable de un servicio de tiles de landuse tipo Mapbox/OSM,
// SOBREESCRIBIBLE por quien arme PARTE 12 pasando su propio deps.LANDUSE_SERVER.
export const DEFAULT_LANDUSE_SERVER = 'https://api.maptiler.com/tiles/landuse/';
