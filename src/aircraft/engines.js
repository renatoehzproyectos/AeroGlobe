// ============================================================================
// PARTE 5.3 — MOTORES Y EMPUJE
//
// RPM sigue al throttle con inercia (spool). Un turbojet tiene inercia alta
// (engineInertia bajo => tarda mas en llegar al target); un piston, baja.
// El empuje se calcula aqui (updateEngines, una vez por frame) pero se
// APLICA en el subpaso de fisica (applyEngineForces / flight.tick,
// PARTE 5.6), porque la direccion del motor depende de la orientacion
// actual del avion en cada subpaso.
//
// aircraft: { definition, engines[], engine: {on, rpm, startup},
//   totalThrust, llaLocation }. controls: { throttle }.
// anim: animation.values (altitude en pies, actualizado por
//   flight.setAnimationValues del frame anterior).
// preferences/weather: opcionales, solo para contrails.
// ============================================================================

import { clamp } from '../core/constants.js';

export function updateEngines(aircraft, dt, controls, anim, animationFilter, opts) {
  opts = opts || {};
  const preferences = opts.preferences;
  const weather = opts.weather;

  let altThrustFactor = 1;
  let altRpmFactor = 1;
  if (aircraft.definition.zeroThrustAltitude) {
    const z = aircraft.definition.zeroThrustAltitude;
    altThrustFactor = clamp(z - anim.altitude, 0, z) / z;
  } else if (aircraft.definition.zeroRPMAltitude) {
    const z = aircraft.definition.zeroRPMAltitude;
    altRpmFactor = clamp(z - anim.altitude, 0, z) / z;
  }

  aircraft.totalThrust = 0;
  let lastAbsRpm = 0;

  for (const eng of aircraft.engines) {
    let throttle = controls.throttle;
    let pitchFactor = 1;
    if (eng.animations) {
      for (const a of eng.animations) {
        if (a.type === 'throttle') throttle = animationFilter(a);
        if (a.type === 'pitch') pitchFactor = animationFilter(a);
      }
    }

    // BUGFIX: aircraft.engine.on arranca en false (aircraft.js) y nada lo
    // ponia nunca en true -- no hay tecla/boton de "arrancar motor" en
    // controls.js/touch-controls.js, asi que el motor se quedaba apagado
    // para siempre y el throttle (teclado o joystick tactil) no producia
    // ningun empuje. Se enciende solo al primer input de throttle > 0 y se
    // apaga si el throttle vuelve a 0 con brakes puestos (freno de
    // estacionamiento = "apagar motor"), para no necesitar un control de
    // ignicion aparte que el tutorial nunca definio.
    if (controls.throttle > 0.001) aircraft.engine.on = true;
    else if (controls.brakes > 0.5) aircraft.engine.on = false;

    if (aircraft.engine.on) {
      let targetRpm = (aircraft.definition.maxRPM - aircraft.definition.minRPM) * throttle
        + aircraft.definition.minRPM;
      targetRpm *= altRpmFactor;
      eng.rpm += (targetRpm - eng.rpm) * aircraft.definition.engineInertia * dt;

      // Reverse: cruza por cero con un "click" en minRPM, no se queda
      // arrastrando en el rango muerto (-minRPM, minRPM).
      if (aircraft.definition.reverse) {
        if (eng.rpm < aircraft.definition.minRPM && eng.rpm > 0 && !aircraft.engine.startup)
          eng.rpm = -aircraft.definition.minRPM;
        if (eng.rpm > -aircraft.definition.minRPM && eng.rpm < 0 && !aircraft.engine.startup)
          eng.rpm = aircraft.definition.minRPM;
      }

      if (eng.contrailEmitter && preferences && weather) {
        if (preferences.graphics.contrails &&
          aircraft.llaLocation[2] > weather.contrailAltitude) eng.contrailEmitter.turnOn();
        else eng.contrailEmitter.turnOff();
      }
    } else {
      if (Math.abs(eng.rpm) < 1e-5) eng.rpm = 0;
      else eng.rpm -= eng.rpm * aircraft.definition.engineInertia * dt;
    }

    const absRpm = Math.abs(eng.rpm);
    lastAbsRpm = absRpm;
    let thrustTable = eng.thrust;
    if (eng.afterBurnerThrust && throttle > 0.9) thrustTable = eng.afterBurnerThrust;
    if (eng.rpm < 0) thrustTable = eng.reverseThrust ? -eng.reverseThrust : 0;

    let thrust = thrustTable
      * clamp(absRpm - aircraft.definition.minRPM, 0, aircraft.definition.maxRPM)
      * aircraft.engine.invRPMRange;
    thrust *= altThrustFactor * pitchFactor;
    eng.currentThrust = thrust;
    aircraft.totalThrust += thrust;
  }
  if (aircraft.engines.length > 0) aircraft.engine.rpm = parseInt(lastAbsRpm, 10);
}

// Se llama dentro del subpaso (flight.tick, PARTE 5.6). El motor por
// encima del CG produce un momento de pitch-down con potencia (P-factor
// simplificado): coloca points.forceSourcePoint con cuidado en el JSON.
export function applyEngineForces(aircraft, V3) {
  for (const eng of aircraft.engines) {
    const dir = eng.object3d.getWorldFrame()[eng.forceDirection];
    aircraft.rigidBody.applyForce(
      V3.scale(dir, eng.currentThrust),
      eng.points.forceSourcePoint.worldPosition
    );
  }
}
