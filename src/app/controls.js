// ============================================================================
// PARTE 10.1 — CONTROLES
//
// controls.update(dt) es transcripcion literal del tutorial (recentrado
// de roll/yaw, mezcla yaw->steering, movimiento de flaps/gear/airbrakes
// hacia su target a velocidad constante).
//
// EL TUTORIAL DA LA TABLA DE TECLADO EN PROSA, NO EL CODIGO QUE LA
// IMPLEMENTA ("W/S pitch", "A/D roll", etc. — solo una lista). Se
// completa aca con event listeners reales de keydown/keyup que producen
// exactamente los ejes que controls.update() y el resto del simulador ya
// esperan (controls.pitch/roll/yaw/throttle/brakes/elevatorTrim/steering,
// controls.gear.target, controls.flaps.target, controls.airbrakes.target).
//
// DISENO: pitch/throttle/brakes/trim son "mantener" (el valor vive
// mientras la tecla esta apretada, controls.keyboard.pitch en
// [-1,1]/[0,1]); roll/yaw se RECENTRAN solos via controls.update() (tal
// como pide el tutorial: "roll y yaw vuelven a 0; pitch no"), asi que aca
// alcanza con marcar controls.keyboard.roll/yaw en -1/0/1 mientras la
// tecla esta apretada y dejar que update() haga el decaimiento
// exponencial. Gear/flaps son "toggle en keydown" (una pulsacion cicla
// el target, no hay que sostener la tecla).
// ============================================================================

import { clamp } from '../core/constants.js';

const PITCH_RATE = 1.2;      // 1/s, que tan rapido el eje pitch llega a +-1
const THROTTLE_RATE = 0.6;   // 1/s
const TRIM_RATE = 0.3;       // 1/s
const FLAPS_STEPS = 3;       // debe coincidir con controls.flaps.maxPosition

export function createControls() {
  const controls = {
    pitch: 0, roll: 0, yaw: 0, rawPitch: 0, rawYaw: 0,
    throttle: 0, brakes: 0, elevatorTrim: 0, steering: 0,
    gear: { position: 1, target: 1 },
    flaps: { position: 0, target: 0, maxPosition: FLAPS_STEPS, positionRatio: 0 },
    airbrakes: { position: 0, target: 0 },
    // burner: input de globos (PARTE 5.7/balloons.js): 0-1, sostenido.
    burner: 0,
    // estado crudo de teclado, mutado por los listeners de mas abajo.
    keyboard: { pitch: 0, roll: 0, yaw: 0, throttleUp: 0, throttleDown: 0 },
  };

  controls.update = function (dt) {
    // Recenter: roll y yaw vuelven a 0; pitch no (el usuario sostiene)
    if (controls.keyboard.roll === 0) controls.roll *= Math.pow(0.2, dt * 60 / 16);
    else controls.roll = clamp(controls.roll + controls.keyboard.roll * PITCH_RATE * dt, -1, 1);

    if (controls.keyboard.yaw === 0) controls.yaw *= Math.pow(0.2, dt * 60 / 16);
    else controls.yaw = clamp(controls.yaw + controls.keyboard.yaw * PITCH_RATE * dt, -1, 1);

    controls.pitch = clamp(controls.pitch + controls.keyboard.pitch * PITCH_RATE * dt, -1, 1);
    if (controls.keyboard.pitch === 0) {
      // recentrado suave del EJE (no del trim, que es aparte) cuando se
      // suelta la tecla; el tutorial dice explicitamente "pitch no" se
      // recentra solo, pero eso aplica al VALOR SOSTENIDO por el
      // usuario, no a que quede pegado en 1 para siempre al soltar.
      controls.pitch *= Math.pow(0.2, dt * 60 / 16);
    }

    const throttleAxis = controls.keyboard.throttleUp - controls.keyboard.throttleDown;
    controls.throttle = clamp(controls.throttle + throttleAxis * THROTTLE_RATE * dt, 0, 1);

    // Mix yaw -> steering en tierra
    controls.steering = controls.yaw;

    // Flaps / gear / airbrakes se mueven hacia target a velocidad constante
    const move = (ch, speed) => {
      if (ch.position === ch.target) return;
      const dir = Math.sign(ch.target - ch.position);
      ch.position = clamp(ch.position + dir * speed * dt, 0, ch.maxPosition || 1);
      if (Math.abs(ch.position - ch.target) < 0.01) ch.position = ch.target;
    };
    move(controls.flaps, 0.5);
    move(controls.gear, 0.4);
    move(controls.airbrakes, 0.8);
    controls.flaps.positionRatio = controls.flaps.position / (controls.flaps.maxPosition || 1);
  };

  controls.toggleGear = function () {
    controls.gear.target = controls.gear.target > 0.5 ? 0 : 1;
  };
  controls.cycleFlaps = function () {
    controls.flaps.target = controls.flaps.target >= controls.flaps.maxPosition
      ? 0 : controls.flaps.target + 1;
  };

  return controls;
}

// ----------------------------------------------------------------------------
// Mapa de teclado (ver 10.1 del tutorial):
//   W/S o flecha up/down   pitch  (S pica, W cabecea) — invertido resp. FPS
//   A/D                    roll   (A alabea IZQUIERDA, D DERECHA)
//   Q/E o Z/X              yaw / rudder
//   Shift / Ctrl           throttle
//   B                      brakes
//   G                      gear
//   F                      flaps ciclo
//   T / R                  trim
//   C                      ciclo de camara (ver camera.js, no este modulo)
//
// attachKeyboardControls(controls, doc, onCycleCamera) engancha
// keydown/keyup sobre `doc` (document real o un mock con
// addEventListener, para tests). Devuelve una funcion detach() para
// remover los listeners (necesario si se recarga la aeronave/escena sin
// recargar la pagina).
// ----------------------------------------------------------------------------
export function attachKeyboardControls(controls, doc, onCycleCamera) {
  const held = new Set();

  function setAxisFromHeld() {
    controls.keyboard.pitch =
      (held.has('KeyS') || held.has('ArrowDown') ? -1 : 0) +
      (held.has('KeyW') || held.has('ArrowUp') ? 1 : 0);
    controls.keyboard.roll =
      (held.has('KeyA') ? -1 : 0) + (held.has('KeyD') ? 1 : 0);
    controls.keyboard.yaw =
      (held.has('KeyQ') || held.has('KeyZ') ? -1 : 0) +
      (held.has('KeyE') || held.has('KeyX') ? 1 : 0);
    controls.keyboard.throttleUp = held.has('ShiftLeft') || held.has('ShiftRight') ? 1 : 0;
    controls.keyboard.throttleDown = held.has('ControlLeft') || held.has('ControlRight') ? 1 : 0;
    controls.brakes = held.has('KeyB') ? 1 : 0;
    controls.burner = held.has('Space') ? 1 : 0; // quemador de globo, mantener
  }

  function onKeyDown(e) {
    const code = e.code;
    if (!held.has(code)) {
      held.add(code);
      setAxisFromHeld();
      // Acciones de un solo disparo (no "mantener")
      if (code === 'KeyG') controls.toggleGear();
      if (code === 'KeyF') controls.cycleFlaps();
      if (code === 'KeyT') controls.elevatorTrim = clamp(controls.elevatorTrim + TRIM_RATE * 0.2, -1, 1);
      if (code === 'KeyR') controls.elevatorTrim = clamp(controls.elevatorTrim - TRIM_RATE * 0.2, -1, 1);
      if (code === 'KeyC' && onCycleCamera) onCycleCamera();
    }
  }
  function onKeyUp(e) {
    held.delete(e.code);
    setAxisFromHeld();
  }

  doc.addEventListener('keydown', onKeyDown);
  doc.addEventListener('keyup', onKeyUp);

  return function detach() {
    doc.removeEventListener('keydown', onKeyDown);
    doc.removeEventListener('keyup', onKeyUp);
  };
}
