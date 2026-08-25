// ============================================================================
// PARTE 5.6 — SUBPASOS DE FISICA (flight.tick)
//
// Por que subpasos: a 32 ms de dt de render, un muelle de tren con
// stiffness 8 recorre mas de medio ciclo y se vuelve inestable. Partir en
// varios subpasos de ~10 ms lo mantiene amortiguado. nSub se clampea a 10
// para que un hitch de 200 ms (un GC largo, un stall de red de tiles) no
// cueste 20 iteraciones de fisica de golpe.
//
// Orden dentro de cada subpaso (ver tambien PARTE 4 para contactos):
//   1. actualizar velocidades derivadas (airVelocity, TAS, groundSpeed)
//   2. aplicar fuerza de cada globo
//   3. aplicar empuje de cada motor
//   4. applyAirfoils: arrastre parasito + lift/drag por perfil (+ stall)
//   5. aplicar gravedad en el CG
//   6. collectContacts + resolveContacts (PARTE 4.7 / 4.8)
//   7. integrateVelocities, integrateTransform (PARTE 5.1)
//   8. updatePartAnimations (PARTE 9: alerones/tren/timon ANTES de compute)
//   9. object3d.compute(lla) -> matrices de mundo de todas las partes
//   10. setAnimationValues, autopilot.update
//
// Fuera del loop de subpasos: updateEngines (RPM, una vez por frame es
// suficiente, el spool es lento comparado con 10 ms), updateBalloons,
// weather.atmosphere.update, y al final setCurrentAcceleration (usa el
// dt del FRAME completo, no del subpaso, para no medir ruido).
// ============================================================================

import { clamp } from '../core/constants.js';
import { V2, V3, M33 } from '../core/vectors.js';
import { updateEngines, applyEngineForces } from './engines.js';
import { updateBalloons, applyBalloonForces } from './balloons.js';
import { applyAirfoils } from './airfoils.js';
import { updatePartAnimations } from './aircraft-tree.js';

// deps: objeto con todas las dependencias inyectadas (nada de globals):
//   api            { renderingSettings: { physicsDeltaMs } }
//   weather        { atmosphere, currentWindVector, thermals, getLocalTurbulence }
//   controls       inputs del usuario (throttle, pitch, roll, yaw, brakes, ...)
//   animation      { values, filter(anim) }
//   Object3D       utilidades del arbol de partes (PARTE 9)
//   sim            estado de vuelo/colision (PARTE 4): cautiousWithTerrain, etc.
//   collectContacts, resolveContacts   de PARTE 4 (contact-detection /
//                                       collision-response)
//   autopilot      { update(subDt) }  (PARTE 10, opcional)
//   flight         objeto contenedor: { skipCollisionResponse, recorder,
//                                       setAnimationValues (ver abajo) }
export function makeFlightTick(aircraft, deps) {
  const { api, weather, controls, animation, Object3D, sim,
    collectContacts, resolveContacts, autopilot, flight } = deps;

  return function tick(dt, dtMs, now) {
    const ac = aircraft.instance;
    const nSub = clamp(Math.floor(dtMs / api.renderingSettings.physicsDeltaMs), 1, 10);
    const subDt = dt / nSub;
    const invDt = 1 / dt;

    updateEngines(ac, dt, controls, animation.values, animation.filter, { weather });
    updateBalloons(ac, dt, controls, weather);
    if (deps.updateWaterState) deps.updateWaterState(ac, dt);
    weather.atmosphere.update(ac.llaLocation[2]);
    ac.stalling = false;

    for (let s = 0; s < nSub; s++) {
      ac.velocity = ac.rigidBody.v_linearVelocity;
      ac.velocityDirection = V3.normalize(ac.velocity);
      ac.velocityScalar = V3.length(ac.velocity);
      ac.groundSpeed = V2.length([ac.velocity[0], ac.velocity[1]]);
      ac.airVelocity = V3.sub(ac.velocity, weather.currentWindVector);
      ac.airVelocityDirection = V3.normalize(ac.airVelocity);
      ac.trueAirSpeed = V3.length(ac.airVelocity);

      applyBalloonForces(ac, V3);
      applyEngineForces(ac, V3);
      applyAirfoils(ac, subDt, weather, Object3D, animation.values);
      ac.rigidBody.applyForce(ac.rigidBody.gravityForce, ac.parts.root.points.centerOfMass.worldPosition);

      const { contacts, maxPenetration } = collectContacts(ac, subDt);
      if (contacts.length && !flight.skipCollisionResponse) {
        // BUGFIX: esta rama reimplementa handleContacts() (PARTE 4.7, en
        // contact-detection.js) en vez de llamarla, y se olvido la linea
        // que pone aircraft.groundContact = true cuando hay contactos --
        // por eso el HUD/instrumentos mostraban groundContact:false
        // permanentemente aun con el avion apoyado en el tren.
        ac.groundContact = true;
        if (maxPenetration > 0.001 && !sim.cautiousWithTerrain) {
          ac.llaLocation[2] += maxPenetration;
        }
        resolveContacts(ac, contacts, subDt);
      }

      if (!flight.recorder.playing) {
        ac.rigidBody.integrateVelocities(subDt);
        ac.rigidBody.integrateTransform(subDt);
        // PARTE 9: las animaciones (alerones/tren/timon) tienen que fijar
        // _localRotation ANTES de compute(), o el lift de applyAirfoils()
        // del PROXIMO subpaso quedaria leyendo la normal del perfil de un
        // frame atras (ver nota en aircraft-tree.js).
        updatePartAnimations(ac, animation);
        ac.object3d.compute(ac.llaLocation);
        ac.htr = ac.object3d.htr;
        flight.setAnimationValues(subDt, now);
        if (autopilot) autopilot.update(subDt);
      }
    }

    ac.rigidBody.setCurrentAcceleration(invDt);
    ac.placeParts();
    ac.render();
  };
}

// ----------------------------------------------------------------------------
// PARTE 5.9 — VALORES DE ANIMACION (lo que leen instrumentos y shaders)
//
// kias = ktas es una simplificacion (mentira util). IAS real:
//   IAS = TAS * sqrt(rho / rho_SL)
// El stall se produce a IAS ~constante, no a TAS constante; si quieres un
// ASI creible a media/alta altitud, sustituye v.kias por tasToIas(...)
// (ver aircraft/atmosphere.js).
// ----------------------------------------------------------------------------
export function makeSetAnimationValues(aircraft, deps) {
  const { animation, controls, weather, sim, exponentialSmoothing,
    METERS_TO_FEET, MS_TO_KNOTS } = deps;

  return function setAnimationValues(dt, now) {
    const ac = aircraft.instance;
    const v = animation.values;
    const altFt = ac.llaLocation[2] * METERS_TO_FEET;
    const vs = ((altFt - (ac.oldAltitude || ac.llaLocation[2]) * METERS_TO_FEET) * 60 / dt) || 0;
    ac.oldAltitude = ac.llaLocation[2];

    v.acceleration = M33.transform(M33.transpose(ac.object3d._rotation), ac.rigidBody.v_acceleration);
    v.accX = v.acceleration[0]; v.accY = v.acceleration[1]; v.accZ = v.acceleration[2];
    v.loadFactor = v.acceleration[2] / deps.GRAVITY;
    v.slipball = exponentialSmoothing('slipball', v.acceleration[0], 0.02);
    v.ktas = ac.trueAirSpeed * MS_TO_KNOTS;
    v.kias = v.ktas; // simplificacion; IAS real usa rho, ver tasToIas()
    v.mach = weather.atmosphere.msToMach(ac.trueAirSpeed);
    v.altitude = altFt;
    v.altitudeMeters = ac.llaLocation[2];
    v.haglMeters = sim.relativeAltitude;
    v.verticalSpeed = vs;
    v.aoa = ac.trueAirSpeed > 1 ? ac.angleOfAttackDeg : 0;
    v.heading = ac.htr[0];
    v.atilt = ac.htr[1];
    v.aroll = ac.htr[2];
    v.rpm = ac.engine.rpm;
    v.throttle = controls.throttle;
    v.pitch = controls.pitch;
    v.roll = controls.roll;
    v.yaw = controls.yaw;
    v.trim = controls.elevatorTrim;
    v.brakes = controls.brakes;
    v.stalling = !ac.groundContact && ac.stalling;
    v.groundContact = ac.groundContact ? 1 : 0;
    v.airTemp = weather.atmosphere.airTempAtAltitude;
    v.windSpeed = weather.currentWindSpeed;
  };
}
