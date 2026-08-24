// ============================================================================
// PARTE 12 — Aircraft: la pieza que faltaba desde PARTE 5/9
//
// Desde PARTE 5 (engines.js), PARTE 9 (aircraft-tree.js) y PARTE 4.10
// (elevation-management.js: makeFlyTo YA llama
// aircraft.instance.place()/.reset()) el proyecto da por sentado que
// existe una clase "Aircraft" con esos metodos y con
// aircraft.instance.engine/.rigidBody como estado singular -- pero el
// tutorial nunca la escribe como codigo, solo la nombra en el pseudocodigo
// de start() (PARTE 12: "sim.aircraft.instance = new Aircraft(coords)")
// y en la lista en prosa "Orden de dependencias al cargar un avion"
// (1. JSON->definition, 2. Object3D tree+glTF, 3. rigidBody.setMassProps,
// 4. recolectar airfoils/engines/wheels/collisionPoints, 5. place(),
// 6. onGround/impulso, 7. camera.reset(), 8. undoPause). ESTE archivo es
// esa clase, ensamblando en el ORDEN que la lista pide todo lo que las
// PARTES 1-11 ya construyeron.
//
// NOTA sobre el orden 2 vs 4: el tutorial los numera "2. Object3D tree"
// antes de "4. collisionPoints", pero aircraft-tree.js (PARTE 9, nota de
// cabecera) ya documenta que buildAircraftTree DEBE correr DESPUES de
// initAircraftCollisionPoints (necesita los mismos arrays de
// collisionPoints ya adjuntados a cada part para que compute() los
// actualice por referencia). Se resuelve el orden real aca como
// collisionPoints -> tree, con el motivo explicado en la nota de PARTE 9
// (no es una contradiccion nueva, ya estaba documentada, aca solo se
// respeta).
// ============================================================================

import { V3, M33 } from '../core/vectors.js';
import { DEGREES_TO_RAD } from '../core/constants.js';
import { RigidBody } from '../core/rigidbody.js';
import { initAircraftCollisionPoints } from '../terrain/collision-points.js';
import { buildAircraftTree, attachPlaceParts } from './aircraft-tree.js';
import { attachWakes } from '../water/wake.js';
import { Shadow } from '../terrain/ground-shadow.js';

// coords = [lat, lon, alt_rel_o_abs, heading, isAbsolute, speedKnots]
// (mismo formato que consume makeFlyTo, PARTE 4.10 — coords[2]===0 =>
// aparece en tierra).
export function Aircraft(coords) {
  this.llaLocation = [coords[0], coords[1], 0];
  this.htr = [coords[3] || 0, 0, 0];
  this.groundContact = false;
  this.waterContact = false;
  this.stalling = false;
}

// deps: { api, sim, definitions (mapa id->JSON, o funcion async
//   fetchDefinition(id)), MS_TO_KNOTS, shadowUrl (opcional) }
// Devuelve la propia instancia (this) para poder encadenar
// `aircraft.instance = await new Aircraft(coords).load(id, coords, deps)`.
Aircraft.prototype.load = async function (aircraftId, coords, deps) {
  const { api, sim, MS_TO_KNOTS } = deps;
  this.sim = sim; // guardado para render()/otros metodos que lo necesiten sin
                   // que flight-tick.js (PARTE 5.6) tenga que pasarlo en cada
                   // llamada a ac.render() (que ya se invoca sin argumentos).


  // --- 1. JSON -> definition ---------------------------------------------
  // El tutorial no especifica de donde sale el JSON (fetch a disco, mapa
  // en memoria, etc.) -- se acepta cualquiera de las dos formas via deps:
  // deps.definitions[aircraftId] (objeto ya cargado, ej. el propio
  // trainer-172.json importado) o deps.fetchDefinition(aircraftId)
  // (async, ej. fetch('/aircraft/' + id + '.json').then(r => r.json())).
  let definition = deps.definitions && deps.definitions[aircraftId];
  if (!definition && deps.fetchDefinition) definition = await deps.fetchDefinition(aircraftId);
  if (!definition) {
    throw new Error(`Aircraft.load: no se encontro la definicion "${aircraftId}" (ni en deps.definitions ni via deps.fetchDefinition).`);
  }
  this.definition = definition;

  // --- 4 (antes que 2, ver NOTA de cabecera) — collisionPoints ----------
  // attachCollisionPoints/initAircraftCollisionPoints (PARTE 4.6) leen
  // definition.parts[i].collisionPoints y calculan part.volume/
  // part.buoyancy/part.dragVector ANTES de que exista ningun Object3D --
  // buildAircraftTree (llamado justo abajo) espera encontrar esos mismos
  // arrays ya en cada part.
  initAircraftCollisionPoints(this);

  // --- 2. Object3D tree + glTF -------------------------------------------
  // buildAircraftTree ya recolecta airfoils/engines/balloons/suspensions
  // por tipo (PARTE 9.2) -- eso completa el resto del paso "4." de la
  // lista del tutorial (wheels = las partes con `part.suspension`, ya en
  // aircraft.suspensions).
  buildAircraftTree(this, api);

  // attachPlaceParts (PARTE 9.4) — otra pieza que el resto del proyecto
  // ya llamaba (flight-tick.js `ac.placeParts()`, contact-detection.js
  // `aircraft.placeParts({...})`) sin que nada la hubiera instanciado
  // todavia. Se adjunta aca, justo despues de construir el arbol (la
  // necesita: lee part.object3d de cada parte).
  attachPlaceParts(this);

  // --- 3. rigidBody.setMassProps ------------------------------------------
  // RigidBody(aircraft) espera el wrapper {instance}, no la instancia
  // pelada -- mismo patron que el resto del proyecto usa para pasarse
  // `aircraft` (ver flight-tick.js/main-loop.js: siempre {instance: ac}).
  const wrapper = { instance: this };
  this.rigidBody = new RigidBody(wrapper);
  this.rigidBody.setMassProps(definition.mass, definition.inertia);

  // Estado de motor SINGULAR (aircraft.engine, distinto de
  // aircraft.engines[] que es la lista de PARTES motor del arbol) --
  // engines.js (PARTE 5.3) ya lo lee/escribe (on/rpm/startup/
  // invRPMRange) sin que nada lo hubiera instanciado todavia; era el
  // RECORDATORIO pendiente desde PARTE 9/10/11.
  this.engine = {
    on: false,
    rpm: 0,
    startup: false,
    invRPMRange: definition.maxRPM > definition.minRPM
      ? 1 / (definition.maxRPM - definition.minRPM)
      : 0,
  };

  // --- 5. place(lla, htr) -> compute matrices ----------------------------
  const onGround = coords[2] === 0;
  let alt = coords[2];
  if (!coords[4]) alt += this.llaLocation[2]; // altitud relativa AGL sobre lo que ya tenia
  if (onGround) {
    // sim.groundElevation todavia puede no estar fresco (probeTerrain()
    // corre ANTES de load() segun el pseudocodigo de start(), pero es
    // fire-and-forget) -- 0 es un fallback seguro, el primer flyTo()/
    // terrainElevationManagement() del loop lo corrige el frame 1.
    alt = (sim.groundElevation || 0) + definition.startAltitude;
  }
  this.llaLocation = [coords[0], coords[1], alt];
  this.place(this.llaLocation, [coords[3] || 0, 0, 0]);

  // --- 6. onGround ? nada mas : applyCentralImpulse ----------------------
  if (!onGround) {
    const tas = (coords[5] || definition.minimumSpeed) / (MS_TO_KNOTS || 1.94384);
    const impulse = V3.scale(this.object3d.getWorldFrame()[1], tas * definition.mass);
    this.rigidBody.applyCentralImpulse(impulse);
  }

  // Estela (PARTE 11.3): un Wake por flotador/casco con buoyancy>0. En un
  // avion sin flotadores (ej. trainer-172) attachWakes no crea ninguno --
  // no-op seguro.
  attachWakes(this, api, deps.wakeOptions);

  // Sombra (PARTE 4.11): decal opcional, solo si el llamador la pide
  // (deps.shadowUrl) -- ground-shadow.js ya esta escrito para recibir
  // (sim, aircraft, lla) por parametro en cada frame, este modulo solo
  // la instancia una vez si hace falta.
  if (deps.shadowUrl && api && api.Model) {
    this.shadow = new Shadow(api, deps.shadowUrl, definition.boundingBox || [2, 2, 2]);
  }

  return this;
};

// place(lla, htr) — reposiciona la raiz del arbol sin pasar por
// flyTo/probeTerrain (uso interno de load(); makeFlyTo, PARTE 4.10, sigue
// siendo el camino recomendado para TELETRANSPORTES en vuelo, que
// ademas pausa/espera terreno garantizado).
//
// COMPLETADO (el tutorial nunca escribe place(), solo lo nombra en la
// lista de pasos y elevation-management.js/PARTE 4.10 ya lo LLAMA con
// htr=[heading_en_GRADOS, 0, 0]): Object3D.rotateInitialRotation(dRot)
// (PARTE 9.1) espera un delta en RADIANES que se COMPONE con la rotacion
// existente, no una orientacion absoluta -- llamarlo dos veces con el
// mismo heading giraria el avion el doble. place() por eso resetea
// _initialRotation a identidad ANTES de rotar: cada llamada fija una
// orientacion ABSOLUTA (heading/tilt/roll en grados, igual que el resto
// del proyecto expresa angulos en JSON/controles), consistente con que
// makeFlyTo pueda llamar place() una y otra vez en distintos
// teletransportes sin acumular drift.
Aircraft.prototype.place = function (lla, htr) {
  this.llaLocation = lla;
  this.object3d._initialRotation = M33.identity();
  this.object3d.rotateInitialRotation([
    (htr[0] || 0) * DEGREES_TO_RAD,
    (htr[1] || 0) * DEGREES_TO_RAD,
    (htr[2] || 0) * DEGREES_TO_RAD,
  ]);
  this.object3d.compute(lla);
  this.htr = this.object3d.htr;
};

// reset(onGround) — mismo nombre que ya llama makeFlyTo (PARTE 4.10) al
// teletransportar. Reinicia el estado dinamico (velocidades del
// RigidBody, contactos) sin recargar la definicion ni reconstruir el
// arbol Object3D -- por eso NO vuelve a llamar buildAircraftTree.
Aircraft.prototype.reset = function (onGround) {
  if (this.rigidBody) this.rigidBody.reset();
  this.groundContact = false;
  this.waterContact = false;
  this.stalling = false;
  // Suspensiones a reposo: mismo bypass que collectContacts hace cuando
  // !sim.withinCollisionRange (PARTE 4.7) -- se fuerza aca tambien para
  // que un avion reseteado en el aire no aparezca con el tren "hundido"
  // del ultimo aterrizaje.
  for (const sus of this.suspensions || []) {
    if (sus.suspension) sus.suspension.rest = true;
  }
};

// render() — posiciona lo que NO es una "parte" del arbol Object3D
// (placeParts(), PARTE 9.4, ya posiciona los modelos glTF de las
// PARTES): por ahora, solo la sombra (PARTE 4.11). flight-tick.js
// (PARTE 5.6) ya llama `ac.render()` al final de cada frame, una linea
// despues de `ac.placeParts()` -- este metodo faltaba, mismo caso que
// aircraft.engine arriba.
Aircraft.prototype.render = function () {
  if (this.shadow && this.sim) {
    this.shadow.setLocationRotation(this.sim, this, this.llaLocation);
  }
};
