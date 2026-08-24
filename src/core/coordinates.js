// ============================================================================
// PARTE 3 — COORDENADAS GEOGRAFICAS
//
// El avion vive en LLA. La fisica vive en metros ENU locales. Cada frame
// conviertes fuerzas y velocidades entre ambos.
//
// Convenciones (ver tutorial, "Como usar este manual"):
//   LLA = [latitud_grados, longitud_grados, altitud_metros]
//   XYZ local = East-North-Up en metros, relativo a un LLA de referencia
// ============================================================================

import {
  DEGREES_TO_RAD,
  RAD_TO_DEGREES,
  MERIDIONAL_RADIUS,
  METERS_TO_LOCAL_LAT,
  fixAngle360,
} from './constants.js';
import { V3, M33 } from './vectors.js';

// ----------------------------------------------------------------------------
// 3.1  Aproximacion plana (rapida, para fisica)
//
// A ~1 grado de latitud = 111.32 km. La longitud se comprime con cos(lat).
// Valida en un radio de ~50-100 km. Para integrar la velocidad del avion
// (decenas de metros por frame) es perfecta.
// ----------------------------------------------------------------------------

export function xy2ll(xy, refLla) {
  // xy = [east_m, north_m]  ->  [dLat, dLon] en GRADOS
  const dLat = xy[1] * METERS_TO_LOCAL_LAT;
  const metersPerLonDeg =
    Math.cos((refLla[0] + dLat) * DEGREES_TO_RAD) * MERIDIONAL_RADIUS * DEGREES_TO_RAD;
  const dLon = xy[0] / metersPerLonDeg;
  return [dLat, dLon];
}

export function ll2xy(dll, refLla) {
  // dll = [dLat, dLon] grados  ->  [east_m, north_m]
  const north = dll[0] / METERS_TO_LOCAL_LAT;
  const metersPerLonDeg =
    Math.cos((refLla[0] + dll[0]) * DEGREES_TO_RAD) * MERIDIONAL_RADIUS * DEGREES_TO_RAD;
  const east = dll[1] / (1 / metersPerLonDeg);
  // 1/metersPerLonDeg * dll[1]  ==  dll[1] * metersPerLonDeg
  return [dll[1] * metersPerLonDeg, north];
}

export function lla2xyz(dLla, refLla) {
  const xy = ll2xy(dLla, refLla);
  return [xy[0], xy[1], dLla[2]];
}

export function xyz2lla_fast(xyz, refLla) {
  const ll = xy2ll([xyz[0], xyz[1]], refLla);
  return [ll[0], ll[1], xyz[2]];
}

// ----------------------------------------------------------------------------
// 3.2  Conversion exacta con el elipsoide (para modelos y sombras)
//
// Cuando colocas un modelo 3D o una sombra en el globo, usa el frame ENU
// de Cesium. Si no, en latitudes altas el avion se "inclina" respecto al
// suelo. Requiere que `Cesium` y `viewer` esten disponibles en el ambito
// de llamada (se inyectan desde fuera de este modulo puro).
// ----------------------------------------------------------------------------

export function xyz2lla_cesium(xyz, refLla, viewer, Cesium) {
  const ellipsoid = viewer.scene.globe.ellipsoid;
  const origin = Cesium.Cartesian3.fromDegrees(refLla[1], refLla[0], refLla[2]);
  const enu = new Cesium.Matrix4();
  Cesium.Transforms.eastNorthUpToFixedFrame(origin, ellipsoid, enu);
  const local = new Cesium.Cartesian3(xyz[0], xyz[1], xyz[2]);
  const world = Cesium.Matrix4.multiplyByPoint(enu, local, new Cesium.Cartesian3());
  const carto = Cesium.Cartographic.fromCartesian(world, ellipsoid);
  if (!carto) return [0, 0, 0];
  return [
    carto.latitude * RAD_TO_DEGREES - refLla[0],
    carto.longitude * RAD_TO_DEGREES - refLla[1],
    carto.height - refLla[2],
  ];
}

// Distancia 3D entre dos LLA, en metros (usa la aproximacion plana 3.1,
// valida a escala local; para tramos largos usa la formula de Vincenty
// aparte, fuera del alcance de este modulo).
export function llaDistanceMeters(a, b) {
  const xyz = lla2xyz([b[0] - a[0], b[1] - a[1], b[2] - a[2]], a);
  return V3.length(xyz);
}

// ----------------------------------------------------------------------------
// 3.3  Tiles web mercator (para landuse / agua / OSM)
// ----------------------------------------------------------------------------

export function coord2tile(lat, lon, z) {
  const n = Math.pow(2, z);
  const latRad = lat * DEGREES_TO_RAD;
  return {
    x: Math.floor((lon + 180) / 360 * n),
    y: Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n),
  };
}

export function tile2coord(x, y, z) {
  const n = Math.pow(2, z);
  return {
    lon: x / n * 360 - 180,
    lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * y / n))) * RAD_TO_DEGREES,
  };
}

// Tiles geograficos (no mercator) usados por algunos datasets WGS84
export const WGS84_TILE_SIZE = 256;
export function WGS84Coord2tile(lat, lon, z) {
  const n = Math.pow(2, z);
  return {
    x: Math.floor(fixAngle360(lon + 180) * n / WGS84_TILE_SIZE),
    y: Math.floor((90 - lat) * n / WGS84_TILE_SIZE),
  };
}

// ----------------------------------------------------------------------------
// 3.4  lookAt — orientar la camara hacia el avion
// ----------------------------------------------------------------------------

export function lookAt(targetLla, eyeLla, up) {
  const delta = lla2xyz(
    [targetLla[0] - eyeLla[0], targetLla[1] - eyeLla[1], targetLla[2] - eyeLla[2]],
    eyeLla
  );
  const forward = V3.normalize(delta);
  const frame = M33.makeOrthonormalFrame(forward, up || [0, 0, 1]);
  return M33.getOrientation(frame);
}
