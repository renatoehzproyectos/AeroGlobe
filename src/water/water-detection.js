// ============================================================================
// PARTE 11.1 — api.waterDetection: profundidad de agua desde tile de landuse
//
// Transcripcion del fragmento del tutorial (create/getWaterDepth), con dos
// diferencias documentadas:
//
// 1) EL TUTORIAL DEFINE `api.waterDetection` COMO UN OBJETO LITERAL con
//    metodos que capturan `this`. Aca se envuelve en una factory
//    (createWaterDetection(deps)) para poder inyectar
//    { api, sim, Canvas, coord2tile, tile2coord, LANDUSE_SERVER } por
//    parametro en vez de globals, igual que TODO el resto del proyecto
//    (ver notas de PARTE 4 / PARTE 6 / PARTE 8 sobre este mismo patron).
//    `this` adentro de los metodos sigue siendo el objeto waterDetection
//    (metodos normales, no arrow functions), asi que la logica interna es
//    identica a la del tutorial.
//
// 2) `reset()` — elevation-management.js (PARTE 4.10, ya entregado) ya
//    llama `api.waterDetection.reset()` dentro de makeFlyTo, pero el
//    tutorial nunca define ese metodo (solo lo menciona al nombrar la
//    dependencia pendiente). Se completa aca: invalida el tile cacheado
//    (lastTileURL = null) para forzar una recarga en la nueva posicion
//    en vez de seguir leyendo pixeles del tile viejo (que corresponde a
//    un lugar del mapa completamente distinto tras un teletransporte).
//
// api.Canvas: mismo tipo de dependencia que api.Model en ground-shadow.js
// (PARTE 4.11) / aircraft-tree.js (PARTE 9.1) — constructor de canvas 2D
// inyectado por la capa de render (Cesium/DOM), con
// { width, height, color, willReadFrequently } y los metodos
// .loadTiles(url) / .context.getImageData(x, y, w, h).
// ============================================================================

import { coord2tile, tile2coord } from '../core/coordinates.js';
import { WATER_DEFAULTS, DEFAULT_LANDUSE_SERVER } from './constants.js';

// deps: { api, sim, Canvas (constructor, default api.Canvas),
//         LANDUSE_SERVER (default DEFAULT_LANDUSE_SERVER),
//         tileSize/zoomLevel/depthSlope/depthOffset (default WATER_DEFAULTS) }
export function createWaterDetection(deps) {
  const { api, sim } = deps;
  const Canvas = deps.Canvas || (api && api.Canvas);
  const LANDUSE_SERVER = deps.LANDUSE_SERVER || DEFAULT_LANDUSE_SERVER;

  const waterDetection = {
    tileSize: deps.tileSize || WATER_DEFAULTS.tileSize,
    zoomLevel: deps.zoomLevel || WATER_DEFAULTS.zoomLevel,
    depthSlope: deps.depthSlope != null ? deps.depthSlope : WATER_DEFAULTS.depthSlope,
    depthOffset: deps.depthOffset != null ? deps.depthOffset : WATER_DEFAULTS.depthOffset,
    lastDepth: 0,
    lastTileURL: null,
    initialized: false,
    tileOrigin: null,
    pixelGeographicSize: null,

    create() {
      this.canvasAPI = new Canvas({
        width: this.tileSize,
        height: this.tileSize,
        color: '#000',
        willReadFrequently: true,
      });
      this.initialized = true;
    },

    getWaterDepth(lat, lon) {
      if (!this.initialized) return null;

      const tile = coord2tile(lat, lon, this.zoomLevel);
      const url = LANDUSE_SERVER + this.zoomLevel + '/' + tile.x + '/' + tile.y + '.png';

      if (this.lastTileURL !== url) {
        this.canvasAPI.loadTiles(url);
        this.lastTileURL = url;
        this.tileOrigin = tile2coord(tile.x, tile.y, this.zoomLevel);
        const next = tile2coord(tile.x + 1, tile.y + 1, this.zoomLevel);
        this.pixelGeographicSize = {
          lat: (next.lat - this.tileOrigin.lat) / this.tileSize,
          lon: (next.lon - this.tileOrigin.lon) / this.tileSize,
        };
        // El tile recien pedido todavia no cargo (loadTiles es async):
        // devolver el ultimo valor conocido en vez de leer pixeles de un
        // canvas que puede seguir mostrando el tile anterior a mitad de
        // transicion, exactamente como hace el tutorial.
        return this.lastDepth;
      }

      const px = Math.round((lon - this.tileOrigin.lon) / this.pixelGeographicSize.lon);
      const py = Math.round((lat - this.tileOrigin.lat) / this.pixelGeographicSize.lat);
      const c = this.canvasAPI.context.getImageData(px, py, 1, 1).data;
      let depth = this.depthSlope * c[2] - this.depthOffset;
      if (sim.cautiousWithTerrain) depth = 0;
      this.lastDepth = depth;
      return depth;
    },

    // Completado (no estaba en el tutorial, ver NOTA de cabecera arriba):
    // invalida el tile cacheado tras un teletransporte (makeFlyTo,
    // PARTE 4.10) para que el proximo getWaterDepth() pida el tile
    // correcto de la NUEVA posicion en vez de seguir usando
    // tileOrigin/pixelGeographicSize del lugar anterior.
    reset() {
      this.lastTileURL = null;
      this.tileOrigin = null;
      this.pixelGeographicSize = null;
      this.lastDepth = 0;
    },
  };

  if (api) api.waterDetection = waterDetection;
  return waterDetection;
}
