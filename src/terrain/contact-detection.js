// ============================================================================
// PARTE 4.7 — DETECCION DE CONTACTOS (dentro de flight.tick)
//
// Recorre aircraft.collisionPoints cada subpaso y clasifica cada punto en:
//   - buoyancy  (flota en agua)
//   - raycast / hardpoint (suspension de tren de aterrizaje)
//   - standard  (fuselaje, wingtips, helice — contacto rigido directo)
//
// Requiere que, ANTES de llamar collectContacts, cada collisionPoint tenga
// `cp.worldPosition` actualizado por la jerarquia Object3D (PARTE 9) y que
// `aircraft.collResult` venga de terrainElevationManagement (4.9/4.10).
// ============================================================================

import { V3 } from '../core/vectors.js';
import { clamp } from '../core/constants.js';
import { xyz2lla_fast } from '../core/coordinates.js';
import { getCollisionResult } from './ground-sampling.js';

export const MIN_PENETRATION_THRESHOLD = 0.001; // m

// api: contexto con getGroundAltitudeWithObjects etc (ver ground-sampling.js)
// sim: estado global de simulacion (withinCollisionRange, waterDepth, waveHeight,
//      cautiousWithTerrain, isApp, preferences.crashDetection, ...)
// animation: { values: {} } — valores leidos por instrumentos/animaciones
export function collectContacts(api, sim, animation, aircraft, dt) {
  aircraft.groundContact = false;
  aircraft.waterContact = false;
  const contacts = [];
  let maxPenetration = 0;

  if (!sim.withinCollisionRange) {
    // Restaura suspensiones a reposo y sal
    for (const sus of aircraft.suspensions || []) {
      if (sus.suspension && !sus.suspension.rest) {
        animation.values[sus.name + 'Suspension'] = 0;
        sus.points.suspensionOrigin[2] = 0;
        sus.suspension.rest = true;
      }
    }
    return { contacts, maxPenetration };
  }

  for (let i = 0; i < aircraft.collisionPoints.length; i++) {
    const cp = aircraft.collisionPoints[i];
    cp.id = i;
    const part = cp.part;
    part.contact = null;

    const pointLla = V3.add(
      aircraft.llaLocation,
      xyz2lla_fast(cp.worldPosition, aircraft.llaLocation)
    );
    const coll = getCollisionResult(api, sim, pointLla, cp.worldPosition, aircraft.collResult, cp);
    let groundZ = coll.location[2];
    const partFrame = part.object3d.getWorldFrame();
    const n = aircraft.collResult.normal;

    // --- AGUA / BOYANCIA ---
    if (sim.waterDepth > 0 && part.buoyancy && !coll.object) {
      const depth = Math.min(groundZ + sim.waveHeight - pointLla[2], 10);
      if (depth > 0 && !cp.wrongAltitude) {
        const sub = Math.min(depth, 1);
        const contact = {
          collisionPoint: cp,
          normal: [0, 0, 1],
          depth,
          submersionRatio: sub,
          force: sub * part.buoyancy,
          type: 'buoyancy',
        };
        part.contact = contact;
        contacts.push(contact);
      }
      groundZ -= sim.waterDepth; // el "suelo solido" esta bajo el agua
    }

    // --- SUSPENSION (raycast desde el anclaje) ---
    else if (part.suspension) {
      const origin = part.points.suspensionOrigin;
      const originAlt = origin.worldPosition[2] + aircraft.llaLocation[2];
      const compression = part.suspension.restLength - (originAlt - groundZ);
      const ratio = clamp(compression / part.suspension.restLength, 0, 1);
      const travel = ratio * part.suspension.restLength;

      if (ratio > 0 && origin.worldPosition[2] >= cp.worldPosition[2] && !cp.wrongAltitude) {
        const upDot = V3.dot(n, partFrame[2]);
        const contact = {
          collisionPoint: cp,
          normal: n,
          force: part.suspension.stiffness * travel,
          type: 'raycast',
          contactFwdDir: V3.cross(n, V3.normalize(partFrame[0])),
          contactSideDir: V3.cross(n, V3.normalize(partFrame[1])),
        };
        if (ratio >= part.suspension.hardPoint || upDot < 0.4) {
          contact.type = 'hardpoint';
          contact.penetration = groundZ - (cp.worldPosition[2] + aircraft.llaLocation[2]);
          maxPenetration = Math.max(maxPenetration, contact.penetration);
        }
        part.contact = contact;
        contacts.push(contact);
        origin[2] = -compression; // anima el piston
        animation.values[part.name + 'Suspension'] = compression;
        part.suspension.rest = false;
      } else if (!part.suspension.rest) {
        animation.values[part.name + 'Suspension'] = 0;
        part.points.suspensionOrigin[2] = 0;
        part.suspension.rest = true;
      }
      aircraft.placeParts({ [part.name]: part }); // recompute del nodo
    }

    // --- CONTACTO RIGIDO ESTANDAR (fuselaje, wingtips, helice) ---
    else {
      const pen = groundZ - pointLla[2];
      if (pen >= 0 && !cp.wrongAltitude) {
        maxPenetration = Math.max(maxPenetration, pen);
        const contact = {
          collisionPoint: cp,
          normal: n,
          penetration: pen,
          type: 'standard',
          contactFwdDir: V3.cross(n, V3.normalize(partFrame[0])),
          contactSideDir: V3.cross(n, V3.normalize(partFrame[1])),
        };
        part.contact = contact;
        contacts.push(contact);
      }
    }
  }
  return { contacts, maxPenetration };
}

// ----------------------------------------------------------------------------
// Punto de entrada llamado desde flight.tick tras collectContacts.
//
// Si hay penetracion mayor que 1 mm y NO estamos en modo cautious, se
// corrige la altitud del avion ANTES de aplicar impulsos. Esto evita que
// el solver tenga que "empujar" 50 cm de penetracion en un dt de 10 ms
// (que es lo que provoca el famoso rebote explosivo).
// ----------------------------------------------------------------------------
export function handleContacts(api, sim, animation, flight, aircraft, dt, resolveContactsFn) {
  const { contacts, maxPenetration: initialPen } = collectContacts(api, sim, animation, aircraft, dt);
  let maxPenetration = initialPen;

  if (contacts.length) {
    aircraft.groundContact = true;
    if (!flight.skipCollisionResponse) {
      if (maxPenetration > MIN_PENETRATION_THRESHOLD && !sim.cautiousWithTerrain) {
        aircraft.llaLocation[2] += maxPenetration;
        maxPenetration = 0;
      }
      resolveContactsFn(aircraft, contacts, dt);
    }
  }
  return contacts;
}
