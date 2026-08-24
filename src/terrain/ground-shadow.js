// ============================================================================
// PARTE 4.11 — SOMBRAS PROYECTADAS SOBRE EL TERRENO
//
// La sombra del avion NO es un shadow map (caro, y el globo no siempre
// recibe). Es un decal glTF plano, orientado con la normal del suelo.
// ============================================================================

import { V3, M33 } from '../core/vectors.js';
import { getCollisionResult, getNormalFromCollision } from './ground-sampling.js';

// api.Model debe ser el constructor de modelo glTF de la capa de render
// (inyectado desde fuera; este modulo no conoce Cesium directamente).
export function Shadow(api, url, scaleBox) {
  this.api = api;
  this.scale = V3.scale(scaleBox, 2);
  this.scale[2] = 1;
  this.shadow = new api.Model(url);
  this.context = {};
  this.shadowOffset = 0.1; // metros sobre el suelo, evita z-fight
}

Shadow.prototype.setLocationRotation = function (sim, aircraft, lla) {
  const coll = getCollisionResult(this.api, sim, lla, [0, 0, 0], aircraft.collResult, this.context);
  const n = getNormalFromCollision(this.api, coll, this);
  const fwd = aircraft.object3d.getWorldFrame()[1];
  const right = V3.normalize(V3.cross(fwd, n));
  const look = V3.cross(n, right);
  const frame = [right, look, n];
  const htr = M33.getOrientation(frame);
  const pos = [lla[0], lla[1], coll.location[2] + this.shadowOffset];
  this.shadow.setPositionOrientationAndScale(pos, htr, this.scale);
};
