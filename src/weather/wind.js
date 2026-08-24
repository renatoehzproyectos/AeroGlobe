// ============================================================================
// PARTE 8.1 — VIENTO EN CAPAS
//
// createWindSystem(weather, deps) agrega a `weather`: la clase Wind,
// weather.windLayers, weather.initWind(fromDeg, speedMs) y
// weather.updateWind(lla) (elige la capa activa y llama computeAndSet
// cada frame — "cada frame se elige la capa cuya floor <= altitud").
//
// deps inyectadas (nada de globals):
//   api        { getGroundAltitude(lla, ctx) }             (PARTE 4.3)
//   sim        { groundElevation }                          (PARTE 4)
//   camera     { cam: { position } }                         (Cesium camera real)
//   Cesium     namespace de Cesium (HeadingPitchRoll, Transforms, Matrix4,
//              Cartesian3)
//   animation  { values: { altitudeMeters } }                (PARTE 5.9)
//   aircraft   { instance: { llaLocation } }                 (PARTE 5/9, opcional:
//              solo se usa como fallback si computeTerrainLift() se llama
//              sin `lla` explicito)
//
// DESVIACION DEL TUTORIAL (documentada): computeTerrainLift() del tutorial
// llama `api.getGroundAltitude(upwind, Wind)`, pasando la CLASE Wind como
// segundo argumento. getGroundAltitude(lla, ctx) espera un ctx de ESTADO
// POR PUNTO DE MUESTREO persistente entre frames (lastGroundAltitude,
// groundContact, wrongAltitudeTries — ver ground-sampling.js PARTE 4.3),
// no una funcion constructora; pasar la clase ahi no le da memoria al
// filtro anti-spike (siempre distinto "objeto", nada persiste) y ademas
// pisaria propiedades de la clase Wind con estado de muestreo si por
// error compartieran named-cache en otro lado. Se interpreta como un
// artefacto de copiar/pegar en el tutorial y se reemplaza por un ctx real:
// cada instancia de Wind guarda su propio `this._terrainLiftCtx = {}`
// (una capa de viento tiene su propio "historial" de sondeo de terreno).
// ============================================================================

import { DEGREES_TO_RAD, MS_TO_KNOTS, clamp, fixAngle, exponentialSmoothing } from '../core/constants.js';
import { V3 } from '../core/vectors.js';
import { xyz2lla_fast } from '../core/coordinates.js';

export function createWindSystem(weather, deps) {
  const { api, sim, camera, Cesium, animation, aircraft } = deps;

  // --------------------------------------------------------------------
  // Wind: una capa de viento entre [floor, ceiling] metros de altitud.
  // directionDeg es la direccion HACIA donde sopla (TO), ya convertida
  // desde el "FROM" meteorologico por initWind (ver mas abajo).
  // --------------------------------------------------------------------
  function Wind(directionDeg, speedMs, floor, ceiling) {
    this.mainDirection = directionDeg;
    this.speedMs = speedMs;
    this.speedKnots = speedMs * MS_TO_KNOTS;
    const rad = directionDeg * DEGREES_TO_RAD;
    this.vector = [Math.sin(rad), Math.cos(rad), 0];      // ENU: x=este, y=norte
    this.vectorMs = V3.scale(this.vector, speedMs);
    this.vectorCross = V3.cross(this.vector, [0, 0, 1]);  // eje para rotar (lift orografico)
    this.floor = floor;
    this.ceiling = ceiling;
    this.direction = directionDeg;
    this.speed = speedMs;
    this._terrainLiftCtx = {};                            // ver nota de desviacion arriba

    // Mismo vector en ECEF, para que los shaders de nubes (windVector,
    // PARTE 6) adviertan las nubes en la misma direccion que la fisica.
    const hpr = new Cesium.HeadingPitchRoll(directionDeg * DEGREES_TO_RAD, 0, 0);
    const m = Cesium.Transforms.headingPitchRollToFixedFrame(camera.cam.position, hpr);
    this.vectorWC = Cesium.Matrix4.multiplyByPointAsVector(
      m, new Cesium.Cartesian3(0, -speedMs, 0), new Cesium.Cartesian3()
    );
  }

  // Rachas: se atenuan con la altura relativa a la base de nubes (encima
  // de cloudBase, altFactor->0, no hay racha "de superficie"). Suavizado
  // exponencial para que la racha no salte de golpe entre frames.
  Wind.prototype.randomize = function () {
    const altitudeMeters = (animation && animation.values && animation.values.altitudeMeters) || 1;
    const altFactor = clamp(weather.definition.cloudBase / altitudeMeters, 0, 1);
    const gust = weather.definition.windGustMS * (Math.random() - 0.5) * altFactor;
    this.speed = this.speedMs + exponentialSmoothing('windGust', gust, 0.1);
  };

  // Lift orografico: samplea el suelo 100 m a BARLOVENTO. Si hay una
  // loma, el viento se inclina hacia arriba proporcionalmente a la
  // pendiente, atenuado con la altura sobre el suelo (agl). Esto es lo
  // que permite el vuelo de ladera: un acantilado de 200 m con 15 kt de
  // viento de cara produce un vector con componente Z positiva cerca del
  // suelo.
  Wind.prototype.computeTerrainLift = function (lla) {
    const LOOK = 100, MIN_H = 10, MAX_H = 500, GAIN = 5;
    lla = lla || (aircraft && aircraft.instance && aircraft.instance.llaLocation);
    const upwind = V3.sub(lla, xyz2lla_fast(V3.scale(this.vector, LOOK), lla));
    const groundHere = sim.groundElevation;
    const groundUpwind = api.getGroundAltitude(upwind, this._terrainLiftCtx);
    const agl = lla[2] - groundHere;
    const slopeH = groundHere - groundUpwind;             // positivo = loma a barlovento
    const influenceH = clamp(slopeH * GAIN, MIN_H, MAX_H);
    let angle = Math.atan(slopeH / LOOK);
    angle *= clamp(influenceH - agl, 0, influenceH) / influenceH;
    return V3.rotate(this.vector, this.vectorCross, angle);
  };

  Wind.prototype.computeAndSet = function (lla) {
    this.randomize();
    let dir = [0, 0, 0];
    if (this.speed) dir = this.computeTerrainLift(lla);
    weather.currentWindVector = V3.scale(dir, this.speed);
    weather.currentWindVectorLla = xyz2lla_fast(weather.currentWindVector, lla || [0, 0, 0]);
    weather.currentWindVectorWC = this.vectorWC;
    weather.currentWindDirection = this.direction;
    weather.currentWindSpeedMs = this.speed;
    weather.currentWindSpeed = this.speed * MS_TO_KNOTS;
  };

  // initWind: arma weather.windLayers a partir de un unico viento de
  // superficie FROM/speedMs. La meteorologia reporta el viento "FROM"
  // (de donde viene); el vector de deriva usado por la fisica es
  // FROM+180 (hacia donde EMPUJA). Las capas superiores son variaciones
  // aleatorias de direccion/velocidad respecto a la capa 0 (cizalladura
  // realista sin modelar un sondeo real).
  weather.initWind = function (fromDeg, speedMs) {
    weather.windLayers = [];
    const toDeg = fixAngle(fromDeg + 180);
    let floor = 0;
    let ceil = weather.definition.windLayerHeight + Math.random() * weather.definition.windLayerHeight;
    weather.windLayers.push(new Wind(toDeg, speedMs, floor, ceil));
    if (speedMs) {
      weather.windLayers[0].computeAndSet();
      for (let i = 1; i < weather.definition.windLayerNb; i++) {
        floor = ceil;
        ceil = floor + weather.definition.windLayerHeight + Math.random() * weather.definition.windLayerHeight;
        const spd = speedMs + (10 * Math.random() - 5);
        const dir = fixAngle(toDeg + 360 * Math.random());
        weather.windLayers.push(new Wind(dir, Math.max(spd, 0), floor, ceil));
      }
    }
  };

  // updateWind: llamar una vez por frame con la LLA del avion. Elige la
  // capa mas alta cuyo floor <= altitud (la ultima que "empieza" antes
  // de la altitud actual) y recalcula su vector con computeAndSet. Si
  // todavia no se llamo initWind(), no hace nada (sin viento configurado).
  weather.updateWind = function (lla) {
    if (!weather.windLayers || !weather.windLayers.length) return;
    const alt = lla[2];
    let active = weather.windLayers[0];
    for (let i = 0; i < weather.windLayers.length; i++) {
      if (weather.windLayers[i].floor <= alt) active = weather.windLayers[i];
      else break;
    }
    active.computeAndSet(lla);
  };

  return { Wind };
}
