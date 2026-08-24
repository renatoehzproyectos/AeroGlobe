// ============================================================================
// APENDICE C — Recetas de depuracion (debugContacts, logSubstep)
//
// Transcripcion casi literal de las dos recetas del apendice, con la
// misma adaptacion de siempre: en vez de `aircraft`/`sim`/`weather`/
// `debug` como variables de modulo compartidas, entran por parametro.
//
// debug.placeProbe(lla, colorHex): dependencia inyectada, NO definida en
// ningun lado del tutorial (solo se la nombra al usarla) -- se asume un
// helper de la capa de render (ej. un punto/esfera Cesium.Entity de
// color en esa lla) con esa firma exacta, mismo trato que api.Model/
// api.Canvas/api.ParticleEmitter en el resto del proyecto: si
// deps.debug no esta disponible, debugContacts degrada a devolver los
// puntos como datos (array) en vez de dibujarlos, para poder usarse
// tambien desde tests/consola sin una capa de render real.
// ============================================================================

import { V3 } from '../core/vectors.js';
import { xyz2lla_fast } from '../core/coordinates.js';

// debugContacts(aircraft, sim, debug) — aircraft es el WRAPPER {instance}
// (mismo patron que main-loop.js/flight-tick.js), sim ya trae
// groundElevation fresco (lo puebla flight.terrainElevationManagement,
// PARTE 4.9). debug es opcional: {placeProbe(lla, colorHex)}.
//
// Verde = punto en aire, rojo = en contacto, azul = suelo bajo el CG.
// Si el azul esta muy por encima del verde, el startAltitude o el
// modelo (posicion de las ruedas/flotadores en el glTF vs.
// collisionPoints declarados en el JSON) estan mal.
export function debugContacts(aircraft, sim, debug) {
  const ac = aircraft.instance;
  const probes = [];

  for (const cp of ac.collisionPoints) {
    const lla = V3.add(ac.llaLocation, xyz2lla_fast(cp.worldPosition, ac.llaLocation));
    const color = cp.part.contact ? '#ff3030' : '#30ff30';
    probes.push({ lla, color, contact: !!cp.part.contact });
    if (debug && debug.placeProbe) debug.placeProbe(lla, color);
  }

  const groundLla = [ac.llaLocation[0], ac.llaLocation[1], sim.groundElevation];
  probes.push({ lla: groundLla, color: '#3080ff', contact: null });
  if (debug && debug.placeProbe) debug.placeProbe(groundLla, '#3080ff');

  return probes;
}

// logSubstep(aircraft, sim, weather) — mismo console.table del apendice,
// devuelto tambien como objeto plano (ademas de logueado) para poder
// usarse en un test que assertee sobre los valores en vez de leer
// stdout. Todos los campos usan `|| 0` / `?.` donde el tutorial asumia
// que ya existian (ej. angleOfAttackDeg, airfoils[0]) para no romper si
// se llama ANTES del primer subpaso completo (ej. el primer frame tras
// spawn, con ac.airfoils ya poblado por buildAircraftTree pero
// ac.airfoils[0].lift todavia sin escribir por updateAirfoils).
export function logSubstep(aircraft, sim, weather) {
  const ac = aircraft.instance;
  const row = {
    tas: (ac.trueAirSpeed || 0).toFixed(1),
    alt: ac.llaLocation[2].toFixed(1),
    agl: (sim.relativeAltitude || 0).toFixed(1),
    aoa: (ac.angleOfAttackDeg || 0).toFixed(1),
    n: (sim.groundElevation || 0).toFixed(1),
    rho: (weather.atmosphere.airDensityAtAltitude || 0).toFixed(3),
    lift: ((ac.airfoils[0] && ac.airfoils[0].lift) || 0).toFixed(0),
    rpm: (ac.engine && ac.engine.rpm) || 0,
    stall: !!ac.stalling,
    contact: !!ac.groundContact,
    cautious: !!sim.cautiousWithTerrain,
    inRange: !!sim.withinCollisionRange,
  };
  if (typeof console !== 'undefined' && console.table) console.table(row);
  return row;
}
