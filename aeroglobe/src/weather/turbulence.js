// ============================================================================
// PARTE 8.2 — TURBULENCIA Y TERMICAS (PERLIN)
//
// Un unico generador de ruido Perlin 2D (sim.perlin) alimenta tanto la
// turbulencia (ruido vertical de alta frecuencia, escala fija) como las
// termicas (ruido de baja frecuencia elevado al cubo -> columnas
// angostas y aisladas, no una onda suave).
//
// attachPerlin(sim) muta `sim` (agrega sim.perlin) porque el ruido debe
// ser el MISMO objeto/estado para toda la sesion de vuelo (la grilla de
// gradientes se genera una sola vez al arrancar); si se regenerara cada
// vez que se llama getLocalTurbulence/getLocalThermal, el terreno de
// turbulencia "temblaria" frame a frame en vez de ser un campo estable
// que el avion atraviesa.
// ============================================================================

import { TWO_PI, clamp } from '../core/constants.js';
import { V3 } from '../core/vectors.js';

// --------------------------------------------------------------------------
// 8.2  Ruido de Perlin 2D clasico (gradientes aleatorios en una grilla de
// sim.perlin.size x sim.perlin.size, interpolacion bilineal de productos
// punto). normalizationRatio = 1/sqrt(0.5) reescala la salida (que en
// Perlin 2D cae naturalmente en un rango algo menor a [-1,1]) para
// aprovechar el rango completo.
// --------------------------------------------------------------------------
export function attachPerlin(sim, size) {
  const perlin = {
    size: size || 100,
    gradient: [],
    normalizationRatio: 1 / Math.sqrt(0.5),
    lerp: (a, b, t) => (1 - t) * a + t * b,
    dotGridGradient(ix, iy, x, y) {
      const dx = x - ix, dy = y - iy;
      return dx * this.gradient[iy][ix][0] + dy * this.gradient[iy][ix][1];
    },
    // scale comprime/expande el espacio de entrada (grados de lat/lon, o
    // metros, segun quien llame) al tamano de la grilla; % this.size hace
    // que el ruido sea PERIODICO (se repite cada `size` unidades de
    // ruido), asi nunca se sale de la grilla generada.
    get(x, y, scale) {
      try {
        x = Math.abs(x * scale) % this.size;
        y = Math.abs(y * scale) % this.size;
        const x0 = parseInt(x), x1 = x0 + 1;
        const y0 = parseInt(y), y1 = y0 + 1;
        const sx = x - x0, sy = y - y0;
        const n0 = this.dotGridGradient(x0, y0, x, y);
        const n1 = this.dotGridGradient(x1, y0, x, y);
        const ix0 = this.lerp(n0, n1, sx);
        const n2 = this.dotGridGradient(x0, y1, x, y);
        const n3 = this.dotGridGradient(x1, y1, x, y);
        const ix1 = this.lerp(n2, n3, sx);
        return this.normalizationRatio * this.lerp(ix0, ix1, sy);
      } catch (e) {
        return 0; // fuera de rango / grilla no lista: ruido neutro, no NaN
      }
    },
  };
  for (let i = 0; i <= perlin.size; i++) {
    perlin.gradient[i] = [];
    for (let j = 0; j <= perlin.size; j++) {
      const th = Math.random() * TWO_PI;
      perlin.gradient[i][j] = [Math.cos(th), Math.sin(th)];
    }
  }
  sim.perlin = perlin;
  return perlin;
}

// --------------------------------------------------------------------------
// weather.getLocalTurbulence / weather.getLocalThermal — PARTE 5.7 ya los
// consume como inputs inyectados dentro de applyAirfoils() (ver
// src/aircraft/airfoils.js). Aca se agrega el generador real.
//
// attachTurbulenceAndThermals(weather, sim) requiere que attachPerlin(sim)
// ya se haya llamado (sim.perlin debe existir).
// --------------------------------------------------------------------------
export function attachTurbulenceAndThermals(weather, sim) {
  // Escala espacial del ruido de turbulencia. El tutorial no fija un
  // numero (deja `weather.atmosphericDisturbanceScale` como config
  // externa); 0.02 es un valor razonable para que la turbulencia varie
  // notoriamente en unos pocos km sin parecer ruido blanco frame a frame
  // (recordar: sim.perlin.get() muestrea en grados de lat/lon, MUY chico
  // en metros, asi que el multiplicador tiene que ser relativamente
  // grande comparado con una escala en metros).
  if (weather.atmosphericDisturbanceScale == null) {
    weather.atmosphericDisturbanceScale = 2000;
  }

  // Turbulencia: componente vertical unicamente (sacude el avion en Z,
  // que es lo que se siente como "baches" de aire). *4 amplifica el
  // rango [-1,1] del ruido normalizado a algo del orden de m/s antes de
  // escalarlo por weather.definition.turbulences (0-1, el dial del
  // usuario/METAR).
  weather.getLocalTurbulence = function (lla) {
    return [0, 0, sim.perlin.get(lla[0], lla[1], weather.atmosphericDisturbanceScale)
                   * weather.definition.turbulences * 4];
  };

  // Config de termicas: minradius/maxradius/invertionRange quedan como
  // parametros reservados para un futuro modelo espacial de columnas
  // discretas (PARTE 9/10, cuando haya arbol de objetos y se puedan
  // instanciar termicas como entidades con posicion y radio propios); el
  // modelo de PARTE 8 es un campo continuo de ruido, no columnas
  // discretas, asi que por ahora solo minspeed/maxspeed entran en la
  // formula de abajo.
  weather.thermals = {
    currentVector: [0, 0, 0],
    minradius: 200,
    maxradius: 1000,
    minspeed: 0,
    maxspeed: 7,
    invertionRange: 500,
  };

  // Termica local en `lla`. Se "inclinan" con el viento: el punto de
  // muestreo del ruido se desplaza en sentido contrario al viento,
  // proporcional a la altitud (0.1 * lla[2]) -- una termica que nace al
  // nivel del suelo y sube 1000 m con 10 kt de viento cruzado termina
  // desplazada varios cientos de metros respecto a su base, como en la
  // realidad.
  //
  // El cubo de |ruido| (Math.pow(..., 3)) es lo que convierte una onda
  // suave en CHIMENEAS: la mayor parte del campo queda cerca de cero y
  // solo picos estrechos del ruido producen ascendencia fuerte, en vez
  // de una ondulacion pareja de aire subiendo en todos lados.
  //
  // fade apaga la termica al acercarse a cloudBase (inversion termica:
  // el aire deja de ascender bajo la base de las nubes convectivas).
  weather.getLocalThermal = function (lla) {
    if (weather.definition.thermals === 0) return [0, 0, 0];
    const ceilingAgl = weather.definition.cloudBase - sim.groundElevation;
    const t = clamp(lla[2] / ceilingAgl, 0, 1);
    const fade = clamp((1 - t) * 5, 0, 1);
    const windLla = weather.currentWindVectorLla || [0, 0, 0];
    const shifted = V3.sub(lla, V3.scale(windLla, 0.1 * lla[2]));
    const n = sim.perlin.get(shifted[0], shifted[1], 200);
    const o = 1 + weather.definition.thermals;
    let w = clamp(
      Math.pow(Math.abs(n) * o, 3) * Math.sign(n)
        * weather.thermals.maxspeed * weather.definition.thermals,
      weather.thermals.minspeed, weather.thermals.maxspeed
    ) * fade;
    if (isNaN(w)) w = 0;
    return [0, 0, w];
  };
}
