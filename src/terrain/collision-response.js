// ============================================================================
// PARTE 4.8 — RESPUESTA DE COLISION: JACOBIANO, IMPULSO, FRICCION
//
// El cuerpo rigido (PARTE 5.1) expone:
//   computeJacobian(restitution, relVelNormal, r, n)
//     j = -(1+e) * v_rel_n  /  (1/m + n · (I^-1 (r × n)) × r)
//   applyImpulse(J, r)   -> cambia v y omega
//   applyForce(F, r)     -> acumula para integrar al final del subpaso
//
// Intuicion del Jacobiano: el denominador 1/m + n·(I^-1 (r×n) × r) es la
// "inercia efectiva" del punto de contacto. Un impulso en el extremo del
// ala (r grande, I pequena en ese eje) mueve mas la actitud que el mismo
// impulso en el CG.
//
// restitution e=0 => el contacto mata la velocidad normal, no rebota. El
// tren (muelle+damper) es el que da la "suavidad". Si pones e=0.3 en el
// fuselaje, el avion baila como una pelota.
// ============================================================================

import { V3 } from '../core/vectors.js';
import { clamp, WATER_DENSITY, TWO_PI } from '../core/constants.js';

// rb: rigid body instance (PARTE 5.1) con getVelocityInLocalPoint,
//     applyForce, applyImpulse, computeJacobian, mass.
// sim: estado global (waveVerticalSpeed, preferences.crashDetection)
export function resolveContacts(rb, sim, aircraft, contacts, dt) {
  let maxImpact = 0;

  for (const c of contacts) {
    const cp = c.collisionPoint;
    const part = cp.part;
    const props = cp.contactProperties;
    let v = rb.getVelocityInLocalPoint(cp.worldPosition);
    v = V3.add(v, [0, 0, sim.waveVerticalSpeed || 0]);
    const vN = V3.dot(c.normal, v);
    maxImpact = Math.max(maxImpact, Math.abs(vN));
    let applied = 0;

    if (c.type === 'buoyancy') {
      // Amortiguacion lineal del flotador + fuerza hidrostatica
      const damp = clamp(0.1 * c.force * vN, 0, c.force);
      const F = c.force - damp;
      rb.applyForce(V3.scale(c.normal, F), cp.worldPosition);

      const vHat = V3.normalize(v);
      const q = 0.5 * V3.length(v) * V3.length(v); // presion dinamica
      if (part.type === 'float') {
        const foilN = part.object3d.getWorldFrame()[part.forceDirection];
        const aoa = -V3.dot(foilN, vHat) * TWO_PI;
        const lift = WATER_DENSITY * q * part.area * aoa * 0.01;
        rb.applyForce(V3.scale(foilN, lift), cp.worldPosition);
      }
      const dragMag = q * WATER_DENSITY * c.submersionRatio;
      aircraft.object3d.setVectorWorldPosition(part.dragVector);
      const dragDir = V3.mult(vHat, V3.abs(part.dragVector.worldPosition));
      rb.applyForce(V3.scale(dragDir, -dragMag), cp.worldPosition);
      aircraft.waterContact = true;
    }

    if (c.type === 'raycast' || c.type === 'hardpoint') {
      // Spring-damper impulse: J = (k x - c v_n) * m * dt
      // Only the soft suspension path. hardpoint used to ALSO fire the
      // inelastic impulse below, which double-counted energy and produced
      // the classic "rebote eterno / explosion to orbit" failure mode.
      // hardpoint still participates in friction; the hard constraint is
      // the position correction in handleContacts / flight-tick, not a
      // second velocity impulse on top of the spring.
      const raw = (c.force - part.suspension.damping * vN) * rb.mass * dt;
      // Bound impulse so a single deep-penetration substep cannot launch
      // the aircraft (~4 g·s soft scale, absolute Δv cap of a few m/s).
      const maxJ = Math.max(rb.mass * 40 * dt, rb.mass * 2);
      applied = clamp(raw, -maxJ, maxJ);
      if (applied !== 0 && isFinite(applied)) {
        rb.applyImpulse(V3.scale(c.normal, applied), cp.worldPosition);
      }
    }

    if (c.type === 'standard' && vN < 0) {
      // Restitution 0: inelastic contact for fuselage / wingtips / prop.
      // Wheels (raycast/hardpoint) must NOT take this path — the suspension
      // already dissipates the normal relative velocity.
      const j = rb.computeJacobian(0, vN, cp.worldPosition, c.normal);
      const maxJ = Math.max(rb.mass * 40 * dt, rb.mass * 5);
      const jClamped = clamp(j, -maxJ, maxJ);
      if (isFinite(jClamped) && jClamped !== 0) {
        rb.applyImpulse(V3.scale(c.normal, jClamped), cp.worldPosition);
      }
      applied = jClamped;
    }

    // Friccion de Coulomb: |Jt| <= mu * |Jn|
    let frictionBudget = Math.abs(applied) * props.frictionCoef;
    frictionBudget = clamp(
      frictionBudget,
      0,
      2 * rb.mass * dt * props.frictionCoef
    );

    if (c.type === 'buoyancy') {
      // ya aplicamos drag viscoso
    } else if (part.type === 'wheel') {
      resolveWheelFriction(rb, sim, aircraft, c, v, frictionBudget, part, props, dt);
    } else {
      // Friccion generica en el plano
      const vT = V3.sub(v, V3.scale(c.normal, vN));
      const vTlen = V3.length(vT);
      if (vTlen) {
        const tHat = V3.normalize(vT);
        const jt = rb.computeJacobian(0, vTlen, cp.worldPosition, tHat);
        let scale = 1;
        if (Math.abs(jt) > frictionBudget) {
          scale = clamp(frictionBudget / (jt * jt), props.dynamicFriction, 1);
        }
        rb.applyImpulse(V3.scale(tHat, scale * jt), cp.worldPosition);
      }
    }
  }

  // Crash detection
  if (sim.preferences && sim.preferences.crashDetection && maxImpact > 10 && !aircraft.crashed) {
    aircraft.crash();
  }

  return maxImpact;
}

// animation: { values: {} } — para leer el estado de frenos
// controls: { brakes: 0..1 } — freno general (pedales)
export function resolveWheelFriction(rb, sim, aircraft, c, v, budget, part, props, dt, animation, controls) {
  animation = animation || aircraft.animation || { values: {} };
  controls = controls || aircraft.controls || { brakes: 0 };

  const fwd = c.contactFwdDir;
  const side = c.contactSideDir;
  const vSide = V3.dot(side, v);
  const vFwd = V3.dot(fwd, v);
  c.forwardProjVel = vFwd;
  c.sideProjVel = vSide;

  const jSide = rb.computeJacobian(0, vSide, c.collisionPoint.worldPosition, side);
  const jFwd = rb.computeJacobian(0, vFwd, c.collisionPoint.worldPosition, fwd);

  let sideScale = 1;
  let fwdScale = 1;

  // Rolling vs locked
  // BUGFIX: por debajo de lockSpeed (0.4 m/s en trainer-172.json -- osea
  // practicamente siempre que el avion esta detenido en pista) fwdScale
  // se quedaba en su default de 1: un impulso de friccion a MAXIMA
  // fuerza, sin acotar por frictionBudget (a diferencia de sideScale un
  // poco mas abajo, y del caso con freno). Eso cancela el 100% de la
  // velocidad hacia adelante en CADA subpaso de fisica, sin importar
  // cuanto empuje haga el motor -- la friccion estatica nunca se podia
  // "romper", asi que el avion quedaba pegado al piso a throttle maximo
  // (para siempre, hasta que alguien lo empuje por encima de lockSpeed a
  // mano). Se acota igual que el resto de los casos: el impulso estatico
  // no puede superar frictionBudget, asi que el empuje del motor SI
  // puede vencerlo y arrancar a rodar.
  if (Math.abs(vFwd) > props.lockSpeed) {
    fwdScale = props.rollingFriction; // rueda girando: poca friccion long.
  } else {
    fwdScale = clamp(budget / (Math.abs(jFwd) * props.frictionCoef || 1), 0, 1);
    c.forwardProjVel = 0;
    c.sideProjVel = 0;
  }

  // Frenos de rueda (controlador de la parte) + frenos generales
  const brakeCtrl = part.brakesController;
  if (brakeCtrl && Math.abs(jFwd) > 0) {
    const b = clamp((animation.values[brakeCtrl] || 0) * part.brakesControllerRatio, 0, 1);
    fwdScale = clamp(budget / (Math.abs(jFwd) * props.frictionCoef), 0, 1) * b;
  }
  const brakeDamp = aircraft.definition.brakeDamping || 3;
  if (controls.brakes > 0.05) {
    fwdScale = clamp(
      (budget / (Math.abs(jFwd) * props.frictionCoef * brakeDamp)) * controls.brakes,
      0, 1
    );
  }

  if (Math.abs(jSide) > budget) {
    sideScale = clamp(budget / (jSide * jSide), props.dynamicFriction, 1);
  }

  rb.applyImpulse(V3.scale(side, jSide * sideScale), c.collisionPoint.worldPosition);
  rb.applyImpulse(V3.scale(fwd, jFwd * fwdScale), c.collisionPoint.worldPosition);
}
