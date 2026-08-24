// ============================================================================
// PARTE 4.9 — GESTION DE ELEVACION POR FRAME
//
// `withinCollisionRange` es la optimizacion mas importante del simulador.
// En crucero a 10 000 m NO se samplean 8 puntos de contacto ni se calculan
// normales. Solo se hace cuando se esta a (radio de bounding sphere +
// velocidad) del suelo. La velocidad esta en m/s: a 80 m/s y un 737 de
// radio 40 m, se empieza a colisionar a 120 m AGL. Suficiente para no
// atravesar el suelo a 60 fps.
// ============================================================================

import { V3 } from '../core/vectors.js';
import { getCollisionResult, getNormalFromCollision } from './ground-sampling.js';

export function createFlightTerrainManager(api, sim) {
  const flight = {
    currentAltitudeTestContext: {},
    pastAltitudeTestContext: {},
    elevationAtPreviousLocation: 0,
    skipCollisionResponse: false,
    recorder: { playing: false },
  };

  flight.terrainElevationManagement = function (aircraft) {
    const ac = aircraft;
    const lla = [ac.llaLocation[0], ac.llaLocation[1], ac.llaLocation[2]];
    flight.currentAltitudeTestContext.groundContact = ac.groundContact;

    ac.collResult = getCollisionResult(api, sim, lla, null, null, flight.currentAltitudeTestContext);
    const groundZ = ac.collResult.location[2];
    sim.groundElevation = groundZ;
    sim.relativeAltitude = ac.llaLocation[2] - groundZ;

    sim.withinCollisionRange = false;
    if (sim.relativeAltitude < ac.boundingSphereRadius + ac.velocityScalar) {
      sim.withinCollisionRange = true;
      ac.collResult.normal = getNormalFromCollision(
        api, ac.collResult, flight.currentAltitudeTestContext
      );
    } else {
      ac.collResult.normal = [0, 0, 1];
    }

    if (flight.recorder.playing) return;

    if (sim.cautiousWithTerrain) {
      // BUGFIX (encontrado al correr el primer frame real tras spawn,
      // sim.cautiousWithTerrain empieza en true por PARTE 4.10): esta
      // rama lee ac.lastLlaLocation, pero ese campo recien se ESCRIBE al
      // final de esta misma funcion (mas abajo) -- en el primerisimo
      // frame de vida del avion todavia no existe. `|| lla` usa la
      // posicion ACTUAL como fallback solo para ese primer frame (dH=0,
      // sin spike detectado, comportamiento correcto: no hay frame
      // anterior con el que comparar todavia).
      const prevGround = api.getGroundAltitudeWithObjects(
        ac.lastLlaLocation || lla, flight.pastAltitudeTestContext
      ).location[2];
      const dH = prevGround - flight.elevationAtPreviousLocation;
      const SPIKE = 0.2;
      flight.skipCollisionResponse = false;
      if (Math.abs(dH) > SPIKE) {
        if (!ac.absoluteStartAltitude &&
            (sim.cautiousWithTerrain || prevGround > ac.llaLocation[2])) {
          ac.llaLocation[2] += dH; // el avion "surfea" el tile
        }
        if (ac.groundContact) {
          ac.llaLocation[2] = groundZ + ac.definition.startAltitude;
          flight.skipCollisionResponse = true;
        }
        flight.probeTerrain(); // alarga el periodo cautious
      }
    }
    flight.elevationAtPreviousLocation = groundZ;
    ac.lastLlaLocation = ac.llaLocation;
  };

  flight.reset = function (groundZ) {
    flight.currentAltitudeTestContext = { lastGroundAltitude: groundZ };
    flight.pastAltitudeTestContext = { lastGroundAltitude: groundZ };
  };

  return flight;
}

// ----------------------------------------------------------------------------
// PARTE 4.10 — PERIODO "CAUTIOUS" AL CAMBIAR DE TILES
//
// Cuando Cesium carga un tile nuevo, globe.getHeight puede saltar metros.
// Durante `terrainProbingDuration` ms tras un flyTo o un cambio de
// TerrainProvider, se trata el terreno como "inestable":
//   - getCollisionResult usa el plano previo (degraded)
//   - si el suelo salta, se arrastra el avion
//   - skipCollisionResponse si se esta en el suelo (si no, el tren explota)
// ----------------------------------------------------------------------------

export function attachCautiousTerrainProbing(flight, sim, viewport, doc) {
  sim.terrainProbingDuration = 10000; // ms
  doc = doc || (typeof document !== 'undefined' ? document : null);

  flight.probeTerrain = function () {
    if (!sim.cautiousWithTerrain && viewport) {
      viewport.dispatchEvent(new Event('terrainUnstable'));
    }
    sim.cautiousWithTerrain = true;
    clearTimeout(sim.probbingTimeout);
    sim.probbingTimeout = setTimeout(() => {
      sim.cautiousWithTerrain = false;
      if (viewport) viewport.dispatchEvent(new Event('terrainStable'));
    }, sim.terrainProbingDuration);
  };

  if (doc) doc.addEventListener('terrainProviderUpdate', flight.probeTerrain);
  return flight;
}

// ----------------------------------------------------------------------------
// flyTo — teletransporte seguro a un aeropuerto/coordenada.
//
// coords = [lat, lon, alt_rel_o_abs, heading, isAbsolute, speedKnots]
//
// Usa SIEMPRE getGuarantiedGroundAltitude (async, sampleTerrain) para el
// spawn: si usas un sample sincrono antes de que el tile exista, el avion
// aparece 40 m bajo la pista.
// ----------------------------------------------------------------------------

export function makeFlyTo(api, sim, flight, aircraft, MS_TO_KNOTS, doPause, undoPause) {
  return function flyTo(coords) {
    doPause(1);
    flight.probeTerrain();
    if (api.waterDetection) api.waterDetection.reset();
    aircraft.instance.reset(coords[2] === 0);

    return api.getGuarantiedGroundAltitude([coords[0], coords[1], 0]).then((samples) => {
      const groundZ = samples[0].height || 0;
      sim.groundElevation = groundZ;
      flight.reset(groundZ);

      let alt = coords[2];
      const onGround = (alt === 0);
      if (!coords[4]) alt += groundZ; // altitud relativa AGL
      if (onGround) alt = groundZ + aircraft.instance.definition.startAltitude;

      aircraft.instance.llaLocation = [coords[0], coords[1], alt];
      aircraft.instance.place(aircraft.instance.llaLocation, [coords[3], 0, 0]);

      if (!onGround) {
        const tas = (coords[5] || aircraft.instance.definition.minimumSpeed) / MS_TO_KNOTS;
        const impulse = V3.scale(
          aircraft.instance.object3d.getWorldFrame()[1],
          tas * aircraft.instance.definition.mass
        );
        aircraft.instance.rigidBody.applyCentralImpulse(impulse);
      }
      undoPause(1);
    });
  };
}
