// ============================================================================
// PARTE 6.9 — COBERTURA SATELITAL EN TIEMPO REAL
//
// Una textura equirectangular (proyectada WGS84) del mapa de nubes de un
// proveedor tipo NOAA/EUMETSAT, un solo canal, actualizada periodicamente.
// El shader la muestrea con czm_ellipsoidWgs84TextureCoordinates(normal)
// y la usa para MULTIPLICAR la cobertura procedural (ver cloudDensity en
// shaders/atmosphere-common.glsl, bloque #ifdef REALTIME_CLOUDS): el
// umbral 0.4 y el *10 convierten un mapa suave en una mascara con bordes
// razonablemente definidos, en vez de un gradiente difuso.
//
// Cuando realtime esta activo, cloudCover del clima se fuerza a 1 (100%)
// y es la textura la que manda sobre donde hay nube o no.
// ============================================================================

export const REALTIME_CLOUDS_UPDATE_PERIOD_MS = 600000; // 10 min

// Construye la URL con cache-bust por hora (?t=hourStamp): evita servir
// un frame de mas de una hora de antiguedad desde cache de navegador/CDN
// sin tener que desactivar cache por completo.
export function realtimeCloudTextureUrl(baseUrl) {
  const hourStamp = Math.floor(Date.now() / 3600000);
  return baseUrl + '?t=' + hourStamp;
}

// weather: { realTimeCloudTexture: url base, sin query string }
// atmosphereStage: instancia devuelta por createCloudAtmosphere() (ver
// ./atmosphere-stage.js), debe tener atmospherePostProcessStage y
// (opcional) cloudsPostProcessStage ya creados con realtime=true.
//
// Llamar cada REALTIME_CLOUDS_UPDATE_PERIOD_MS (setInterval externo,
// PARTE 12 lo engancha al loop principal): sube la URL fresca a ambos
// stages sin tener que recrearlos.
export function refreshRealtimeCoverage(weather, atmosphereStage) {
  if (!weather.realTimeCloudTexture || !atmosphereStage.atmospherePostProcessStage) return;
  const url = realtimeCloudTextureUrl(weather.realTimeCloudTexture);
  atmosphereStage.atmospherePostProcessStage.uniforms.coverageTexture = url;
  if (atmosphereStage.cloudsPostProcessStage) {
    atmosphereStage.cloudsPostProcessStage.uniforms.coverageTexture = url;
  }
}
