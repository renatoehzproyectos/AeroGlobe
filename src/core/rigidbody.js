// ============================================================================
// PARTE 5.1 — CUERPO RIGIDO
//
// Newtoniano simple: fuerzas y torques se acumulan durante el subpaso,
// se integran una vez, y se limpian. No hay solver global de restricciones;
// las restricciones (contactos) se resuelven como impulsos puntuales en
// PARTE 4 (collision-response.js), que llama a applyImpulse/applyForce/
// computeJacobian de este mismo objeto.
//
// AVISO DE SIGNO (leer antes de tocar nada):
//   applyForce usa V3.cross(F, r) = F × r = -(r × F) como torque, y
//   getVelocityInLocalPoint usa V3.cross(r, omega) = r × omega = -(omega × r)
//   como velocidad del punto. Los dos son el mismo "flip" respecto a la
//   convencion clasica (tau = r × F, v_p = v_cg + omega × r). Se cancelan
//   entre si. Si corriges solo uno de los dos, el avion entra en PIO
//   (el lift genera momento invertido). Cambia los dos o ninguno.
//
// aircraft: referencia inyectada a { instance } donde instance.object3d
//   tiene _rotation (M33 mundo) y _initialRotation; se usa para pasar
//   omega de world-space a local-space y viceversa, y para escribir
//   llaLocation tras integrar. Ver integrateTransform.
// ============================================================================

import { EPSILON, GRAVITY } from './constants.js';
import { V3, M33 } from './vectors.js';
import { xyz2lla_fast } from './coordinates.js';

export function RigidBody(aircraft) {
  this.aircraft = aircraft;
  this.mass = 0;
  this.s_inverseMass = 0;
  this.minLinearVelocity = 0.1;
  this.minAngularVelocity = 0.01;
  this.impulseQueue = [];
  this.reset();
}

RigidBody.prototype.reset = function () {
  this.v_linearVelocity      = [0, 0, EPSILON];
  this.v_angularVelocity     = [0, 0, EPSILON];
  this.v_totalForce          = [0, 0, EPSILON];
  this.v_totalTorque         = [0, 0, EPSILON];
  this.v_prevLinearVelocity  = [0, 0, EPSILON];
  this.v_prevAngularVelocity = [0, 0, EPSILON];
  this.v_prevAcceleration    = [0, 0, EPSILON];
  this.v_acceleration        = [0, 0, EPSILON];
  this.v_jerk                = [0, 0, EPSILON];
  this.v_angularAcceleration = [0, 0, EPSILON];
};

// inertiaScale: numero o [x,y,z]. Mas pequeno = mas inercia en ese eje
// (gira menos). Valores tipicos JSON: inertia: [0.15, 0.08, 0.12]
// (Iyy pequeno => resiste pitch => avion "estable").
RigidBody.prototype.setMassProps = function (mass, inertiaScale) {
  inertiaScale = inertiaScale || 0.1;
  if (!Array.isArray(inertiaScale)) inertiaScale = [inertiaScale, inertiaScale, inertiaScale];
  this.mass = mass;
  this.s_inverseMass = 1 / mass;
  // I_local^-1 ~ (s / m) en cada eje.
  this.v_localInvInertia = [inertiaScale[0] / mass, inertiaScale[1] / mass, inertiaScale[2] / mass];
  this.updateInertiaTensor();
  this.gravityForce = [0, 0, -GRAVITY * mass];
};

// Aproximacion barata: I_world^-1 = R * diag(i), NO es R I^-1 R^T completo.
// Estable para aviones que no giran a >~1000 deg/s (todo lo demas que
// vuela una GA / airliner / balloon en este simulador).
RigidBody.prototype.updateInertiaTensor = function () {
  const R = this.aircraft.instance.object3d._rotation;
  const i = M33.multiplyV(R, this.v_localInvInertia);
  this.m_worldInvInertiaTensor = M33.scaled(M33.identity(), i);
};

// v_p = v_cg + omega × r. Implementado como r × omega (= -(omega × r)),
// ver AVISO DE SIGNO arriba: se cancela con el flip de applyForce.
RigidBody.prototype.getVelocityInLocalPoint = function (r) {
  return V3.add(this.v_linearVelocity, V3.cross(r, this.v_angularVelocity));
};

RigidBody.prototype.applyCentralForce = function (F) {
  this.v_totalForce = V3.add(this.v_totalForce, F);
};

RigidBody.prototype.applyTorque = function (T) {
  this.v_totalTorque = V3.add(this.v_totalTorque, T);
};

// tau acumulado como F × r (= -(r × F)); ver AVISO DE SIGNO arriba.
RigidBody.prototype.applyForce = function (F, r) {
  this.applyCentralForce(F);
  this.applyTorque(V3.cross(F, r));
};

RigidBody.prototype.applyCentralImpulse = function (J) {
  this.v_linearVelocity = V3.add(this.v_linearVelocity, V3.scale(J, this.s_inverseMass));
};

RigidBody.prototype.applyTorqueImpulse = function (angJ) {
  this.v_angularVelocity = V3.add(
    this.v_angularVelocity,
    M33.multiplyV(this.m_worldInvInertiaTensor, angJ)
  );
};

RigidBody.prototype.applyImpulse = function (J, r) {
  // BUGFIX: con 3 ruedas resolviendo friccion/impulsos en secuencia
  // (Gauss-Seidel, sin solver global), una combinacion inestable de
  // stiffness/timestep puede producir un impulso puntual no-finito
  // (NaN/Infinity) en un subpaso. Sin este guard, ese UNICO impulso malo
  // se escribe en v_linearVelocity/v_angularVelocity y los envenena para
  // SIEMPRE (NaN se propaga en cualquier operacion futura) -- el avion
  // queda "congelado" (integrateTransform tambien deja de mover la
  // posicion porque `NaN > minLinearVelocity` es siempre false). Se
  // ignora el impulso no-finito (se pierde ese subpaso, no toda la
  // simulacion) y se avisa por consola para poder rastrear la causa.
  if (!isFinite(J[0]) || !isFinite(J[1]) || !isFinite(J[2])) {
    console.warn('[rigidbody] impulso no finito ignorado', J, 'en', r);
    return;
  }
  this.applyCentralImpulse(J);
  this.applyTorqueImpulse(V3.cross(J, r));
};

// Safety net against contact-response energy pumps. GA aircraft never
// legitimately reach these speeds in this sim; clamping here stops a
// single bad substep from sending the plane to orbit / Infinity.
const MAX_LINEAR_SPEED = 400;   // m/s  (~Mach 1.2)
const MAX_ANGULAR_SPEED = 20;   // rad/s (~1150 deg/s)

RigidBody.prototype.clampVelocities = function () {
  const v = this.v_linearVelocity;
  const vLen = V3.length(v);
  if (vLen > MAX_LINEAR_SPEED) {
    this.v_linearVelocity = V3.scale(v, MAX_LINEAR_SPEED / vLen);
  }
  const w = this.v_angularVelocity;
  const wLen = V3.length(w);
  if (wLen > MAX_ANGULAR_SPEED) {
    this.v_angularVelocity = V3.scale(w, MAX_ANGULAR_SPEED / wLen);
  }
  // Kill non-finite states that somehow slipped past applyImpulse.
  for (let i = 0; i < 3; i++) {
    if (!isFinite(this.v_linearVelocity[i])) this.v_linearVelocity[i] = 0;
    if (!isFinite(this.v_angularVelocity[i])) this.v_angularVelocity[i] = 0;
  }
};

// j = -(1+e) v_n / (1/m + n . ((I^-1 (r × n)) × r))
// Usado por collision-response.js (PARTE 4.8) para friccion e impulsos
// normales; con relVelN = velocidad relativa a lo largo de n, r = punto
// de contacto relativo al CG, n = normal (o tangente, para friccion).
RigidBody.prototype.computeJacobian = function (e, relVelN, r, n) {
  const num = -(1 + e) * relVelN;
  const rXn = V3.cross(r, n);
  const Iinv_rXn = M33.multiplyV(this.m_worldInvInertiaTensor, rXn);
  const denom = this.s_inverseMass + V3.dot(n, V3.cross(r, Iinv_rXn));
  return num / denom;
};

RigidBody.prototype.integrateVelocities = function (dt) {
  const newLinear = V3.add(
    this.v_linearVelocity,
    V3.scale(this.v_totalForce, this.s_inverseMass * dt)
  );
  const newAngular = V3.add(
    this.v_angularVelocity,
    M33.multiplyV(this.m_worldInvInertiaTensor, V3.scale(this.v_totalTorque, dt))
  );
  // Mismo guard que applyImpulse: si v_totalForce/Torque ya viene
  // envenenado (p.ej. por un impulso no-finito que se colo antes de que
  // se agregara el guard de arriba, o por una fuerza NaN de otra parte),
  // no lo integramos -- se descarta el subpaso en vez de dejar el avion
  // en NaN para siempre.
  if (isFinite(newLinear[0]) && isFinite(newLinear[1]) && isFinite(newLinear[2])) {
    this.v_linearVelocity = newLinear;
  } else {
    console.warn('[rigidbody] velocidad lineal no finita ignorada', newLinear);
  }
  if (isFinite(newAngular[0]) && isFinite(newAngular[1]) && isFinite(newAngular[2])) {
    this.v_angularVelocity = newAngular;
  } else {
    console.warn('[rigidbody] velocidad angular no finita ignorada', newAngular);
  }
  this.clampVelocities();
};

// Escribe llaLocation y rotacion de aircraft.instance. Por debajo del
// umbral minimo de velocidad, no integra (evita drift numerico con el
// avion "quieto" en tierra) pero SI limpia fuerzas.
RigidBody.prototype.integrateTransform = function (dt) {
  const vLen = V3.length(this.v_linearVelocity);
  const wLen = V3.length(this.v_angularVelocity);
  if (vLen > this.minLinearVelocity || wLen > this.minAngularVelocity) {
    const ac = this.aircraft.instance;
    const dLla = xyz2lla_fast(V3.scale(this.v_linearVelocity, dt), ac.llaLocation);
    ac.llaLocation = V3.add(ac.llaLocation, dLla);
    let dRot = V3.scale(this.v_angularVelocity, dt);
    dRot = M33.transformByTranspose(ac.object3d._initialRotation, dRot);
    ac.object3d.rotateInitialRotation(dRot);
  }
  this.clearForces();
};

RigidBody.prototype.clearForces = function () {
  this.v_totalForce = [0, 0, 0];
  this.v_totalTorque = [0, 0, 0];
};

// Aceleracion "sentida" (sin g, para load factor) + jerk + aceleracion
// angular, todo por diferencias finitas de velocidad. Se llama UNA vez
// por frame (no por subpaso) con invDt = 1/dt del frame completo.
RigidBody.prototype.setCurrentAcceleration = function (invDt) {
  this.v_acceleration = V3.scale(
    V3.sub(this.v_linearVelocity, this.v_prevLinearVelocity), invDt
  );
  this.v_acceleration = V3.add([0, 0, GRAVITY], this.v_acceleration);
  this.v_jerk = V3.scale(V3.sub(this.v_acceleration, this.v_prevAcceleration), invDt);
  this.v_angularAcceleration = V3.scale(
    V3.sub(this.v_angularVelocity, this.v_prevAngularVelocity), invDt
  );
  this.v_prevLinearVelocity  = V3.dup(this.v_linearVelocity);
  this.v_prevAcceleration    = V3.dup(this.v_acceleration);
  this.v_prevAngularVelocity = V3.dup(this.v_angularVelocity);
};

// Cada ~10 s de vuelo, llamar a aircraft.object3d.resetRotationMatrix()
// (fuera de este modulo) para re-ortonormalizar y evitar drift de la
// rotacion acumulada por integracion de Euler.
