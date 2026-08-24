// ============================================================================
// PARTE 4.6 — PUNTOS DE CONTACTO DE LA AERONAVE
//
// Cada parte del JSON de la aeronave puede declarar `collisionPoints`:
// posiciones locales en el marco de la parte. Al cargar la aeronave se
// "adjuntan" a la lista plana `aircraft.collisionPoints` que usa el
// resolutor de colisiones (4.7/4.8).
//
// Los collisionPoints se transforman a mundo cada subpaso via la jerarquia
// Object3D (parent/hijo aplica rotaciones de tren, flaps, etc. — ver
// PARTE 9).
// ============================================================================

import { V3 } from '../core/vectors.js';
import { WATER_DENSITY, GRAVITY } from '../core/constants.js';

// ----------------------------------------------------------------------------
// contactProperties tipicos, indexados por tipo de contacto.
// ----------------------------------------------------------------------------
export const DEFAULT_CONTACT_PROPERTIES = {
  wheel: {
    frictionCoef: 0.8,
    dynamicFriction: 0.02,
    rollingFriction: 0.02,
    lockSpeed: 0.5,   // m/s: por debajo, la rueda se trata como locked
  },
  airfoil: {
    frictionCoef: 0.4,
    dynamicFriction: 0.3,
    rollingFriction: 0.3,
    lockSpeed: 0.01,
  },
  body: {
    frictionCoef: 0.5,
    dynamicFriction: 0.4,
    rollingFriction: 0.4,
    lockSpeed: 0.01,
  },
};

// ----------------------------------------------------------------------------
// attachCollisionPoints — se llama una vez por parte, al cargar el JSON.
// ----------------------------------------------------------------------------
export function attachCollisionPoints(part, aircraft) {
  if (!part.collisionPoints) return;

  const contactProperties = aircraft.definition.contactProperties || DEFAULT_CONTACT_PROPERTIES;
  const props = contactProperties[part.contactType || part.type];

  for (let i = 0; i < part.collisionPoints.length; i++) {
    const cp = part.collisionPoints[i];
    cp.part = part;
    cp.contactProperties = props;
    aircraft.collisionPoints.push(cp);
  }

  // Volumen por defecto para boyancia si no se especifica
  if (!part.volume && !part.buoyancy) {
    part.volume = part.type === 'airfoil'
      ? aircraft.definition.mass / (400 * part.collisionPoints.length)
      : 0.1;
    part.area = part.area || 0;
  }

  part.dragVector = V3.scale(part.dragVector || [1, 1, 1], 1 / part.collisionPoints.length);
  if (part.volume) part.buoyancy = WATER_DENSITY * GRAVITY * part.volume;
}

// Aplica attachCollisionPoints a todas las partes de una aeronave recien
// cargada, inicializando el array acumulador.
export function initAircraftCollisionPoints(aircraft) {
  aircraft.collisionPoints = [];
  for (const part of aircraft.definition.parts) {
    attachCollisionPoints(part, aircraft);
  }
  return aircraft.collisionPoints;
}

// ----------------------------------------------------------------------------
// Ejemplo: Cessna 172 — cuerpo + tren triciclo (dos ruedas principales +
// rueda de morro con freno diferencial desactivado).
// ----------------------------------------------------------------------------
export const CESSNA_172_EXAMPLE_PARTS = [
  {
    name: 'root',
    type: 'body',
    collisionPoints: [[0, 0, -0.6]],
  },
  {
    name: 'leftWheel',
    type: 'wheel',
    parent: 'root',
    collisionPoints: [[-1.2, 0.3, -1.15]],
    suspension: { restLength: 0.25, stiffness: 8, damping: 0.4, hardPoint: 0.85 },
  },
  {
    name: 'rightWheel',
    type: 'wheel',
    parent: 'root',
    collisionPoints: [[1.2, 0.3, -1.15]],
    suspension: { restLength: 0.25, stiffness: 8, damping: 0.4, hardPoint: 0.85 },
  },
  {
    name: 'noseWheel',
    type: 'wheel',
    parent: 'root',
    collisionPoints: [[0, 1.6, -1.10]],
    suspension: { restLength: 0.20, stiffness: 6, damping: 0.35, hardPoint: 0.85 },
    brakesController: 'brakes',
    brakesControllerRatio: 0.0, // rueda de nariz no frena
  },
];
