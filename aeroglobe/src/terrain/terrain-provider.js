// ============================================================================
// PARTE 4.1 / 4.2 — TERRENO SRTM Y APLANADO DE PISTAS
//
// Requiere Cesium global (pasado por parametro) y un objeto `runways` con
// `runways.nearRunways` + un `airportList` (icao -> [lat, lon]). Estos dos
// datasets se cargan aparte (fuera del alcance de este modulo).
//
// Pipeline:
//   initTerrain(viewer, Cesium, srtmUrl) monta un FlatRunwayTerrainProvider
//   que envuelve al CesiumTerrainProvider real y, en los tiles que
//   intersectan una pista, reescribe los vertices cuantizados a una cota
//   constante (la elevacion de referencia del aeropuerto).
// ============================================================================

import { xy2ll } from '../core/coordinates.js';

// ----------------------------------------------------------------------------
// 4.1  Proveedor de terreno SRTM
// ----------------------------------------------------------------------------

export async function initTerrain(viewer, Cesium, srtmUrl, runwayRegistry, airportList) {
  const base = await Cesium.CesiumTerrainProvider.fromUrl(srtmUrl, {
    requestWaterMask: false,
    requestVertexNormals: true, // el globo se ilumina mejor; NO se usa para
                                 // fisica (el quantized-mesh es ruidoso a
                                 // escala de tren de aterrizaje) — ver 4.4
    requestMetadata: false,
  });

  const provider = new FlatRunwayTerrainProvider({
    baseProvider: base,
    bypass: false, // true = no aplanar (debug)
    maximumLevel: 12,
    Cesium,
    runwayRegistry,
    airportList,
  });

  viewer.terrainProvider = provider;
  viewer.scene.globe.depthTestAgainstTerrain = true;
  viewer.scene.globe.maximumUpsamplingLevel = 22;
  viewer.scene.globe.enableLighting = false;
  viewer.scene.globe.showWaterEffect = false; // usamos agua propia (PARTE 11)
  viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString('#4b5e27');

  return provider;
}

// ----------------------------------------------------------------------------
// 4.2  Aplanar pistas — FlatRunwayTerrainProvider
//
// SRTM no resuelve una pista de 45 m de ancho. El umbral de una 07/25
// aparece como una loma de 4-8 metros. Un Cessna no puede aterrizar en una
// loma. Este wrapper reescribe los vertices cuantizados de los tiles que
// intersectan una pista a una cota constante.
//
// Como se lee esto:
//   - Solo se aplana a partir de minFlatteningLevel (6). Los tiles lejanos
//     son un pixel, no merece la pena.
//   - La elevacion de referencia se samplea UNA vez por region, al maximo
//     nivel, en las coordenadas del aeropuerto. Todas las pistas de esa
//     region comparten esa cota. Asi un cruce de pistas no tiene escalon.
//   - El test "esta este vertice sobre la pista?" es geometrico: distancia
//     al segmento threshold1-threshold2 menor que padding, y distancia al
//     umbral menor que length+padding. El Rectangle es el culling barato;
//     el test fino es el de distancia al eje.
// ----------------------------------------------------------------------------

export function FlatRunwayTerrainProvider(options) {
  this.baseProvider = options.baseProvider;
  this.Cesium = options.Cesium;
  this.runwayRegistry = options.runwayRegistry; // { nearRunways: {...} }
  this.airportList = options.airportList || {};
  this.regions = {};
  this.defaultMinFlatteningLevel = 6;
  this.minFlatteningLevel = 6;
  this.maximumLevel = options.maximumLevel || 12;
  this.flatten = !options.bypass;
  this.setMaximumLevel(this.maximumLevel);

  const rebuild = () => {
    this.regions = {};
    const near = this.runwayRegistry ? this.runwayRegistry.nearRunways : {};
    for (const id in near) this.addRunway(near[id]);
  };
  this._rebuild = rebuild;
  document.addEventListener('runwayUpdate', rebuild);
  rebuild();
}

FlatRunwayTerrainProvider.prototype = {
  // Delegacion 1:1 de la API Cesium TerrainProvider
  get availability()      { return this.baseProvider.availability; },
  get credit()            { return this.baseProvider.credit; },
  get errorEvent()        { return this.baseProvider.errorEvent; },
  get hasVertexNormals()  { return this.baseProvider.hasVertexNormals; },
  get hasWaterMask()      { return this.baseProvider.hasWaterMask; },
  get ready()             { return this.baseProvider.ready; },
  get readyPromise()      { return this.baseProvider.readyPromise; },
  get tilingScheme()      { return this.baseProvider.tilingScheme; },

  getLevelMaximumGeometricError(level) {
    return this.baseProvider.getLevelMaximumGeometricError(level);
  },
  getTileDataAvailable(x, y, level) {
    if (level > this.maximumLevel) return false;
    return this.baseProvider.getTileDataAvailable(x, y, level);
  },
  setMaximumLevel(level) {
    this.minFlatteningLevel = level < this.defaultMinFlatteningLevel
      ? level
      : this.defaultMinFlatteningLevel;
    this.maximumLevel = level;
  },

  addRunway(rwy) {
    const Cesium = this.Cesium;
    // padding en metros -> grados locales
    const padLL = xy2ll([rwy.padding, rwy.padding], rwy.threshold1);
    const rec = Cesium.Rectangle.fromDegrees(
      Math.min(rwy.threshold1[1], rwy.threshold2[1]) - padLL[1],
      Math.min(rwy.threshold1[0], rwy.threshold2[0]) - padLL[0],
      Math.max(rwy.threshold1[1], rwy.threshold2[1]) + padLL[1],
      Math.max(rwy.threshold1[0], rwy.threshold2[0]) + padLL[0]
    );
    rwy.rec = rec;
    rwy.threshold1Cartesian = Cesium.Cartesian3.fromDegrees(rwy.threshold1[1], rwy.threshold1[0]);
    rwy.threshold2Cartesian = Cesium.Cartesian3.fromDegrees(rwy.threshold2[1], rwy.threshold2[0]);
    rwy.direction = Cesium.Cartesian3.subtract(
      rwy.threshold1Cartesian, rwy.threshold2Cartesian, new Cesium.Cartesian3()
    );

    let region = {
      name: rwy.id,
      rec,
      runways: [rwy],
      coord: this.airportList[rwy.icao], // [lat, lon] del aeropuerto
      vertices: {},
    };

    // Fusiona regiones que se solapan (aeropuertos con varias pistas)
    for (const key of Object.keys(this.regions)) {
      const other = this.regions[key];
      if (Cesium.Rectangle.intersection(other.rec, region.rec) !== undefined) {
        region.rec = Cesium.Rectangle.union(region.rec, other.rec);
        region.name += other.name;
        region.runways = region.runways.concat(other.runways);
        delete this.regions[key];
      }
    }
    this.regions[region.name] = region;
  },

  requestTileGeometry(x, y, level, request) {
    const Cesium = this.Cesium;
    if (level >= this.minFlatteningLevel && this.flatten) {
      const tileRect = this.baseProvider.tilingScheme.tileXYToRectangle(x, y, level);
      for (const key in this.regions) {
        if (Cesium.Rectangle.intersection(this.regions[key].rec, tileRect) !== undefined) {
          const promise = this.baseProvider.requestTileGeometry(x, y, level, request);
          if (promise === undefined) return undefined;
          return this.getPromise(promise, tileRect, this.regions[key]);
        }
      }
    }
    return this.baseProvider.requestTileGeometry(x, y, level, request);
  },

  getPromise(tilePromise, tileRect, region) {
    const Cesium = this.Cesium;
    const elevationPromise = new Promise((resolve, reject) => {
      if (region.referenceElevation) {
        resolve(region.referenceElevation);
        return;
      }
      if (!region.coord) {
        region.coord = [region.runways[0].threshold1[0], region.runways[0].threshold1[1]];
      }
      Cesium.sampleTerrain(this.baseProvider, this.maximumLevel, [
        Cesium.Cartographic.fromDegrees(region.coord[1], region.coord[0]),
      ]).then((samples) => {
        if (samples[0] && samples[0].height != null) {
          region.referenceElevation = samples[0].height;
          region.runways.forEach((r) => r.setElevation(region.referenceElevation));
          resolve(region.referenceElevation);
        } else {
          reject('no value');
        }
      });
    });

    return Promise.all([elevationPromise, tilePromise]).then(([refElev, mesh]) => {
      const Q = 32767; // quantized-mesh usa uint16 [0, 32767]
      mesh._oldMinimumHeight = mesh._minimumHeight;
      mesh._oldMaximumHeight = mesh._maximumHeight;
      const oldRange = mesh._oldMaximumHeight - mesh._oldMinimumHeight;
      const oldScale = Q / oldRange;

      let dirtyMinMax = false;
      if (refElev > mesh._maximumHeight) { mesh._maximumHeight = refElev; dirtyMinMax = true; }
      if (refElev < mesh._minimumHeight) { mesh._minimumHeight = refElev; dirtyMinMax = true; }

      const minShift = mesh._oldMinimumHeight - mesh._minimumHeight;
      const newRange = mesh._maximumHeight - mesh._minimumHeight;
      const newScale = Q / newRange;
      const flatValue = (refElev - mesh._minimumHeight) * newScale;

      const nVerts = mesh._heightValues.length;
      for (let i = 0; i < nVerts; i++) {
        // quantized-mesh: uv en [0,Q], u = [0..n), v = [n..2n)
        const lat = tileRect.south + tileRect.height * (mesh._quantizedVertices[nVerts + i] / Q);
        const lon = tileRect.west + tileRect.width * (mesh._quantizedVertices[i] / Q);
        const carto = new Cesium.Cartographic(lon, lat, 0);

        if (Cesium.Rectangle.contains(region.rec, carto)) {
          for (let r = 0; r < region.runways.length; r++) {
            const rwy = region.runways[r];
            const p = Cesium.Cartesian3.fromRadians(lon, lat);
            const d = Cesium.Cartesian3.subtract(rwy.threshold1Cartesian, p, new Cesium.Cartesian3());
            const distFromTh1 = Cesium.Cartesian3.magnitude(d);
            // Proyeccion sobre el eje de pista para obtener "offset lateral"
            const along = Cesium.Cartesian3.multiplyByScalar(
              rwy.direction,
              Cesium.Cartesian3.dot(d, rwy.direction) /
                Cesium.Cartesian3.dot(rwy.direction, rwy.direction),
              new Cesium.Cartesian3()
            );
            const lateral = Cesium.Cartesian3.subtract(d, along, new Cesium.Cartesian3());
            const lateralMag = Math.sqrt(Cesium.Cartesian3.dot(lateral, lateral));
            if (lateralMag < rwy.padding && distFromTh1 < rwy.lengthMeters + rwy.padding) {
              mesh._heightValues[i] = flatValue;
              break;
            }
          }
        } else if (dirtyMinMax) {
          // Re-cuantiza vertices fuera de pista al nuevo min/max
          mesh._heightValues[i] = (mesh._heightValues[i] / oldScale + minShift) * newScale;
        }
      }
      return mesh;
    });
  },
};

// ----------------------------------------------------------------------------
// Forma de un registro de pista (dataset de aeropuertos), ejemplo LEBL 24R.
// `setElevation` la rellena FlatRunwayTerrainProvider tras el sample.
// ----------------------------------------------------------------------------
export function makeRunwayRecord({
  id, icao, threshold1, threshold2, lengthMeters, widthMeters, padding, heading,
}) {
  return {
    id, icao, threshold1, threshold2, lengthMeters, widthMeters,
    padding: padding != null ? padding : 80, // metros extra a cada lado para el flatten
    heading, // grados magneticos o true — se consistente en todo el proyecto
    elevation: null,
    setElevation(h) { this.elevation = h; },
  };
}
