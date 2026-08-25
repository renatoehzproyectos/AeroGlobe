// ============================================================================
// HUD DE DIAGNOSTICO — overlay de texto en pantalla con el estado interno
// del avion cada frame (throttle, engine.on, rpm, empuje, velocidad,
// contacto con el suelo). No es parte del tutorial: se agrega para poder
// diagnosticar "el avion no se mueve" en movil, donde no hay devtools a
// mano. Se activa solo si se llama attachDebugHud() explicitamente desde
// bootstrap.js -- no cuesta nada si no se usa.
// ============================================================================

export function attachDebugHud(app, containerEl) {
  const el = document.createElement('div');
  Object.assign(el.style, {
    position: 'absolute', left: '8px', top: '16px', zIndex: '20',
    background: 'rgba(0,0,0,0.6)', color: '#0f0', fontFamily: 'monospace',
    fontSize: '11px', lineHeight: '1.4', padding: '6px 8px', borderRadius: '6px',
    whiteSpace: 'pre', pointerEvents: 'none',
  });
  containerEl.appendChild(el);

  const timer = setInterval(() => {
    const ac = app.aircraft && app.aircraft.instance;
    if (!ac) { el.textContent = 'no aircraft.instance todavia'; return; }
    const c = app.controls;
    el.textContent =
      `throttle: ${c.throttle.toFixed(2)}  brakes: ${c.brakes.toFixed(2)}\n` +
      `engine.on: ${ac.engine.on}  rpm: ${Math.round(ac.engine.rpm)}\n` +
      `totalThrust: ${Math.round(ac.totalThrust || 0)} N\n` +
      `groundSpeed: ${(ac.groundSpeed || 0).toFixed(2)} m/s\n` +
      `velocity xyz: ${(ac.velocity || [0, 0, 0]).map(v => v.toFixed(2)).join(', ')}\n` +
      `groundContact: ${ac.groundContact}\n` +
      `angVel: ${(ac.rigidBody.v_angularVelocity || [0, 0, 0]).map(v => v.toFixed(3)).join(', ')}\n` +
      `lla: ${ac.llaLocation.map((v, i) => i < 2 ? v.toFixed(6) : v.toFixed(2)).join(', ')}`;
  }, 200);

  return function detach() {
    clearInterval(timer);
    el.remove();
  };
}
