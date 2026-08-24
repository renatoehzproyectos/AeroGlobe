// ============================================================================
// PARTE 8.3 — DIA / NOCHE
//
// El tutorial deja esta seccion en pseudocodigo (comentarios tipo
// "// Mezcla paletas de 8 colores dia/noche segun a", sin la mezcla en
// si). Aca se completa con una implementacion real y se documentan las
// decisiones de diseno que el tutorial no fijaba con un numero:
//
//   - `a` = dot(sol, camara) normalizado, redondeado a 2 decimales
//     (parseFloat(...toPrecision(2))): igual que el original, para no
//     recalcular la mezcla de color en CADA frame por ruido de punto
//     flotante -- update() solo hace trabajo cuando `a` cambia de
//     "escalon" (paso de 0.01).
//   - sim.isNight = a < 0 (el sol esta bajo el horizonte visto desde la
//     camara). El tutorial menciona "blue channel of mixed sun color"
//     como condicion extra sin definirla; se interpreta como un chequeo
//     de sanidad (evitar isNight=true con colores todavia diurnos justo
//     en el cruce) y se implementa comparando el canal azul mezclado
//     contra NIGHT_BLUE_THRESHOLD.
//   - dayNightRamp(a) hace exactamente lo que dice el comentario del
//     tutorial: mezcla una paleta de 8 stops dia/noche segun `a`, en vez
//     de dejarlo sin implementar.
//   - cloudsBrightnessRamp reproduce el ramp textual del tutorial
//     ([0, 0, 0, 0.5, 1, 1]) como funcion de interpolacion real sobre
//     `a` en vez de dejarlo como comentario.
//
// deps inyectadas:
//   api      { viewer: Cesium.Viewer, setAtmosphereColorModifier(mod),
//              useNativeAtmosphere (ver PARTE 6.7) }
//   camera   { cam: Cesium camera real }
//   Cesium   namespace de Cesium
//   fx       { atmosphere, cloudManager }  (PARTE 6: fx.atmosphere.color,
//              fx.cloudManager para brillo bajo nubes)
//   sim      estado global (se le agrega sim.isNight, sim.timeRatio)
// ============================================================================

import { clamp } from '../core/constants.js';

// 8 stops de paleta dia/noche (RGB 0-1), de "sol alto" (a=1) a "noche
// cerrada" (a=-1), pasando por atardecer/anochecer alrededor de a=0. Los
// colores del extremo dia son un cielo azul suave (coherente con
// backgroundFogColor/atmosphere.color de PARTE 6); el extremo noche es
// casi negro con un remanente azulado (luz de luna/estrellas, nunca
// negro puro, para que el horizonte siga siendo legible).
const DAY_NIGHT_STOPS = [
  { a: 1.00, color: [0.70, 0.80, 0.90] },  // sol alto
  { a: 0.50, color: [0.65, 0.75, 0.88] },
  { a: 0.15, color: [0.75, 0.65, 0.55] },  // sol bajo, empieza el dorado
  { a: 0.00, color: [0.85, 0.45, 0.30] },  // horizonte: atardecer/amanecer
  { a: -0.10, color: [0.35, 0.25, 0.35] }, // crepusculo civil
  { a: -0.30, color: [0.10, 0.10, 0.20] }, // crepusculo nautico/astronomico
  { a: -0.60, color: [0.03, 0.03, 0.08] },
  { a: -1.00, color: [0.01, 0.01, 0.03] }, // noche cerrada
];

function lerpColor(c0, c1, t) {
  return [
    c0[0] + (c1[0] - c0[0]) * t,
    c0[1] + (c1[1] - c0[1]) * t,
    c0[2] + (c1[2] - c0[2]) * t,
  ];
}

// Interpola sobre DAY_NIGHT_STOPS (ordenados de a=1 a a=-1). Devuelve
// [r,g,b] 0-1.
function dayNightRamp(a) {
  a = clamp(a, -1, 1);
  for (let i = 0; i < DAY_NIGHT_STOPS.length - 1; i++) {
    const s0 = DAY_NIGHT_STOPS[i], s1 = DAY_NIGHT_STOPS[i + 1];
    if (a <= s0.a && a >= s1.a) {
      const t = (s0.a - a) / (s0.a - s1.a);
      return lerpColor(s0.color, s1.color, t);
    }
  }
  return a > 0 ? DAY_NIGHT_STOPS[0].color : DAY_NIGHT_STOPS[DAY_NIGHT_STOPS.length - 1].color;
}

// Ramp textual del tutorial: "cloudsBrightness ramp: [0, 0, 0, 0.5, 1, 1]"
// leido como 6 stops uniformemente espaciados en a=[-1..1]: de noche
// cerrada (brillo 0) a dia pleno (brillo 1), con la transicion
// concentrada en la mitad de la subida (stops 3/4 = 0/0.5) para que el
// brillo de las nubes reaccione rapido apenas asoma el sol, no de forma
// lineal pareja.
const CLOUDS_BRIGHTNESS_STOPS = [0, 0, 0, 0.5, 1, 1];

function cloudsBrightnessRamp(a) {
  a = clamp(a, -1, 1);
  const n = CLOUDS_BRIGHTNESS_STOPS.length - 1;
  const pos = ((a + 1) / 2) * n;             // a=-1 -> 0, a=1 -> n
  const i0 = clamp(Math.floor(pos), 0, n - 1);
  const i1 = i0 + 1;
  const t = pos - i0;
  return CLOUDS_BRIGHTNESS_STOPS[i0] + (CLOUDS_BRIGHTNESS_STOPS[i1] - CLOUDS_BRIGHTNESS_STOPS[i0]) * t;
}

const NIGHT_BLUE_THRESHOLD = 0.12; // canal azul mezclado por debajo de esto = "de noche" a ojo

export function createDayNightManager(deps) {
  const { api, camera, Cesium, fx, sim } = deps;
  const dayNightManager = {};

  dayNightManager.update = function () {
    const sun = Cesium.Cartesian3.normalize(
      api.viewer.scene.sun._boundingVolume.center, new Cesium.Cartesian3()
    );
    const cam = Cesium.Cartesian3.normalize(camera.cam.position, new Cesium.Cartesian3());
    const a = parseFloat(Cesium.Cartesian3.dot(cam, sun).toPrecision(2));

    // Sin cambio de escalon desde el ultimo frame: nada que recalcular.
    // (a===0 exacto SI se procesa, por eso el chequeo es `!a` solo
    // cuando ademas coincide con el ultimo valor -- ver mas abajo, se
    // usa fx.sunDotNormal == null la primera vez para forzar el primer
    // calculo aunque a sea 0).
    if (fx.sunDotNormal != null && a === fx.sunDotNormal) return;
    fx.sunDotNormal = a;

    const mixedColor = dayNightRamp(a);
    sim.isNight = a < 0 && mixedColor[2] < NIGHT_BLUE_THRESHOLD;

    // Ajusta brightness/saturation/gamma de la imagineria del globo: mas
    // oscuro y menos saturado de noche (sin apagarlo del todo, para que
    // el terreno siga siendo visible bajo luz de luna).
    if (api.viewer.scene.globe) {
      const nightFactor = clamp((0.3 - a) / 1.3, 0, 1); // 0 a pleno dia, 1 a noche cerrada
      const baseLayer = api.viewer.scene.globe.imageryLayers.get(0);
      if (baseLayer) {
        baseLayer.brightness = 1 - nightFactor * 0.6;
        baseLayer.saturation = 1 - nightFactor * 0.5;
        baseLayer.gamma = 1 - nightFactor * 0.3;
      }
    }

    // Cielo custom (PARTE 6/7): recolorea el fog de fondo con la paleta
    // dia/noche en vez de dejarlo fijo. Si estamos usando el cielo
    // nativo de Cesium (advanced=false), no hay atmosphere.color que
    // tocar.
    if (fx.atmosphere && fx.atmosphere.color) {
      fx.atmosphere.color.red = mixedColor[0];
      fx.atmosphere.color.green = mixedColor[1];
      fx.atmosphere.color.blue = mixedColor[2];
      if (api.setAtmosphereColorModifier) api.setAtmosphereColorModifier(fx.atmosphere.color);
    }

    // Skybox nativo de Cesium: apagado de dia (lo tapa el cielo custom o
    // la neblina atmosferica), encendido de noche (estrellas).
    if (api.viewer.scene.skyBox) {
      api.viewer.scene.skyBox.show = sim.isNight || !api.useNativeAtmosphere;
    }

    // Brillo de las nubes bajo la capa (PARTE 6.8, CloudManager): las
    // nubes no deberian verse "auto-iluminadas" de noche.
    if (fx.cloudManager && fx.cloudManager.setBrightness) {
      fx.cloudManager.setBrightness(cloudsBrightnessRamp(a));
    }
  };

  // weather.timeRatio = |localTime/12 - 1| -> 0 al mediodia, 1 a
  // medianoche. Se usa para fog, nieve, y para decidir si el cielo es
  // "de dia". localHour en [0,24).
  dayNightManager.timeRatio = function (localHour) {
    return Math.abs(localHour / 12 - 1);
  };

  return dayNightManager;
}
