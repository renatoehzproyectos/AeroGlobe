// ============================================================================
// APENDICE B — PID de autopiloto (bonus, no necesario para volar)
//
// PID (constructor + reset/set/compute) es transcripcion literal del
// apendice. "derivative on measurement" (dInput sobre `input`, no sobre
// el error) evita el "derivative kick" cuando cambia el setPoint de
// golpe -- es el motivo del comentario que ya trae el propio codigo del
// tutorial, se conserva.
//
// createAutopilot() esta COMPLETADO: el tutorial solo describe en una
// frase de prosa (no en codigo) la cadena de 3 PID (altitud ->
// elevatorTrim; heading -> roll target; roll -> aileron) con los
// argumentos ya dados literalmente ahi (PID(0.01,0.0001,0.4),
// PID(0.02,0,0.1), y un "otro PID de roll" del que el tutorial NO da
// ganancias -- se eligen aca kp=0.05/ki=0/kd=0.02 como valores
// razonables de arranque para un loop de actitud rapido, documentado
// como eleccion propia, no transcrito).
//
// deps: { flight (opcional, ya no se usa aca), MS_TO_KNOTS (no
//   necesario), METERS_TO_FEET (para convertir altitud SI -> pies, que
//   es la unidad que el apendice usa para el error de altitud) }
// ============================================================================

import { clamp, fixAngle, METERS_TO_FEET } from '../core/constants.js';

// --- Transcripcion literal del apendice ------------------------------------
export function PID(kp, ki, kd) {
  this._kp = kp; this._ki = ki; this._kd = kd;
  this.reset();
}
PID.prototype.reset = function () {
  this._previousInput = 0; this._integral = 0;
  this._minOutput = 0; this._maxOutput = 0; this._setPoint = 0;
};
PID.prototype.set = function (setPoint, minO, maxO) {
  this._setPoint = setPoint; this._minOutput = minO; this._maxOutput = maxO;
};
PID.prototype.compute = function (input, dt) {
  const err = this._setPoint - input;
  this._integral += err * dt * this._ki;
  this._integral = clamp(this._integral, this._minOutput, this._maxOutput);
  const dInput = -(input - this._previousInput); // derivative on measurement
  this._previousInput = input;
  return clamp(this._kp * err + this._integral + this._kd * dInput,
               this._minOutput, this._maxOutput);
};

// --- COMPLETADO: cadena de 3 autopilotos ------------------------------------
// createAutopilot() devuelve un objeto con .altitudeHold/.headingHold
// (booleanos, prendidos/apagados por separado, como cualquier AP real de
// GA) y .update(ac, dt) que, si estan prendidos, escribe controls.elevatorTrim/
// controls.roll directamente (mismo canal que usa el humano via
// controls.js, PARTE 10.1 -- controls.roll, no "aileron"; se conserva el
// vocabulario del apendice en los comentarios pero el campo real del
// proyecto es `roll`, ver controls.js).
// deps: { controls, aircraft (wrapper {instance}, PARTE 12), METERS_TO_FEET
//   ya importado internamente, no hace falta pasarlo) }
export function createAutopilot(deps) {
  const { controls, aircraft } = deps;

  const ap = {
    altitudeHold: false,
    headingHold: false,
    targetAltitudeFt: 0,
    targetHeadingDeg: 0,

    // PID(0.01, 0.0001, 0.4) sobre error de altitud en PIES, salida
    // directa a elevatorTrim [-1,1] -- valores y unidades transcritos
    // literalmente del apendice.
    _altPid: new PID(0.01, 0.0001, 0.4),
    // PID(0.02, 0, 0.1) sobre fixAngle(heading-course), salida a roll
    // target -- transcrito literalmente.
    _hdgPid: new PID(0.02, 0, 0.1),
    // PID de roll -> aileron: ganancias NO dadas por el tutorial (solo
    // dice "otro PID de roll que manda aileron"), elegidas aca.
    _rollPid: new PID(0.05, 0, 0.02),
  };

  ap._altPid.set(0, -1, 1);
  ap._hdgPid.set(0, -30, 30);   // roll target en grados, +-30 = banco maximo del AP
  ap._rollPid.set(0, -1, 1);

  ap.setAltitudeHold = function (on, targetFt) {
    ap.altitudeHold = on;
    if (on) {
      ap.targetAltitudeFt = targetFt != null ? targetFt : ap.targetAltitudeFt;
      ap._altPid.reset();
      ap._altPid.set(ap.targetAltitudeFt, -1, 1);
    }
  };

  ap.setHeadingHold = function (on, targetDeg) {
    ap.headingHold = on;
    if (on) {
      ap.targetHeadingDeg = targetDeg != null ? targetDeg : ap.targetHeadingDeg;
      ap._hdgPid.reset();
      ap._rollPid.reset();
      ap._hdgPid.set(0, -30, 30);
      ap._rollPid.set(0, -1, 1);
    }
  };

  // update(dt) — llamado una vez por subpaso desde flight-tick.js como
  // `autopilot.update(subDt)` (UN solo argumento, ver PARTE 5.6:
  // "autopilot { update(subDt) }") -- lee aircraft.instance internamente
  // en vez de recibirlo por parametro, mismo patron que el resto de las
  // funciones inyectadas por closure en este proyecto (ej. weather.
  // updateWind ya cierra sobre `aircraft` de la misma forma). Se llama
  // DENTRO del loop de subpasos, ANTES de que updateAirfoils/
  // applyEngineForces lean controls.elevatorTrim/controls.roll ese mismo
  // subpaso -- si se llamara despues el AP quedaria un frame atrasado.
  ap.update = function (dt) {
    const ac = aircraft && aircraft.instance;
    if (!ac) return;

    if (ap.altitudeHold) {
      const altFt = ac.llaLocation[2] * METERS_TO_FEET;
      controls.elevatorTrim = ap._altPid.compute(altFt, dt);
    }

    if (ap.headingHold) {
      // course = heading actual del avion (ac.htr[0], grados); el error
      // de heading se calcula sobre el ANGULO CORTO (fixAngle), no la
      // diferencia cruda, para que un AP con target=350 y heading
      // actual=10 gire 20 grados por la derecha en vez de 340 por la
      // izquierda.
      const headingErrorDeg = fixAngle(ap.targetHeadingDeg - (ac.htr ? ac.htr[0] : 0));
      // _hdgPid tiene setPoint=0 fijo (se compara contra el ERROR, no
      // contra el heading crudo) -- se le pasa -headingErrorDeg como
      // "input" para que su salida (rollTargetDeg) sea positiva cuando
      // hay que virar a la derecha (banco positivo = derecha, misma
      // convencion que controls.roll).
      const rollTargetDeg = ap._hdgPid.compute(-headingErrorDeg, dt);
      ap._rollPid.set(rollTargetDeg, -1, 1);
      const rollDeg = ac.htr ? ac.htr[2] : 0;
      controls.roll = ap._rollPid.compute(rollDeg, dt);
    }
  };

  return ap;
};
