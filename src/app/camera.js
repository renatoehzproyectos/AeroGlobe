// ============================================================================
// PARTE 10.2 — CAMARA
//
// camera.update() en modo "follow" es transcripcion literal del
// tutorial. El resto de este archivo llena huecos que el tutorial deja
// sin codigo (solo los menciona en prosa):
//
//   - `def.position`/`def.orientations.current`/`def.offsets.current`:
//     el codigo del tutorial los USA pero trainer-172.json (PARTE 5, ya
//     entregado) solo declara `follow: { distance: 12, orientation: [0,8,0] }`
//     — sin position, sin "orientations" (plural) ni "offsets". Se
//     resuelve normalizando cada definicion de camara del JSON en
//     buildCameraDefinition() (mas abajo): position default [0,0,0],
//     orientations = {base: json.orientation, current: dup(base)} (asi
//     "orientation" del JSON se convierte en el `.current` que el
//     update() del tutorial espera), offsets = {base:[0,0,0], current:[0,0,0]}.
//   - modo "cockpit": el tutorial solo tiene el `if (def.name === "follow")`
//     y menciona que existe una vista interior (trainer-172.json declara
//     `cockpit: {position, insideView:true}`), sin dar su codigo. Se
//     implementa como una camara RIGIDAMENTE pegada al avion (sin lag:
//     la cabeza del piloto no tiene inercia de camara de documental),
//     en la posicion local `def.position` rotada por el frame actual del
//     avion.
//   - ciclo de camara ("C ciclo de camara", solo mencionado en la tabla
//     de teclado) y orbita de mouse en modo follow/free ("En chase/free,
//     el raton orbita" — una frase, sin codigo): se implementan como
//     cycleCamera() y attachMouseOrbit(), documentados como
//     interpretacion/completado, no transcripcion.
// ============================================================================

import { M33, V3 } from '../core/vectors.js';
import { DEGREES_TO_RAD, fixAngle, fixAngle360, clamp } from '../core/constants.js';
import { xyz2lla_fast, lookAt } from '../core/coordinates.js';

const GROUND_AVOIDANCE_IGNORE = 100;   // m AGL: por encima, no molestarse en sondear el suelo
const GROUND_AVOIDANCE_MARGIN = 0.5;   // m: distancia minima camara-suelo

// Normaliza una entrada de aircraft.definition.cameras (JSON) al shape
// que camera.update() necesita. Ver nota de cabecera arriba.
function buildCameraDefinition(name, json) {
  const orientationBase = json.orientation || [0, 0, 0];
  return {
    name,
    distance: json.distance || 0,
    position: json.position || [0, 0, 0],
    insideView: !!json.insideView,
    orientations: { base: orientationBase, current: V3.dup(orientationBase) },
    offsets: { base: [0, 0, 0], current: [0, 0, 0] },
    lastUsedHtr: [0, 0, 0],
  };
}

// deps: { api, sim, aircraft, Cesium (opcional, no se usa directo aca) }
export function createCamera(deps) {
  const { api, sim, aircraft } = deps;
  const camera = {
    cam: api.camera, // Cesium.Camera real, inyectado (ver world-init.js)
    groundAvoidanceIgnore: GROUND_AVOIDANCE_IGNORE,
    groundAvoidanceMargin: GROUND_AVOIDANCE_MARGIN,
    lla: [0, 0, 1000],
    htr: [0, 0, 0],
    _groundCtx: {},
  };

  // Arma camera.definitions a partir de aircraft.definition.cameras (si
  // no hay ninguna declarada, cae a un follow generico razonable en vez
  // de crashear con currentDefinition undefined).
  camera.buildDefinitions = function () {
    const src = (aircraft.instance && aircraft.instance.definition.cameras) || {
      follow: { distance: 12, orientation: [0, 8, 0] },
    };
    camera.definitions = {};
    camera.order = [];
    for (const name in src) {
      camera.definitions[name] = buildCameraDefinition(name, src[name]);
      camera.order.push(name);
    }
    camera.currentDefinition = camera.definitions[camera.order[0]];
  };
  camera.buildDefinitions();

  // ciclo de camara ("C" en el mapa de teclado, 10.1): pasa a la
  // siguiente definicion declarada en el JSON de la aeronave (follow ->
  // cockpit -> follow -> ...). No transcrito del tutorial (solo
  // mencionado en la tabla), es la interpretacion mas directa de
  // "ciclo".
  camera.cycleCamera = function () {
    const i = camera.order.indexOf(camera.currentDefinition.name);
    camera.currentDefinition = camera.definitions[camera.order[(i + 1) % camera.order.length]];
  };

  camera.setGroundAltitude = function () {
    camera.groundAltitude = api.getGroundAltitude(camera.lla, camera._groundCtx);
  };

  camera.avoidGround = function () {
    if (sim.relativeAltitude != null && sim.relativeAltitude > camera.groundAvoidanceIgnore) return;
    camera.setGroundAltitude();
    if (camera.lla[2] - camera.groundAltitude <= camera.groundAvoidanceMargin) {
      camera.lla[2] = camera.groundAltitude + camera.groundAvoidanceMargin;
    }
  };

  camera.update = function (dt) {
    const ac = aircraft.instance;
    const def = camera.currentDefinition;

    if (def.name === 'follow') {
      const lag = 1 - Math.exp(-dt / 0.5);                 // follow suave
      const h = def.lastUsedHtr[0] + fixAngle(ac.htr[0] - def.lastUsedHtr[0]) * lag;
      const t = def.lastUsedHtr[1] + fixAngle(ac.htr[1] - def.lastUsedHtr[1]) * lag;
      def.lastUsedHtr = [h, t, 0];
      const yaw = h + def.orientations.current[0];
      const pit = t + def.orientations.current[1];
      const R = M33.rotationXYZ(M33.identity(), [pit * DEGREES_TO_RAD, 0, yaw * DEGREES_TO_RAD]);
      camera.worldPosition = V3.add(def.position, def.offsets.current);
      let offset = M33.transform(R, camera.worldPosition);
      let back = V3.scale(R[1], -def.distance);
      const lookAtLla = V3.add(ac.llaLocation, xyz2lla_fast(offset, ac.llaLocation));
      camera.lla = V3.add(lookAtLla, xyz2lla_fast(back, lookAtLla));
      camera.avoidGround();
      camera.htr = lookAt(lookAtLla, camera.lla, [0, 0, 1]);
      camera.htr = [fixAngle360(camera.htr[0]), fixAngle360(-camera.htr[1]), 0];
      api.setCameraPositionAndOrientation(camera.cam, camera.lla, camera.htr);
    } else if (def.insideView || def.name === 'cockpit') {
      // Cockpit: pegada al avion, sin lag (la cabeza del piloto viaja
      // solidaria con la aeronave, no "flota" 0.5s detras como el chase
      // cam). def.position es un offset local (metros, en el frame del
      // avion) tipicamente cerca del asiento del piloto.
      const worldOffset = M33.transform(ac.object3d.getWorldFrame(), def.position);
      camera.lla = V3.add(ac.llaLocation, xyz2lla_fast(worldOffset, ac.llaLocation));
      // Mirar hacia adelante mas el offset de orbita de mouse (si el
      // usuario "mira alrededor" con el raton en cockpit, ver
      // attachMouseOrbit): se suma directo al heading/tilt del avion.
      camera.htr = [
        fixAngle360(ac.htr[0] + def.orientations.current[0]),
        clamp(ac.htr[1] + def.orientations.current[1], -89, 89),
        ac.htr[2],
      ];
      api.setCameraPositionAndOrientation(camera.cam, camera.lla, camera.htr);
    }
  };

  return camera;
}

// ----------------------------------------------------------------------------
// attachMouseOrbit — "En chase/free, el raton orbita. En cockpit, el
// raton mira alrededor." (unica mencion en el tutorial, sin codigo). Se
// completa con el gesto estandar: arrastrar con boton apretado ajusta
// def.orientations.current[0]/[1] (yaw/pitch) sumados a la orientacion
// base; en cockpit, lo mismo pero interpretado como "mirar alrededor"
// (mismo mecanismo, la diferencia de comportamiento ya la hace
// camera.update() al usarlo distinto segun el modo).
//
// No usa Cesium directamente: solo pixeles de movimiento del mouse sobre
// `el elemento del viewport`.
// ----------------------------------------------------------------------------
// NOTA MOBILE: se usan Pointer Events (pointerdown/move/up/cancel) en vez
// de mouse-only (mousedown/mousemove/mouseup) para que el MISMO codigo
// orbite la camara con el dedo en touch (movil/tablet) y con el mouse en
// desktop -- los navegadores mapean touch a eventos "pointer" con
// pointerType: 'touch' automaticamente, sin listeners separados.
//
// touch-action: 'none' en el elemento es NECESARIO en movil: sin eso, el
// navegador intercepta el gesto de arrastre como scroll/pan de la
// pagina antes de que lleguen los eventos pointermove aca (por eso "no
// puedo mover la camara" en el celular incluso con los listeners
// puestos). Tambien evita el pinch-zoom del navegador sobre el canvas.
//
// setPointerCapture asegura que, si el dedo/mouse se desliza fuera del
// elemento durante el arrastre, se sigan recibiendo los eventos de
// move/up igual (mouseleave con touch no dispara de forma confiable).
export function attachMouseOrbit(camera, viewportEl, sensitivity) {
  sensitivity = sensitivity || 0.15; // grados por pixel
  let dragging = false;
  let activePointerId = null;
  let lastX = 0, lastY = 0;

  viewportEl.style.touchAction = 'none';

  function onDown(e) {
    // Solo el primer dedo/boton inicia la orbita; ignora multi-touch
    // (dos dedos se dejan libres para futuros gestos, ej. pinch-zoom).
    if (dragging) return;
    dragging = true;
    activePointerId = e.pointerId;
    lastX = e.clientX; lastY = e.clientY;
    if (viewportEl.setPointerCapture) {
      try { viewportEl.setPointerCapture(e.pointerId); } catch (err) { /* no-op */ }
    }
  }
  function onUp(e) {
    if (e.pointerId !== activePointerId) return;
    dragging = false;
    activePointerId = null;
  }
  function onMove(e) {
    if (!dragging || e.pointerId !== activePointerId) return;
    const dx = e.clientX - lastX, dy = e.clientY - lastY;
    lastX = e.clientX; lastY = e.clientY;
    const def = camera.currentDefinition;
    const base = def.orientations.base;
    def.orientations.current[0] = base[0] + fixAngle((def.orientations.current[0] - base[0]) + dx * sensitivity);
    def.orientations.current[1] = clamp((def.orientations.current[1]) + dy * sensitivity, base[1] - 80, base[1] + 80);
  }

  viewportEl.addEventListener('pointerdown', onDown);
  viewportEl.addEventListener('pointerup', onUp);
  viewportEl.addEventListener('pointercancel', onUp);
  viewportEl.addEventListener('pointermove', onMove);

  return function detach() {
    viewportEl.removeEventListener('pointerdown', onDown);
    viewportEl.removeEventListener('pointerup', onUp);
    viewportEl.removeEventListener('pointercancel', onUp);
    viewportEl.removeEventListener('pointermove', onMove);
  };
}
