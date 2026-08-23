// ============================================================================
// PARTE 5.4 / 5.5 — PERFILES AERODINAMICOS Y PERDIDA (STALL)
//
// Para cada airfoil, si TAS > 0.01 m/s:
//
//   Q       = velocidad del aire en el punto del perfil (incluye viento,
//             termica, turbulencia, propwash)
//   vHat    = Q / |Q|
//   n       = normal del perfil en mundo (forceDirection, eje local)
//   aoa     = -dot(n, vHat)              // sen(AoA) ~ AoA, angulos pequenos
//   liftDir = rotate(n, n × vHat, aoa)   // perpendicular a la corriente
//
// liftDir NO es "up" del ala: el lift aerodinamico es perpendicular a la
// CORRIENTE, no al ala. Si aplicas lift en la normal del ala, a AoA altos
// aparece una componente hacia atras que ya es induced drag (contada dos
// veces), y el avion no "siente" el giro de la sustentacion en un loop.
// Rotar n hacia la perpendicular a vHat por el propio AoA pone L
// perpendicular a Q, que es lo fisicamente correcto.
//
// TRES ramas segun lo que declare el JSON del airfoil:
//   RAMA A (foil.span)  — ala con envergadura, lifting-line simplificada
//       CL = aoa * 2pi * (AR/(AR+2))     (ala eliptica; AR=7 -> CL_alpha
//                                          ~ 4.9/rad ~ 0.085/deg, como Cessna)
//       CDi = CL^2 / (pi AR e)
//   RAMA B (foil.area, sin span) — superficie simple (cola, flap, canard)
//       CL = aoa * 2pi
//       D  = 0.5 rho V^2 (MIN_DRAG_COEF + DRAG_CONSTANT CL^2)
//   RAMA C (ni span ni area) — factores empiricos (legacy / globos / wingsuits)
//       L = liftFactor * aoa * V^2 * rho ;  D = dragFactor * |aoa| * V^2 * rho
//
// Stall (5.5): si |AoA_deg| > stallIncidence, CL (o kL) se escala por
//   1 - clamp(absA - stallIncidence, 0, 0.9*zeroLiftIncidence) / zeroLiftIncidence
// A stallIncidence, factor = 1. A zeroLiftIncidence, factor ~ 0.1. El avion
// CAE (no se queda "colgado"). Si un ala pierde y la otra no, aparece yaw+
// roll de autorrotacion porque el lift se aplica en el punto del ala: el
// spin EMERGE del modelo, no se programa aparte.
// ============================================================================

import { clamp } from '../core/constants.js';
import {
  TWO_PI, PI, RAD_TO_DEGREES,
  MIN_DRAG_COEF, DRAG_CONSTANT, PLANFORM_EFFICIENCY_FACTOR,
} from '../core/constants.js';
import { V3 } from '../core/vectors.js';

// aircraft: { rigidBody, trueAirSpeed, airVelocityDirection, definition,
//   airfoils[], stalling, angleOfAttackDeg, object3d }
// weather: { atmosphere.airDensityAtAltitude, currentWindVector,
//   thermals.currentVector, getLocalTurbulence(lla) }
// Object3D: utilidades del arbol de partes (PARTE 9), usa getPointLla.
// animationValues: bag donde se escribe `${foil.name}Lift` (para shaders/UI).
export function applyAirfoils(aircraft, dt, weather, Object3D, animationValues) {
  const rb = aircraft.rigidBody;
  const rho = weather.atmosphere.airDensityAtAltitude;
  aircraft.stalling = false;

  if (aircraft.trueAirSpeed <= 0.01) return;

  // Arrastre parasito del fuselaje, en el CG, opuesto a la corriente.
  const V2tas = aircraft.trueAirSpeed * aircraft.trueAirSpeed;
  let parasite;
  if (aircraft.definition.dragCoefficient) {
    parasite = 0.5 * aircraft.definition.dragCoefficient * rho * V2tas;
  } else {
    parasite = aircraft.definition.dragFactor * V2tas * rho;
  }
  rb.applyCentralForce(V3.scale(aircraft.airVelocityDirection, -parasite));

  for (const foil of aircraft.airfoils) {
    if (foil.disabled) continue;
    const r = foil.points.forceSourcePoint;
    const frame = foil.object3d.getWorldFrame();
    let Q = rb.getVelocityInLocalPoint(r.worldPosition);

    if (foil.propwash) {
      const wash = aircraft.engine.rpm * foil.propwash;
      const along = V3.dot(Q, aircraft.object3d.worldRotation[1]);
      Q = V3.add(Q, V3.scale(aircraft.object3d.worldRotation[1], clamp(wash - along, 0, wash)));
    }
    Q = V3.sub(Q, weather.currentWindVector);
    Q = V3.sub(Q, weather.thermals.currentVector);
    const foilLla = Object3D.utilities.getPointLla(r, aircraft.llaLocation);
    Q = V3.add(Q, weather.getLocalTurbulence(foilLla));

    foil.velocity = V3.length(Q);
    const vHat = V3.normalize(Q);
    const V2 = foil.velocity * foil.velocity;
    const n = frame[foil.forceDirection];
    const aoa = -V3.dot(n, vHat);
    foil.angleOfAttack = aoa;
    const axis = V3.cross(n, vHat);
    const liftDir = V3.rotate(n, axis, aoa);

    let lift = 0, drag = 0;

    if (foil.span) {
      const AR = foil.aspectRatio || foil.span / foil.chord;
      const S = foil.area || foil.span * foil.chord;
      const e = foil.efficiencyFactor || PLANFORM_EFFICIENCY_FACTOR;
      let CL = aoa * TWO_PI * (AR / (AR + 2));
      const CDi = (CL * CL) / (PI * AR * e);
      if (foil.stalls) {
        aircraft.angleOfAttackDeg = aoa * RAD_TO_DEGREES;
        const absA = Math.abs(aircraft.angleOfAttackDeg);
        if (absA > foil.stallIncidence) {
          aircraft.stalling = true;
          CL *= 1 - clamp(absA - foil.stallIncidence, 0, 0.9 * foil.zeroLiftIncidence)
            / foil.zeroLiftIncidence;
        }
      }
      const q = 0.5 * rho * V2 * S;
      drag = CDi * q;
      lift = CL * q;
    } else if (foil.area) {
      let CL = aoa * TWO_PI;
      if (foil.stalls) {
        aircraft.angleOfAttackDeg = aoa * RAD_TO_DEGREES;
        const absA = Math.abs(aircraft.angleOfAttackDeg);
        if (absA > foil.stallIncidence) {
          aircraft.stalling = true;
          CL *= 1 - clamp(absA - foil.stallIncidence, 0, 0.9 * foil.zeroLiftIncidence)
            / foil.zeroLiftIncidence;
        }
      }
      drag = 0.5 * V2 * (MIN_DRAG_COEF + DRAG_CONSTANT * CL * CL) * rho;
      lift = rho * V2 * 0.5 * foil.area * CL;
    } else {
      let kL = foil.liftFactor, kD = foil.dragFactor;
      if (foil.stalls) {
        aircraft.angleOfAttackDeg = aoa * RAD_TO_DEGREES;
        const absA = Math.abs(aircraft.angleOfAttackDeg);
        if (absA > foil.stallIncidence) {
          aircraft.stalling = true;
          kL *= 0.9 - clamp(absA - foil.stallIncidence, 0, foil.zeroLiftIncidence)
            / foil.zeroLiftIncidence;
        }
      }
      const aV2 = aoa * V2;
      lift = kL * aV2 * rho;
      drag = kD * Math.abs(aV2) * rho;
    }

    foil.lift = lift;
    if (animationValues) animationValues[foil.name + 'Lift'] = lift;
    if (lift) rb.applyForce(V3.scale(liftDir, lift), r.worldPosition);
    if (drag) rb.applyForce(V3.scale(vHat, -drag), r.worldPosition);
  }
}
