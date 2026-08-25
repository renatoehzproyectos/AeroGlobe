// ============================================================================
// PARTE 9 — ENSAMBLADO DEL ARBOL DE PARTES
//
// El tutorial da la clase Object3D (ver core/object3d.js) y el fragmento
// de applyPartAnimation, pero no el codigo que RECORRE
// aircraft.definition.parts (el JSON plano, con `parent` como nombre de
// string — ver trainer-172.json) y arma el arbol real de nodos. Esto es
// el pegamento que PARTE 5 (engines.js/balloons.js/airfoils.js/
// flight-tick.js) y PARTE 4 (collision-points.js/contact-detection.js)
// ya dan por hecho que existe:
//   - aircraft.object3d           (raiz del arbol)
//   - aircraft.parts              ({name: partDef}, con partDef.object3d)
//   - aircraft.airfoils / .engines / .balloons / .suspensions  (arrays
//     filtrados por tipo, que PARTE 5 itera directamente)
//   - aircraft.placeParts(subset) (posiciona los modelos glTF via
//     api.Model, mismo patron que Shadow en ground-shadow.js PARTE 4.11)
//
// buildAircraftTree(aircraft, api) debe llamarse UNA vez al cargar la
// aeronave, DESPUES de initAircraftCollisionPoints(aircraft) (PARTE 4.6):
// ese orden importa porque attachCollisionPoints ya rellena
// part.dragVector/part.volume/part.buoyancy que este modulo no toca, y
// porque aircraft.collisionPoints (la lista PLANA que lee contact-
// detection.js) y los `_collisionPoints` de cada Object3D DEBEN ser los
// MISMOS arrays (mismas referencias) para que compute() los actualice en
// el mismo lugar que lee collectContacts — ver nota en collision-points.js.
// ============================================================================

import { M33 } from '../core/vectors.js';
import { DEGREES_TO_RAD } from '../core/constants.js';
import { Object3D } from '../core/object3d.js';

export function buildAircraftTree(aircraft, api) {
  const parts = aircraft.definition.parts;
  aircraft.parts = {};
  aircraft.airfoils = [];
  aircraft.engines = [];
  aircraft.balloons = [];
  aircraft.suspensions = [];

  // Paso 1: un Object3D por parte, todavia sin padre asignado. Las
  // wheels con `suspension` reciben un punto suspensionOrigin en [0,0,0]
  // si el JSON no trae uno explicito -- contact-detection.js (PARTE 4.7)
  // ya lee/escribe part.points.suspensionOrigin (anima el piston del
  // tren corriendo su Z local), asi que el punto tiene que existir antes
  // del primer compute().
  for (const part of parts) {
    part.points = part.points || {};
    if (part.suspension && !part.points.suspensionOrigin) {
      part.points.suspensionOrigin = [0, 0, 0];
    }

    const node = new Object3D({
      name: part.name,
      points: part.points,
      collisionPoints: part.collisionPoints,
      position: part.position || [0, 0, 0],
    });
    part.object3d = node;
    aircraft.parts[part.name] = part;

    if (part.type === 'airfoil') aircraft.airfoils.push(part);
    // BUGFIX: engines.js (PARTE 5.3) hace `eng.rpm += (target - eng.rpm) *
    // inertia * dt` sobre cada parte motor, pero nada inicializaba
    // `part.rpm` -- quedaba `undefined`, y `undefined + numero = NaN` en
    // el primerisimo frame en que el motor esta encendido (quedaba
    // enmascarado mientras aircraft.engine.on nunca llegaba a true, ver
    // el otro BUGFIX en aircraft.js). Se inicializa aca junto al resto
    // del estado de la parte motor.
    else if (part.type === 'engine') { part.rpm = 0; part.currentThrust = 0; aircraft.engines.push(part); }
    else if (part.type === 'balloon' || part.type === 'envelope') aircraft.balloons.push(part);
    if (part.suspension) aircraft.suspensions.push(part);

    // Modelo glTF opcional. api.Model es el mismo constructor inyectado
    // que usa Shadow (PARTE 4.11): este modulo tampoco toca Cesium
    // directamente, solo pide al layer de render que cree el modelo.
    if (part.model && api && api.Model) {
      node.setModel(new api.Model(part.model, aircraft.definition.scale));
    }
  }

  // Paso 2: wiring padre/hijo por nombre. Exactamente UNA parte sin
  // `parent` (la raiz, tipicamente "root" en fuselage). Si el JSON
  // declarara mas de una o ninguna, es un error de datos del avion, no
  // de este modulo -- se deja como excepcion explicita en vez de fallar
  // en silencio con `aircraft.object3d` apuntando a cualquier cosa.
  let root = null;
  for (const part of parts) {
    if (part.parent) {
      const parentPart = aircraft.parts[part.parent];
      if (!parentPart) {
        throw new Error(`Aeronave "${aircraft.definition.name}": la parte "${part.name}" declara parent="${part.parent}", que no existe.`);
      }
      parentPart.object3d.addChild(part.object3d);
    } else {
      if (root) {
        throw new Error(`Aeronave "${aircraft.definition.name}": mas de una parte sin parent (raiz duplicada: "${root.name}" y "${part.name}").`);
      }
      root = part;
    }
  }
  if (!root) {
    throw new Error(`Aeronave "${aircraft.definition.name}": ninguna parte declara ausencia de parent (falta la raiz).`);
  }
  aircraft.object3d = root.object3d;

  return aircraft.object3d;
}

// ----------------------------------------------------------------------------
// Animaciones de partes (alerones, tren, helice, timon). Se llama UNA vez
// por subpaso, ANTES de aircraft.object3d.compute() (ver la nota de
// integracion al pie de flight-tick.js, PARTE 5.6): compute() propaga
// _localRotation hacia _rotation, asi que si esto corriera DESPUES el
// alma quedaria un frame atrasada respecto al lift que calcula airfoils.js.
//
// animation.filter(a) lee animation.values[a.value] (ej. "roll", "pitch",
// "trim") con el suavizado/clamping que le corresponda: esa funcion es
// una dependencia INYECTADA (PARTE 10, loop principal + instrumentos),
// no algo que este modulo defina.
// ----------------------------------------------------------------------------
export function applyPartAnimation(part, animation) {
  if (!part.animations) return;
  let extra = M33.identity();
  for (const a of part.animations) {
    if (a.type !== 'rotate') continue; // otros tipos (throttle, pitch de helice) los lee engines.js directo
    const value = animation.filter(a);
    const angle = value * (a.ratio || 1) * DEGREES_TO_RAD;
    if (a.axis === 'X') extra = M33.rotationX(extra, angle);
    if (a.axis === 'Y') extra = M33.rotationY(extra, angle);
    if (a.axis === 'Z') extra = M33.rotationZ(extra, angle);
  }
  part.object3d._localRotation = extra;
}

export function updatePartAnimations(aircraft, animation) {
  for (const name in aircraft.parts) {
    applyPartAnimation(aircraft.parts[name], animation);
  }
}

// ----------------------------------------------------------------------------
// aircraft.placeParts(subset) — posiciona los modelos glTF de cada parte
// que tenga uno (part.object3d.getModel()) en su LLA/orientacion actual.
// flight-tick.js (PARTE 5.6) ya llama `ac.placeParts()` sin argumento una
// vez por frame (todas las partes); contact-detection.js (PARTE 4.7) ya
// llama `aircraft.placeParts({ [part.name]: part })` con UN solo par
// nombre->parte cuando anima el piston de un tren en pleno subpaso (para
// que el visual de la suspension no espere al placeParts() de fin de
// frame). Por eso `subset` acepta el mismo shape que aircraft.parts
// (un diccionario nombre->parte), no un array.
//
// Requiere que aircraft.object3d.compute(lla) ya se haya llamado ese
// frame (usa worldPosition/getWorldFrame() de cada nodo, no recalcula
// nada de fisica).
// ----------------------------------------------------------------------------
export function attachPlaceParts(aircraft) {
  aircraft.placeParts = function (subset) {
    const dict = subset || aircraft.parts;
    for (const name in dict) {
      const part = dict[name];
      const model = part.object3d && part.object3d.getModel && part.object3d.getModel();
      if (!model) continue;
      const lla = Object3D.utilities.getPointLla(
        { worldPosition: part.object3d.worldPosition }, aircraft.llaLocation
      );
      const htr = M33.getOrientation(part.object3d.getWorldFrame());
      model.setPositionOrientationAndScale(lla, htr, model.scale || [1, 1, 1]);
    }
  };
  return aircraft.placeParts;
}
