// ============================================================================
// PARTE 9 — AERONAVE COMO ARBOL DE PARTES: Object3D
//
// Object3D es un nodo de escena PROPIO (no Cesium Entity/Model): solo
// hace algebra de matrices 3x3 + vectores, sin tocar el renderer. Cada
// parte de la aeronave (fuselaje, ala, motor, rueda) es un nodo con:
//   - _localPosition / _localRotation  : offset respecto al PADRE
//   - _rotation                        : orientacion acumulada en MUNDO
//     (= _parent._rotation * _localRotation; para la raiz, = _initialRotation)
//   - points / collisionPoints         : arrays [x,y,z] locales al nodo,
//     mutados in-place cada compute() con un `.worldPosition` (offset en
//     metros ENU respecto a la raiz, NO una LLA — quien necesite la LLA
//     completa usa Object3D.utilities.getPointLla, mas abajo)
//
// Transcrito verbatim de PARTE 9 del tutorial, con TRES adiciones que el
// tutorial usa desde PARTE 4/5 (antes de que este archivo existiera) pero
// nunca definio explicitamente en el bloque de codigo de Object3D:
//
//   1. `worldRotation`: alias publico de `_rotation`, seteado al final
//      de compute(). airfoils.js (PARTE 5.4) ya hace
//      `aircraft.object3d.worldRotation[1]` para la direccion "nariz" del
//      avion (columna Y = adelante, ver vectors.js/M33.transform). Sin
//      esta linea `worldRotation` seria undefined y PARTE 5 rompe.
//   2. `setVectorWorldPosition(v)`: collision-response.js (PARTE 4.8) ya
//      hace `aircraft.object3d.setVectorWorldPosition(part.dragVector)`
//      y luego lee `part.dragVector.worldPosition`. Es la MISMA
//      operacion que compute() hace para _points/_collisionPoints (rotar
//      un vector local [x,y,z] por _rotation y guardar el resultado en
//      `.worldPosition`), pero expuesta como metodo publico para vectores
//      que no viven en el registro _points de ningun nodo (dragVector es
//      una propiedad suelta de la parte, agregada en PARTE 4.6
//      collision-points.js).
//   3. `Object3D.utilities.getPointLla(point, refLla)`: airfoils.js
//      (PARTE 5.4) ya hace
//      `Object3D.utilities.getPointLla(r, aircraft.llaLocation)` para
//      samplear turbulencia EN la posicion real del ala, no en el CG.
//      Es exactamente el patron `V3.add(refLla, xyz2lla_fast(point.worldPosition,
//      refLla))` que PARTE 4.7 (contact-detection.js) ya repite inline
//      linea por linea; se factoriza aca para no triplicar el codigo.
//   4. compute() suma this.worldPosition al transformar cada punto/
//      collisionPoint (el tutorial NO lo suma). Ver el comentario extenso
//      junto a esa linea mas abajo: sin la suma, los puntos de partes que
//      no son la raiz (todas las ruedas, todas las alas) quedan mal
//      ubicados, inconsistente con como trainer-172.json (PARTE 5, ya
//      entregado) declara sus points/collisionPoints.
// ============================================================================

import { M33, V3 } from './vectors.js';
import { xyz2lla_fast } from './coordinates.js';

export function Object3D(options) {
  options = options || {};
  this._name = options.name;
  this._children = [];
  this._points = options.points || {};
  this._collisionPoints = options.collisionPoints || [];
  this._rotation = M33.identity();
  this._initialRotation = M33.identity();
  this.worldRotation = this._rotation;
  this.htr = [0, 0, 0];

  // _localPosition/_localRotation: offset respecto al padre. Default
  // identidad/origen para nodos creados "sueltos" (tests, raiz sin
  // padre); el arbolado real (PARTE 9, aircraft-tree.js) los sobreescribe
  // con la `position` declarada en el JSON de la parte.
  this._localPosition = options.position || [0, 0, 0];
  this._localRotation = M33.identity();

  if (options['3dmodel']) this.setModel(options['3dmodel']);
}

Object3D.prototype.addChild = function (child) {
  child._parent = this;
  this._children.push(child);
};

// setModel: el tutorial la referencia (`if (options["3dmodel"]) this.setModel(...)`)
// sin darla — se implementa como un simple setter, ya que la construccion
// real del modelo glTF (api.Model, ver aircraft-tree.js/ground-shadow.js)
// vive fuera de Object3D (este nodo no conoce Cesium, solo geometria).
Object3D.prototype.setModel = function (model) {
  this._model = model;
};
Object3D.prototype.getModel = function () {
  return this._model;
};

Object3D.prototype.compute = function (lla) {
  // Concatena rotaciones parent * local, transforma points a worldPosition
  if (this._parent) {
    this._rotation = M33.multiplyExpanded(this._parent._rotation, this._localRotation);
    this.worldPosition = V3.add(
      this._parent.worldPosition,
      M33.transform(this._parent._rotation, this._localPosition)
    );
  } else {
    this._rotation = this._initialRotation;
    this.worldPosition = [0, 0, 0];
    this.htr = M33.getOrientation(this._rotation);
  }
  this.worldRotation = this._rotation; // alias publico, ver nota (1) arriba
  // DESVIACION DOCUMENTADA respecto al bloque de codigo literal del
  // tutorial: la version del tutorial hace
  //   p.worldPosition = M33.transform(this._rotation, [p[0], p[1], p[2]]);
  // SIN sumar this.worldPosition. Eso deja cada punto/collisionPoint
  // relativo al ORIGEN DEL PROPIO NODO, no al CG/raiz -- que es
  // exactamente lo que necesitan rigidBody.applyForce(F, r) y
  // collectContacts (PARTE 4/5: `r` ahi es "offset del punto respecto al
  // CG", ver AVISO DE SIGNO en core/rigidbody.js). Es inconsistente con
  // los datos de aeronave YA ENTREGADOS en este proyecto
  // (aircraft/definitions/trainer-172.json, PARTE 5): esa aeronave
  // declara points/collisionPoints como offsets CHICOS relativos al
  // origen de CADA parte (ej. la rueda izquierda tiene
  // position=[-1.15,0.15,-1.05] Y collisionPoints=[[0,0,-0.15]] por
  // separado -- el [0,0,-0.15] es claramente "15 cm bajo el punto de
  // anclaje de LA RUEDA", no "15 cm bajo el CG del avion"). Sin sumar
  // this.worldPosition, TODOS los puntos de TODAS las partes quedarian
  // apilados cerca del CG (tren de aterrizaje incluido), rompiendo
  // colisiones y lift de forma silenciosa (sin crashear, solo con
  // fisica incorrecta) para cualquier parte que no sea la raiz. Se
  // corrige sumando this.worldPosition, el mismo patron que el propio
  // tutorial usa dos lineas mas arriba para calcular el worldPosition
  // DEL NODO. Para la raiz (this.worldPosition=[0,0,0]) el resultado es
  // identico al del tutorial: el fix es un no-op ahi.
  for (const k in this._points) {
    const p = this._points[k];
    p.worldPosition = V3.add(this.worldPosition, M33.transform(this._rotation, [p[0], p[1], p[2]]));
  }
  for (const cp of this._collisionPoints) {
    cp.worldPosition = V3.add(this.worldPosition, M33.transform(this._rotation, [cp[0], cp[1], cp[2]]));
  }
  for (const c of this._children) c.compute(lla);
};

Object3D.prototype.getWorldFrame = function () {
  return this._rotation;
};

// Ver nota (2) arriba: usado por collision-response.js para vectores
// "sueltos" (dragVector) que no son un _points registrado de ningun nodo.
Object3D.prototype.setVectorWorldPosition = function (v) {
  v.worldPosition = M33.transform(this._rotation, [v[0], v[1], v[2]]);
  return v.worldPosition;
};

Object3D.prototype.rotateInitialRotation = function (dRot) {
  // dRot en radianes, ejes mundo locales del avion
  this._initialRotation = M33.rotationXYZ(this._initialRotation, dRot);
};

Object3D.prototype.resetRotationMatrix = function () {
  // Re-ortonormaliza para matar drift
  const f = this._initialRotation[1];
  const u = this._initialRotation[2];
  this._initialRotation = M33.makeOrthonormalFrame(f, u);
};

// ----------------------------------------------------------------------------
// Object3D.utilities — ver nota (3) arriba.
// ----------------------------------------------------------------------------
Object3D.utilities = {
  // point: cualquier entrada de _points/_collisionPoints/vector suelto ya
  // procesado por compute()/setVectorWorldPosition (tiene .worldPosition,
  // un offset ENU en metros respecto a refLla). Devuelve la LLA completa
  // del punto, no solo el delta.
  getPointLla(point, refLla) {
    return V3.add(refLla, xyz2lla_fast(point.worldPosition, refLla));
  },
};
