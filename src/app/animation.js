// ============================================================================
// PARTE 10 — ANIMATION (values + filter)
//
// El tutorial usa `animation.values` y `animation.filter(a)` desde PARTE
// 5.3 (engines.js) y PARTE 9 (aircraft-tree.js/applyPartAnimation) como
// dependencias YA EXISTENTES, sin darles nunca su propia seccion de
// codigo. Este archivo las completa:
//
//   animation.values  — bag plano de numeros (roll, pitch, yaw, trim,
//     throttle, ktas, altitude, heading, ...). Lo escribe
//     flight.setAnimationValues() (PARTE 5.9, ya entregado) una vez por
//     subpaso; lo leen instrumentos/HUD (fuera de alcance de este
//     tutorial, es UI) y las animaciones de partes.
//   animation.filter(a) — dado un descriptor de animacion del JSON de la
//     aeronave (ej. `{type:"rotate", axis:"X", value:"roll", ratio:-15}`
//     o `{type:"throttle"}`), devuelve el NUMERO crudo de
//     animation.values[a.value] (0 si no existe todavia, para que el
//     primer frame antes de que setAnimationValues corra no rompa nada
//     con NaN * ratio). Se deja como punto de extension: si mas adelante
//     se necesita suavizado por-animacion (ej. servos de flap con
//     inercia en vez de salto instantaneo), se agrega ACA sin tocar
//     PARTE 5/9, que solo conocen la interfaz `filter(a)`.
// ============================================================================

export function createAnimation() {
  const animation = {
    values: {},
  };

  animation.filter = function (a) {
    const v = animation.values[a.value];
    return v == null ? 0 : v;
  };

  return animation;
}
