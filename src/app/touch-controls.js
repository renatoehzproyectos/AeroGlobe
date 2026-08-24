// ============================================================================
// TOUCH CONTROLS (movil) — no forma parte del tutorial transcripto; se
// agrega porque controls.js (PARTE 10.1) solo escucha keydown/keyup, y un
// telefono/tablet no tiene teclado fisico. En vez de tocar controls.js
// (ya probado: expone exactamente los ejes controls.keyboard.pitch/roll/
// yaw/throttleUp/throttleDown/brakes y los metodos toggleGear/
// cycleFlaps), este modulo dibuja una capa HTML encima del viewport y
// ESCRIBE sobre esos mismos campos -- para el resto del simulador
// (controls.update(), flight-tick.js) un dedo en la pantalla es
// indistinguible de una tecla apretada.
//
// Se activa solo si el dispositivo reporta soporte de touch
// (ver isTouchDevice() en bootstrap.js) para no tapar la pantalla de
// quien juega con teclado/mouse en desktop.
//
// UI: joystick virtual abajo-izquierda (roll = eje X, pitch = eje Y,
// como W/S y A/D combinados), throttle vertical abajo-derecha, y una
// fila de botones chicos (yaw izq/der, freno, tren, flaps, camara)
// arriba de esos dos controles. Todo con pointer events (mismo motivo
// que camera.js: touch-action:none para que el navegador no se robe el
// gesto como scroll).
// ============================================================================

const STICK_RADIUS = 55; // px, que tan lejos del centro llega el eje a +-1

function makeEl(tag, styles, parent) {
  const el = document.createElement(tag);
  Object.assign(el.style, styles);
  if (parent) parent.appendChild(el);
  return el;
}

const baseButtonStyle = {
  position: 'absolute',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'sans-serif',
  fontSize: '13px',
  fontWeight: '600',
  color: '#fff',
  background: 'rgba(20,20,25,0.55)',
  border: '1px solid rgba(255,255,255,0.35)',
  borderRadius: '10px',
  userSelect: 'none',
  touchAction: 'none',
  WebkitTapHighlightColor: 'transparent',
};

export function attachTouchControls(controls, camera, containerEl) {
  const root = makeEl('div', {
    position: 'absolute', left: '0', top: '0', right: '0', bottom: '0',
    pointerEvents: 'none', zIndex: '10',
  }, containerEl);
  containerEl.style.position = containerEl.style.position || 'relative';

  // ---- Joystick (pitch/roll) — abajo izquierda ----
  const stickBase = makeEl('div', {
    position: 'absolute', left: '24px', bottom: '24px',
    width: `${STICK_RADIUS * 2}px`, height: `${STICK_RADIUS * 2}px`,
    borderRadius: '50%', background: 'rgba(20,20,25,0.35)',
    border: '1px solid rgba(255,255,255,0.3)',
    pointerEvents: 'auto', touchAction: 'none',
  }, root);
  const stickKnob = makeEl('div', {
    position: 'absolute', left: '50%', top: '50%',
    width: '46px', height: '46px', marginLeft: '-23px', marginTop: '-23px',
    borderRadius: '50%', background: 'rgba(255,255,255,0.55)',
    border: '1px solid rgba(255,255,255,0.7)',
  }, stickBase);

  let stickPointerId = null;
  function stickReset() {
    controls.keyboard.pitch = 0;
    controls.keyboard.roll = 0;
    stickKnob.style.left = '50%';
    stickKnob.style.top = '50%';
  }
  function stickMove(clientX, clientY) {
    const rect = stickBase.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;
    let dx = clientX - cx, dy = clientY - cy;
    const dist = Math.hypot(dx, dy);
    if (dist > STICK_RADIUS) { dx = dx / dist * STICK_RADIUS; dy = dy / dist * STICK_RADIUS; }
    stickKnob.style.left = `${STICK_RADIUS + dx}px`;
    stickKnob.style.top = `${STICK_RADIUS + dy}px`;
    controls.keyboard.roll = clampAxis(dx / STICK_RADIUS);
    // arriba en pantalla = cabecear arriba = mismo signo que W (pitch +1)
    controls.keyboard.pitch = clampAxis(-dy / STICK_RADIUS);
  }
  function clampAxis(v) { return Math.max(-1, Math.min(1, v)); }

  stickBase.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    if (stickPointerId != null) return;
    stickPointerId = e.pointerId;
    stickBase.setPointerCapture(e.pointerId);
    stickMove(e.clientX, e.clientY);
  });
  stickBase.addEventListener('pointermove', (e) => {
    e.stopPropagation();
    if (e.pointerId !== stickPointerId) return;
    stickMove(e.clientX, e.clientY);
  });
  function stickEnd(e) {
    e.stopPropagation();
    if (e.pointerId !== stickPointerId) return;
    stickPointerId = null;
    stickReset();
  }
  stickBase.addEventListener('pointerup', stickEnd);
  stickBase.addEventListener('pointercancel', stickEnd);

  // ---- Throttle (vertical slider) — abajo derecha ----
  const THROTTLE_H = 130, THROTTLE_W = 40;
  const throttleTrack = makeEl('div', {
    position: 'absolute', right: '24px', bottom: '24px',
    width: `${THROTTLE_W}px`, height: `${THROTTLE_H}px`,
    borderRadius: '10px', background: 'rgba(20,20,25,0.35)',
    border: '1px solid rgba(255,255,255,0.3)',
    pointerEvents: 'auto', touchAction: 'none',
  }, root);
  const throttleFill = makeEl('div', {
    position: 'absolute', left: '3px', right: '3px', bottom: '3px',
    height: '0px', borderRadius: '8px', background: 'rgba(120,200,255,0.75)',
  }, throttleTrack);
  makeEl('div', {
    position: 'absolute', left: '0', right: '0', top: '-18px',
    textAlign: 'center', color: '#fff', fontFamily: 'sans-serif', fontSize: '11px',
    pointerEvents: 'none',
  }, throttleTrack).textContent = 'THR';

  let throttlePointerId = null;
  function throttleSetFromY(clientY) {
    const rect = throttleTrack.getBoundingClientRect();
    let ratio = 1 - (clientY - rect.top) / rect.height;
    ratio = Math.max(0, Math.min(1, ratio));
    controls.throttle = ratio;
    throttleFill.style.height = `${ratio * (THROTTLE_H - 6)}px`;
  }
  throttleTrack.addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    if (throttlePointerId != null) return;
    throttlePointerId = e.pointerId;
    throttleTrack.setPointerCapture(e.pointerId);
    throttleSetFromY(e.clientY);
  });
  throttleTrack.addEventListener('pointermove', (e) => {
    e.stopPropagation();
    if (e.pointerId !== throttlePointerId) return;
    throttleSetFromY(e.clientY);
  });
  function throttleEnd(e) {
    e.stopPropagation();
    if (e.pointerId !== throttlePointerId) return;
    throttlePointerId = null;
    // el throttle se queda donde lo dejaste (como una palanca real),
    // a diferencia del joystick que vuelve al centro.
  }
  throttleTrack.addEventListener('pointerup', throttleEnd);
  throttleTrack.addEventListener('pointercancel', throttleEnd);

  // ---- Botones auxiliares (yaw, freno, tren, flaps, camara) ----
  function holdButton(label, style, onDown, onUp) {
    const btn = makeEl('div', { ...baseButtonStyle, ...style, pointerEvents: 'auto' }, root);
    btn.textContent = label;
    let pid = null;
    btn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      pid = e.pointerId;
      btn.setPointerCapture(e.pointerId);
      btn.style.background = 'rgba(120,200,255,0.55)';
      onDown();
    });
    function release(e) {
      e.stopPropagation();
      if (e.pointerId !== pid) return;
      pid = null;
      btn.style.background = baseButtonStyle.background;
      onUp();
    }
    btn.addEventListener('pointerup', release);
    btn.addEventListener('pointercancel', release);
    return btn;
  }
  function tapButton(label, style, onTap) {
    const btn = makeEl('div', { ...baseButtonStyle, ...style, pointerEvents: 'auto' }, root);
    btn.textContent = label;
    btn.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      btn.setPointerCapture(e.pointerId);
      btn.style.background = 'rgba(120,200,255,0.55)';
    });
    btn.addEventListener('pointerup', (e) => {
      e.stopPropagation();
      btn.style.background = baseButtonStyle.background;
      onTap();
    });
    btn.addEventListener('pointercancel', (e) => {
      e.stopPropagation();
      btn.style.background = baseButtonStyle.background;
    });
    return btn;
  }

  // Yaw: dos botones chicos flanqueando el joystick.
  holdButton('◀ YAW', { left: '24px', bottom: `${24 + STICK_RADIUS * 2 + 10}px`, width: '60px', height: '38px' },
    () => { controls.keyboard.yaw = -1; }, () => { controls.keyboard.yaw = 0; });
  holdButton('YAW ▶', { left: '92px', bottom: `${24 + STICK_RADIUS * 2 + 10}px`, width: '60px', height: '38px' },
    () => { controls.keyboard.yaw = 1; }, () => { controls.keyboard.yaw = 0; });

  // Freno (mantener), tren y flaps (toggle), en una fila arriba a la derecha.
  holdButton('BRAKE', { right: '24px', bottom: `${24 + THROTTLE_H + 10}px`, width: '64px', height: '38px' },
    () => { controls.brakes = 1; }, () => { controls.brakes = 0; });
  tapButton('GEAR', { right: '96px', bottom: `${24 + THROTTLE_H + 10}px`, width: '64px', height: '38px' },
    () => controls.toggleGear());
  tapButton('FLAPS', { right: '168px', bottom: `${24 + THROTTLE_H + 10}px`, width: '64px', height: '38px' },
    () => controls.cycleFlaps());

  // Ciclo de camara ("C" en teclado) — arriba derecha, lejos de los demas
  // para no confundirlo con freno/tren en el fragor del aterrizaje.
  tapButton('CAM', { right: '24px', top: '16px', width: '56px', height: '38px' },
    () => { if (camera && camera.cycleCamera) camera.cycleCamera(); });

  return function detach() {
    root.remove();
  };
}

// Deteccion simple: coarse pointer / touch points disponibles. No es
// perfecta (algunas laptops con pantalla tactil "mienten"), pero es la
// senal estandar recomendada (matchMedia) en vez de sniffear user-agent.
export function isTouchDevice() {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  return coarse || navigator.maxTouchPoints > 0 || 'ontouchstart' in window;
}
