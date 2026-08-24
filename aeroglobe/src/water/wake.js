// ============================================================================
// PARTE 11.3 — Estela (wake) de flotadores/cascos
//
// El tutorial describe esto en UNA frase sin codigo: "La estela es un
// ParticleEmitter anclado al flotador, followPath=true, que genera
// billboards a lo largo de la trayectoria cuando waterContact." Se
// implementa aca completo, siguiendo el mismo patron de dependencias
// inyectadas de Cloud (billboard PNG orientado a camara, PARTE 6.8,
// src/clouds/cloud-manager.js) y Shadow (decal glTF, PARTE 4.11,
// src/terrain/ground-shadow.js): un constructor que envuelve
// api.ParticleEmitter, con .update() llamado una vez por frame desde
// fuera (aca, desde updateWake()).
//
// aircraft.waterContact ya lo escribe contact-detection.js (PARTE 4.7,
// YA ENTREGADO) cuando cualquier collisionPoint con part.buoyancy esta
// sumergido -- este modulo solo LEE ese flag, no lo calcula.
//
// api.ParticleEmitter: constructor inyectado por la capa de render
// (Cesium.ParticleSystem o equivalente), asumido con la forma minima
// { position, followPath (boolean), emitting (boolean),
//   setModelMatrix(matrix) } segun la unica frase del tutorial que lo
// menciona -- no hay mas detalle para transcribir literalmente, asi que
// la forma exacta de las opciones queda como config razonable,
// documentada inline, ajustable sin tocar la logica de cuando
// emitir/apagar.
// ============================================================================

const DEFAULT_WAKE_OPTIONS = {
  image: 'images/effects/wake.png',
  particleLife: 4,       // s: cuanto dura cada billboard de espuma antes de desvanecer
  emissionRate: 20,      // particulas/s mientras hay waterContact
  startScale: 0.5,
  endScale: 4,
  startColorAlpha: 0.6,
  endColorAlpha: 0,
  // La estela solo tiene sentido a partir de cierta velocidad relativa al
  // agua (a velocidad ~0 flotando quieto no hay espuma) -- umbral no dado
  // por el tutorial, valor razonable documentado aca.
  minSpeedForWake: 0.5, // m/s
};

// part: la parte del arbol Object3D (PARTE 9) que representa el flotador/
//       casco, la misma referencia que ya tiene part.buoyancy > 0 (PARTE
//       4.6, collision-points.js) y a la que contact-detection.js le
//       setea part.contact = {type:'buoyancy', ...} cuando esta sumergida.
// api: { ParticleEmitter } inyectado, mismo patron que api.Model.
export function Wake(part, api, options) {
  this.part = part;
  this.api = api;
  this.options = { ...DEFAULT_WAKE_OPTIONS, ...options };
  this.emitter = null;
  this.active = false;
}

Wake.prototype.attach = function () {
  if (!this.api || !this.api.ParticleEmitter) return;
  this.emitter = new this.api.ParticleEmitter({
    image: this.options.image,
    followPath: true, // la estela queda anclada a la trayectoria pasada, no persigue al avion
    emitting: false,
    particleLife: this.options.particleLife,
    emissionRate: this.options.emissionRate,
    startScale: this.options.startScale,
    endScale: this.options.endScale,
    startColor: [1, 1, 1, this.options.startColorAlpha],
    endColor: [1, 1, 1, this.options.endColorAlpha],
  });
};

// Llamado una vez por frame (ver updateWake mas abajo). speed: velocidad
// horizontal del avion en m/s (aircraft.rigidBody / animation.values.ktas
// convertido, segun lo que exponga PARTE 12) -- se pasa ya calculada en
// vez de recalcularla aca para no acoplar este modulo a la forma exacta
// del rigid body.
Wake.prototype.update = function (waterContact, speed) {
  if (!this.emitter) return;

  this.active = !!waterContact && speed > this.options.minSpeedForWake;
  this.emitter.emitting = this.active;

  if (this.active && this.part.object3d && this.emitter.setModelMatrix) {
    const frame = this.part.object3d.getWorldFrame();
    this.emitter.setModelMatrix(frame);
  }
};

Wake.prototype.destroy = function () {
  if (this.emitter && this.emitter.destroy) this.emitter.destroy();
  this.emitter = null;
};

// ----------------------------------------------------------------------------
// attachWakes(aircraft, api, options) — recorre aircraft.collisionPoints
// (PARTE 4.6, ya entregado por buildAircraftTree/initAircraftCollisionPoints)
// y crea un Wake por cada `part` DISTINTA con buoyancy > 0 (un hidroavion
// con dos flotadores tiene 2 collisionPoints de tipo buoyancy por flotador
// pero solo necesita UNA estela por flotador, no una por collisionPoint).
// Devuelve aircraft.wakes (array), consumido por updateWake() cada frame.
// ----------------------------------------------------------------------------
export function attachWakes(aircraft, api, options) {
  const seen = new Set();
  const wakes = [];
  for (const cp of aircraft.collisionPoints || []) {
    const part = cp.part;
    if (!part || !part.buoyancy || seen.has(part)) continue;
    seen.add(part);
    const wake = new Wake(part, api, options);
    wake.attach();
    wakes.push(wake);
  }
  aircraft.wakes = wakes;
  return wakes;
}

// updateWake — un llamado por frame desde flight-tick.js/main-loop.js
// (PARTE 12 conecta esto, igual que updatePartAnimations en PARTE 9.3).
// speed: m/s horizontal, ya calculada por quien llama (ej.
// animation.values.ktas / MS_TO_KNOTS).
export function updateWake(aircraft, speed) {
  if (!aircraft.wakes) return;
  for (const wake of aircraft.wakes) {
    wake.update(aircraft.waterContact, speed);
  }
}
