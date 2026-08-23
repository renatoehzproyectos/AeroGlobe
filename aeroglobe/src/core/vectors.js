// ============================================================================
// PARTE 2 — BIBLIOTECA VECTORIAL V2 / V3 / M33
//
// No uses gl-matrix ni THREE.Vector3 para la fisica. Arrays planos, sin
// allocaciones en el hot path si puedes evitarlo, operaciones que devuelven
// arrays nuevos (mas simple; el GC de JS moderno lo aguanta a 60 Hz si no
// te pasas). Esta es la biblioteca minima completa.
// ============================================================================

import {
  DEGREES_TO_RAD,
  RAD_TO_DEGREES,
  HALF_PI,
  clamp,
  exponentialSmoothing,
} from './constants.js';

export const V2 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1]],
  scale: (a, s) => [a[0] * s, a[1] * s],
  length: (a) => Math.sqrt(a[0] * a[0] + a[1] * a[1]),
  // Aproximacion rapida |x|+|y|/2 (para culling, no para fisica)
  fastLengthApprox: (a) => {
    const x = Math.abs(a[0]), y = Math.abs(a[1]);
    return Math.max(x, y) + Math.min(x, y) / 2;
  },
};

export const V3 = {
  isValid: (a) => {
    if (!a) return false;
    for (let i = 0; i <= 2; i++) if (a[i] == null || Number.isNaN(a[i])) return false;
    return true;
  },
  dup: (a) => [a[0], a[1], a[2]],
  abs: (a) => [Math.abs(a[0]), Math.abs(a[1]), Math.abs(a[2])],
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mult: (a, b) => [a[0] * b[0], a[1] * b[1], a[2] * b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ],
  length: (a) => Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]),
  normalize: (a) => {
    const L = V3.length(a);
    return L <= 0 ? [NaN, NaN, NaN] : V3.scale(a, 1 / L);
  },
  nearlyEqual: (a, b, eps = 1e-6) =>
    Math.abs(a[0] - b[0]) <= eps &&
    Math.abs(a[1] - b[1]) <= eps &&
    Math.abs(a[2] - b[2]) <= eps,
  clamp: (a, lo, hi) => [clamp(a[0], lo, hi), clamp(a[1], lo, hi), clamp(a[2], lo, hi)],
  toRadians: (a) => [a[0] * DEGREES_TO_RAD, a[1] * DEGREES_TO_RAD, a[2] * DEGREES_TO_RAD],
  toDegrees: (a) => [a[0] * RAD_TO_DEGREES, a[1] * RAD_TO_DEGREES, a[2] * RAD_TO_DEGREES],

  // Rotacion de Rodrigues: rota v alrededor del eje unitario k un angulo a (rad)
  rotate: (v, k, a) => {
    const parallel = V3.scale(k, V3.dot(v, k));
    const rest = V3.sub(v, parallel);
    const w = V3.cross(k, rest);
    return V3.add(parallel, V3.add(V3.scale(rest, Math.cos(a)), V3.scale(w, Math.sin(a))));
  },

  exponentialSmoothing: (name, x, alpha, x0, dt) => [
    exponentialSmoothing(name + '0', x[0], alpha, x0[0], dt),
    exponentialSmoothing(name + '1', x[1], alpha, x0[1], dt),
    exponentialSmoothing(name + '2', x[2], alpha, x0[2], dt),
  ],
};

// ----------------------------------------------------------------------------
// 2.1  Matrices 3x3 — el marco del avion
//
// Una M33 se interpreta como tres ejes mundo del objeto:
//   m[0] = eje X (derecha)
//   m[1] = eje Y (nariz / forward)
//   m[2] = eje Z (arriba)
//
// Esto coincide con un avion Z-up. Si importas glTF (Y-up) conviertes al
// cargar.
// ----------------------------------------------------------------------------

export const M33 = {
  identity: () => [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  dup: (m) => [V3.dup(m[0]), V3.dup(m[1]), V3.dup(m[2])],
  transpose: (m) => [
    [m[0][0], m[1][0], m[2][0]],
    [m[0][1], m[1][1], m[2][1]],
    [m[0][2], m[1][2], m[2][2]],
  ],

  // M * v  (v como columna, M en filas)
  multiplyV: (m, v) => [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ],

  // Transforma un vector local -> mundo usando las COLUMNAS (ejes)
  // world = x*axisX + y*axisY + z*axisZ
  transform: (m, v) => [
    m[0][0] * v[0] + m[1][0] * v[1] + m[2][0] * v[2],
    m[0][1] * v[0] + m[1][1] * v[1] + m[2][1] * v[2],
    m[0][2] * v[0] + m[1][2] * v[1] + m[2][2] * v[2],
  ],

  transformByTranspose: (m, v) => [
    m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
    m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
    m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
  ],

  multiply: (a, b) => {
    const r = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let i = 0; i < 3; i++)
      for (let j = 0; j < 3; j++)
        r[i][j] = a[0][j] * b[i][0] + a[1][j] * b[i][1] + a[2][j] * b[i][2];
    // OJO: la formula exacta depende de si guardas filas como ejes.
    // Usa multiplyExpanded (abajo), que es la version probada del motor.
    return r;
  },

  // Version expandida, identica a la del motor, sin bucles:
  multiplyExpanded: (e, t) => {
    const a = e[0][0], o = e[0][1], n = e[0][2];
    const r = e[1][0], s = e[1][1], c = e[1][2];
    const d = e[2][0], u = e[2][1], p = e[2][2];
    const h = t[0][0], m = t[0][1], f = t[0][2];
    const g = t[1][0], y = t[1][1], v = t[1][2];
    const _ = t[2][0], b = t[2][1], x = t[2][2];
    return [
      [a * h + r * m + d * f, o * h + s * m + u * f, n * h + c * m + p * f],
      [a * g + r * y + d * v, o * g + s * y + u * v, n * g + c * y + p * v],
      [a * _ + r * b + d * x, o * _ + s * b + u * x, n * _ + c * b + p * x],
    ];
  },

  rotationX: (m, a) => {
    const c = Math.cos(a), s = Math.sin(a);
    return M33.multiplyExpanded(m, [[1, 0, 0], [0, c, -s], [0, s, c]]);
  },
  rotationY: (m, a) => {
    const c = Math.cos(a), s = Math.sin(a);
    return M33.multiplyExpanded(m, [[c, 0, s], [0, 1, 0], [-s, 0, c]]);
  },
  rotationZ: (m, a) => {
    const c = Math.cos(a), s = Math.sin(a);
    return M33.multiplyExpanded(m, [[c, -s, 0], [s, c, 0], [0, 0, 1]]);
  },

  setFromEuler: (e) => {
    // e = [x, y, z] en radianes
    const cx = Math.cos(e[0]), sx = Math.sin(e[0]);
    const cy = Math.cos(e[1]), sy = Math.sin(e[1]);
    const cz = Math.cos(e[2]), sz = Math.sin(e[2]);
    return [
      [cz * cy + sz * sx * sy, -sz * cy + cz * sx * sy, cx * sy],
      [sz * cx,                 cz * cx,                -sx    ],
      [-(cz * sy) + sz * sx * cy, -(-sz * sy) + cz * sx * cy, cx * cy],
    ];
  },

  rotationXYZ: (m, e) => M33.multiplyExpanded(m, M33.setFromEuler(e)),

  // Extrae heading, tilt, roll en GRADOS. Cuidado con el gimbal lock.
  getOrientation: (m) => {
    let h, t, r;
    if (m[1][2] > 0.998) {
      h = Math.atan2(-m[2][0], -m[2][1]);
      t = -HALF_PI;
      r = 0;
    } else if (m[1][2] < -0.998) {
      h = Math.atan2(m[2][0], m[2][1]);
      t = HALF_PI;
      r = 0;
    } else {
      h = Math.atan2(m[1][0], m[1][1]);
      t = Math.asin(-m[1][2]);
      r = Math.atan2(m[0][2], m[2][2]);
    }
    return [h * RAD_TO_DEGREES, t * RAD_TO_DEGREES, r * RAD_TO_DEGREES];
  },

  makeOrthonormalFrame: (forward, upHint) => {
    const y = V3.normalize(forward);
    const x = V3.normalize(V3.cross(upHint, y));
    const z = V3.cross(x, y);
    return [x, y, z];
  },

  scaled: (m, s) => [
    [m[0][0] * s[0], m[0][1] * s[1], m[0][2] * s[2]],
    [m[1][0] * s[0], m[1][1] * s[1], m[1][2] * s[2]],
    [m[2][0] * s[0], m[2][1] * s[1], m[2][2] * s[2]],
  ],
};

// TRAMPA: getOrientation usa m[1][2] (componente Z del eje nariz) para el
// tilt. Si tu marco es Y-up esto esta mal y el avion "se tuerce" al picar.
// Convierte glTF a Z-up al cargar, o cambia los indices.

// ----------------------------------------------------------------------------
// 2.2  Interseccion rayo-triangulo (para ganchos, cables, debugging)
// ----------------------------------------------------------------------------

const SMALL_NUM = 1e-8;

export function intersectRayTriangle(ray, tri) {
  // ray = [origin, end], tri = {0:p0, 1:p1, 2:p2, u, v, n}
  const s = V3.sub(ray[1], ray[0]);
  const w0 = V3.sub(ray[0], tri[0]);
  const a = -V3.dot(tri.n, w0);
  const b = V3.dot(tri.n, s);
  if (Math.abs(b) < SMALL_NUM) return null;
  const r = a / b;
  if (r < 0 || r > 1) return null;
  const point = V3.add(ray[0], V3.scale(s, r));
  const w = V3.sub(point, tri[0]);
  const uu = V3.dot(tri.u, tri.u);
  const uv = V3.dot(tri.u, tri.v);
  const vv = V3.dot(tri.v, tri.v);
  const wu = V3.dot(w, tri.u);
  const wv = V3.dot(w, tri.v);
  const D = uv * uv - uu * vv;
  const sU = (uv * wv - vv * wu) / D;
  const sV = (uv * wu - uu * wv) / D;
  if (sU < 0 || sU > 1 || sV < 0 || sU + sV > 1) return null;
  return { point };
}
