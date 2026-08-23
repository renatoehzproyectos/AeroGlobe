// ============================================================================
// PARTE 1 — CONSTANTES FISICAS Y MATEMATICAS
// Todo el simulador depende de que GRAVITY, ISA y el radio terrestre sean
// consistentes entre fisica, shaders y conversiones LLA. No dupliques estos
// valores en otro lado: importa siempre de aqui.
// ============================================================================

export const GRAVITY = 9.81;                       // m/s^2
export const DEGREES_TO_RAD = Math.PI / 180;
export const RAD_TO_DEGREES = 180 / Math.PI;
export const KMH_TO_MS = 1 / 3.6;
export const METERS_TO_FEET = 3.2808399;
export const FEET_TO_METERS = 0.3048;
export const METERS_TO_NM = 0.000539957;
export const MS_TO_KNOTS = 1.94384449;
export const KNOTS_TO_MS = 0.514444444;
export const MS_TO_FEETMINUTE = 196.85;
export const LONGITUDE_TO_HOURS = 0.0666;          // 360 deg / 24 h = 15 deg/h -> 1/15

export const EPSILON = 1e-7;
export const ONE_MINUS_EPSILON = 1 - EPSILON;
export const PI = Math.PI;
export const HALF_PI = PI / 2;
export const TWO_PI = 2 * PI;

// Elipsoide (radio meridional WGS84, suficiente para ENU local)
export const MERIDIONAL_RADIUS = 6378137;          // m
export const EARTH_CIRCUMFERENCE = 2 * MERIDIONAL_RADIUS * Math.PI;
export const METERS_TO_LOCAL_LAT = 1 / (EARTH_CIRCUMFERENCE / 360);

// Atmosfera ISA
export const KELVIN_OFFSET = 273.15;
export const TEMPERATURE_LAPSE_RATE = 0.0065;      // K/m  (6.5 K/km)
export const AIR_DENSITY_SL = 1.22;                // kg/m^3  (aprox ISA 1.225)
export const AIR_PRESSURE_SL = 101325;             // Pa
export const AIR_TEMP_SL = 15;                     // C
export const IDEAL_GAS_CONSTANT = 8.31447;         // J/(mol K)
export const MOLAR_MASS_DRY_AIR = 0.0289644;       // kg/mol
export const GAS_CONSTANT = IDEAL_GAS_CONSTANT / MOLAR_MASS_DRY_AIR; // 287.05
export const GM_RL = GRAVITY * MOLAR_MASS_DRY_AIR
                   / (IDEAL_GAS_CONSTANT * TEMPERATURE_LAPSE_RATE); // ~5.2561

// Aerodinamica
export const DRAG_CONSTANT = 0.07;
export const MIN_DRAG_COEF = 0.02;
export const PLANFORM_EFFICIENCY_FACTOR = 0.7;     // e de Oswald
export const DEFAULT_AIRFOIL_ASPECT_RATIO = 7;
export const SPEED_OF_SOUND = 350;                 // m/s  (se recalcula con T)

// Agua
export const WATER_DENSITY = 997;                  // kg/m^3

// Suavizado
export const SMOOTHING_FACTOR = 0.2;
export const SMOOTH_BUFFER = {};

export const AXIS_TO_INDEX = { X: 0, Y: 1, Z: 2 };
export const AXIS_TO_VECTOR = { X: [1, 0, 0], Y: [0, 1, 0], Z: [0, 0, 1] };

// ----------------------------------------------------------------------------
// Notas que importan (del tutorial):
//
// GM_RL es el exponente de la formula barometrica ISA:
//     P(h) = P0 * (1 - L*h / T0) ^ (g M / (R L))
// El valor numerico es ~5.2561. Si lo redondeas a 5.25, a FL350 la densidad
// ya se desvia lo bastante para que un jet no alcance su techo real.
//
// MERIDIONAL_RADIUS = 6378137 es el semi-eje mayor WGS84. Cesium usa el
// elipsoide completo (a, b). Para fisica local (decenas de km) el esferoide
// es suficiente. Para los SHADERS de nubes se usa un radio "real" medido en
// el punto de camara, porque el elipsoide no es esfera y si no las nubes
// flotan o se hunden segun la latitud (ver PARTE 6).
//
// SPEED_OF_SOUND = 350 es un fallback. El Mach real se calcula:
//     a = 331.3 + 0.606 * T_celsius
//     Mach = tas / a
// ----------------------------------------------------------------------------

// ----------------------------------------------------------------------------
// 1.1  Utilidades escalares
// ----------------------------------------------------------------------------

export function clamp(x, lo, hi) {
  return x > hi ? hi : x < lo ? lo : x;
}

export function fixAngle360(deg) {
  deg = deg % 360;
  return deg >= 0 ? deg : deg + 360;
}

export function fixAngle(deg) {
  // [-180, 180)
  return fixAngle360(deg + 180) - 180;
}

export function fixAngles(v) {
  return [fixAngle(v[0]), fixAngle(v[1]), fixAngle(v[2])];
}

export function snapToUnit(x) {
  if (x < EPSILON) return 0;
  if (x > ONE_MINUS_EPSILON) return 1;
  return x;
}

// Suavizado exponencial con estado por nombre.
// St = a * Xprev + (1-a) * Sprev   (filtro IIR de 1 polo)
//
// Se usa EN TODAS PARTES: slip ball, jerk, camara elastica, rachas de
// viento, calidad adaptativa. El truco del `name` es guardar el estado en
// un diccionario global para no tener que crear objetos por llamada.
export function exponentialSmoothing(name, x, alpha, x0, dt) {
  if (!SMOOTH_BUFFER[name]) {
    SMOOTH_BUFFER[name] = {
      Stm1: x0 || 0,
      Xtm1: x0 || 0,
      smoothingFactor: alpha != null ? alpha : SMOOTHING_FACTOR,
    };
    SMOOTH_BUFFER[name].invSmoothingFactor =
      1 - SMOOTH_BUFFER[name].smoothingFactor;
  }
  const b = SMOOTH_BUFFER[name];
  if (dt != null && alpha != null) {
    b.smoothingFactor = alpha * dt;
    b.invSmoothingFactor = 1 - b.smoothingFactor;
  }
  const s = b.Xtm1 * b.smoothingFactor + b.invSmoothingFactor * b.Stm1;
  b.Stm1 = s;
  b.Xtm1 = x;
  return s;
}
