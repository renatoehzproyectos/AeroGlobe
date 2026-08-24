// ============================================================================
// PARTE 5.7 — GLOBOS Y EMPUJE HIDROSTATICO
//
// El envelope se calienta con el input del quemador (controls[controller
// .name] * controller.ratio) y se enfria hacia la temperatura ambiente.
// El empuje sale de la diferencia de densidad entre el aire frio exterior
// y el aire caliente dentro del globo (ley de gases ideales, misma presion,
// volumen fijo): dRho * volume * GRAVITY. Se aplica como fuerza vertical
// pura en el subpaso (flight.tick, PARTE 5.6), no aqui.
// ============================================================================

import { clamp } from '../core/constants.js';
import { KELVIN_OFFSET, GAS_CONSTANT, GRAVITY } from '../core/constants.js';

// aircraft: { balloons[], envelopeTemp }. controls: bag de inputs del
// usuario (ej. controls.burner). weather: { atmosphere.airTempAtAltitude,
// atmosphere.airPressureAtAltitude, atmosphere.airDensityAtAltitude }.
export function updateBalloons(aircraft, dt, controls, weather) {
  for (const b of aircraft.balloons) {
    const input = clamp((controls[b.controller.name] * b.controller.ratio) || 0, 0, 1);
    let T = b.temperature;
    T += input * b.heatingSpeed * dt;
    const dT = T - weather.atmosphere.airTempAtAltitude;
    T -= b.coolingSpeed * dT * dt;
    T = clamp(T, 0, 300);
    b.temperature = T;
    const Tk = T + KELVIN_OFFSET;
    const rhoHot = weather.atmosphere.airPressureAtAltitude / (GAS_CONSTANT * Tk);
    const dRho = weather.atmosphere.airDensityAtAltitude - rhoHot;
    b.liftingForce = dRho * b.volume * GRAVITY;
    aircraft.envelopeTemp = T;
  }
}

// Aplica la fuerza de empuje ya calculada (llamar dentro del subpaso,
// una vez por balloon, igual que los motores). Fuerza vertical pura en
// el punto forceSourcePoint del envelope.
export function applyBalloonForces(aircraft, V3) {
  for (const b of aircraft.balloons) {
    aircraft.rigidBody.applyForce([0, 0, b.liftingForce], b.points.forceSourcePoint.worldPosition);
  }
}
