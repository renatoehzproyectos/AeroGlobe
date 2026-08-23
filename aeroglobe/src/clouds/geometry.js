// ============================================================================
// PARTE 6.1 — GEOMETRIA ESFERICA DE LA CAPA DE NUBES (lado JS)
//
// Las nubes NO son un plano a z=cloudBase: son una CASCARA ESFERICA
// alrededor del planeta. Con un plano, en el horizonte las nubes se van
// al espacio en vez de curvarse con la Tierra (ver checklist 6.10).
//
// Esta es la contraparte JS de raySphereIntersect (GLSL) en
// shaders/common.glsl — util para tests, para el CloudManager de
// billboards (6.8, que no corre en shader), y para precomputar los radios
// que se suben como uniforms cada segundo (ver atmosphere-stage.js).
// ============================================================================

import { V3 } from '../core/vectors.js';

// Deriva los radios de la capa de nubes (base y techo) a partir del
// radio LOCAL del planeta en la posicion de la camara (realPlanetRadius,
// no el planetRadius "shader" con offset — ver constants.js) y de la
// definicion de clima (cloudBase/cloudTop).
export function computeCloudLayerRadii(realPlanetRadius, cloudBase, cloudTop, cloudLayerPosition) {
  const cloudThickness = cloudTop - cloudBase;
  const baseThickness = cloudThickness * cloudLayerPosition;
  const layer = cloudBase + baseThickness;
  const cloudBaseRadius = realPlanetRadius + cloudBase;
  const cloudTopRadius = cloudBaseRadius + cloudThickness;
  return { cloudThickness, baseThickness, layer, cloudBaseRadius, cloudTopRadius };
}

// Interseccion rayo-esfera. r0 = origen del rayo (ECEF, p.ej. posicion de
// camara), rd = direccion (NO necesita estar normalizada para la formula,
// pero normalizada es lo habitual), sr = radio de la esfera.
// Devuelve [tEntrada, tSalida]; ambos negativos si no hay interseccion,
// o la esfera esta completamente detras del rayo.
export function raySphereIntersect(r0, rd, sr) {
  const a = V3.dot(rd, rd);
  const b = 2 * V3.dot(rd, r0);
  const c = V3.dot(r0, r0) - sr * sr;
  const d = b * b - 4 * a * c;
  if (d < 0) return [-1, -1];
  const sd = Math.sqrt(d);
  return [(-b - sd) / (2 * a), (-b + sd) / (2 * a)];
}

// Determina el rango [tmin, tmax] de marcha valido segun si la camara
// esta por encima, por debajo, o dentro de la capa de nubes (6.3).
// Replica exactamente la logica de calculate_clouds() en el shader, para
// poder testear sin GPU.
export function cloudMarchRange(start, dir, maxDistance, realPlanetRadius, cloudBaseRadius, cloudTopRadius) {
  const startHeight = V3.length(start) - realPlanetRadius;
  const cloudTop = cloudTopRadius - realPlanetRadius;
  const cloudBase = cloudBaseRadius - realPlanetRadius;
  const toTop = raySphereIntersect(start, dir, cloudTopRadius);
  const toBase = raySphereIntersect(start, dir, cloudBaseRadius);

  let tmin = 10;
  let tmax = maxDistance;

  if (startHeight > cloudTop) {
    if (toTop[0] < 0) return null; // mirando al espacio, nunca toca la capa
    tmin = toTop[0];
    tmax = toBase[0] > 0 ? Math.min(toBase[0], maxDistance) : Math.min(toTop[1], maxDistance);
  } else if (startHeight < cloudBase) {
    tmin = toBase[1];
    tmax = Math.min(toTop[1], maxDistance);
  } else {
    tmax = toBase[0] > 0 ? Math.min(toBase[0], maxDistance) : Math.min(toTop[1], maxDistance);
  }

  tmin = Math.max(tmin, 10);
  tmax = Math.min(tmax, maxDistance);
  if (tmax < tmin) return null;
  return [tmin, tmax];
}
