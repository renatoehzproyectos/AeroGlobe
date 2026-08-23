// ============================================================================
// PARTE 6.7 — CABLEADO CESIUM PostProcessStage
//
// fx.atmosphere.create() arma (hasta) dos PostProcessStage:
//   1. cloudsPostProcessStage  (resolucion reducida, solo si volumetric)
//      -> blurStage encima, compuestos en un PostProcessStageComposite
//         "volumetricClouds" cuya textura de salida lee composite.glsl
//         como `volumetricCloudsTexture`.
//   2. atmospherePostProcessStage (resolucion completa, composite.glsl)
//      -> siempre existe si advanced=true; es el que hace fog + sombras
//         de nube + Rayleigh/Mie + tone mapping.
//
// api: contexto inyectado con { viewer (Cesium.Viewer), Cesium,
//   useNativeAtmosphere(bool), setAtmosphereColorModifier, ... }
// weather: { definition: {cloudCover, cloudBase, cloudTop, ...},
//   currentWindVectorWC, realTimeCloudTexture }
// shaders: bag de fuentes GLSL ya cargadas como string:
//   shaders['atmosphereCommon.glsl'], shaders['atmosphereOnlyFS.glsl'],
//   shaders['volumetricCloudsFS.glsl']  (ver ../shaders/*.glsl)
// ============================================================================

import { clamp } from '../core/constants.js';
import { ATMOSPHERE_DEFAULTS, buildShaderDefines, cloudsTextureScale, blurStepSize } from './constants.js';
import { computeCloudLayerRadii } from './geometry.js';

// hourStamp: cache-bust para la textura de cobertura satelital (6.9),
// se recalcula cada hora asi CDNs/navegador no sirven un frame viejo por
// mas de una hora sin recargar la pagina.
function hourStamp() {
  return Math.floor(Date.now() / 3600000);
}

export function createCloudAtmosphere(api, weather, shaders, Cesium) {
  const fx = { atmosphere: Object.assign({}, ATMOSPHERE_DEFAULTS) };
  fx.atmosphere.color = fx.atmosphere.color || { red: 0.7, green: 0.8, blue: 0.9, alpha: 1 };

  fx.atmosphere.destroy = function () {
    if (this.postProcessingStageSet && this.postProcessingStages) {
      api.viewer.scene.postProcessStages.remove(this.postProcessingStages);
    }
    this.postProcessingStages = null;
    this.postProcessingStageSet = false;
    this.atmospherePostProcessStage = null;
    this.cloudsPostProcessStage = null;
    this.blurStage = null;
  };

  fx.atmosphere.addPostProcessingStage = function () {
    if (fx.globeLoaded && !this.postProcessingStageSet) {
      api.viewer.scene.postProcessStages.add(this.postProcessingStages);
      this.postProcessingStageSet = true;
    }
  };

  // advanced: usar nuestro cielo en vez del de Cesium por defecto.
  // quality: 0-7 (ver constants.js CLOUD_QUALITY_LEVELS).
  // volumetric: nubes por ray marching (sistema B) en vez de solo billboards.
  // realtime: cobertura satelital en tiempo real (6.9).
  // retro: flag esteticaa opcional (paleta retro), pasa directo al shader.
  fx.atmosphere.create = function (advanced, quality, volumetric, realtime, retro) {
    this.destroy();
    const defines = buildShaderDefines({ advanced, quality, volumetric, realtime, retro });

    api.useNativeAtmosphere(!advanced); // apaga el cielo nativo de Cesium si usamos el nuestro

    const atmoR = fx.atmosphere.planetRadius + fx.atmosphere.atmosphereThickness;
    fx.atmosphere.realPlanetRadius = fx.atmosphere.planetRadius + fx.atmosphere.planetRadiusOffset;
    const atmoR2 = atmoR * atmoR;
    let cover = 0.01 * weather.definition.cloudCover;

    const common = shaders['atmosphereCommon.glsl'];
    const atmoFS = shaders['atmosphereOnlyFS.glsl'];
    const cldFS = shaders['volumetricCloudsFS.glsl'];

    this.atmospherePostProcessStage = new Cesium.PostProcessStage({
      fragmentShader: defines + common + atmoFS,
      uniforms: {
        planetRadius: fx.atmosphere.planetRadius,
        realPlanetRadius: fx.atmosphere.realPlanetRadius,
        atmoRadiusSquared: atmoR2,
        backgroundFogDensity: 0,
        backgroundFogColor: fx.atmosphere.color,
        volumetricFogDensity: 0,
        volumetricFogBottom: 0,
        volumetricFogTop: 0,
      },
    });

    if (volumetric) {
      const { cloudThickness, baseThickness, layer, cloudBaseRadius, cloudTopRadius } =
        computeCloudLayerRadii(
          fx.atmosphere.realPlanetRadius,
          weather.definition.cloudBase,
          weather.definition.cloudTop,
          fx.atmosphere.cloudLayerPosition
        );

      Object.assign(this.atmospherePostProcessStage.uniforms, {
        volumetricCloudsTexture: 'volumetricClouds',
        windVector: weather.currentWindVectorWC,
        cloudCover: cover,
        cloudBase: weather.definition.cloudBase,
        cloudTop: weather.definition.cloudTop,
        layerPosition: fx.atmosphere.cloudLayerPosition,
        cloudThickness, baseThickness, layer, cloudBaseRadius, cloudTopRadius,
      });

      const texScale = cloudsTextureScale(quality);
      this.cloudsPostProcessStage = new Cesium.PostProcessStage({
        textureScale: texScale,
        fragmentShader: defines + common + cldFS,
        uniforms: {
          planetRadius: fx.atmosphere.planetRadius,
          realPlanetRadius: fx.atmosphere.realPlanetRadius,
          atmoRadiusSquared: atmoR2,
          windVector: weather.currentWindVectorWC,
          cloudCover: cover,
          cloudBase: weather.definition.cloudBase,
          cloudTop: weather.definition.cloudTop,
          layerPosition: fx.atmosphere.cloudLayerPosition,
          cloudThickness, baseThickness, layer, cloudBaseRadius, cloudTopRadius,
          noiseTexture: '/shaders/noise/bluenoise.png',
        },
      });

      if (realtime) {
        cover = 1;
        const url = weather.realTimeCloudTexture + '?t=' + hourStamp();
        this.atmospherePostProcessStage.uniforms.coverageTexture = url;
        this.atmospherePostProcessStage.uniforms.cloudCover = 1;
        this.cloudsPostProcessStage.uniforms.coverageTexture = url;
        this.cloudsPostProcessStage.uniforms.cloudCover = 1;
      }

      // El blur esconde el undersampling de correr el march a resolucion
      // reducida (texScale). stepSize baja con la calidad: a calidad
      // alta hay menos undersampling que tapar.
      this.blurStage = Cesium.PostProcessStageLibrary.createBlurStage();
      this.blurStage.uniforms.delta = 1;
      this.blurStage.uniforms.sigma = 2;
      this.blurStage.uniforms.stepSize = blurStepSize(quality);

      this.postProcessingStages = new Cesium.PostProcessStageComposite({
        inputPreviousStageTexture: false,
        stages: [
          new Cesium.PostProcessStageComposite({
            inputPreviousStageTexture: true,
            stages: [this.cloudsPostProcessStage, this.blurStage],
            name: 'volumetricClouds',
          }),
          this.atmospherePostProcessStage,
        ],
      });
    } else {
      this.postProcessingStages = this.atmospherePostProcessStage;
    }

    // NO agregar el stage hasta que el globo haya cargado: si no, la
    // depth texture esta vacia y el primer frame del composite sale mal.
    document.addEventListener('globeLoaded', () => this.addPostProcessingStage());
    fx.cloudAtmosphereInstance = this;
    return this;
  };

  // Recalcula geometria de la capa (radios, uniforms) al ritmo de
  // updateTime (1 Hz por defecto). CRITICO: el radio del planeta se mide
  // CADA VEZ en el punto de camara: a radio fijo, en latitudes altas
  // (elipsoide mas chato en los polos) las nubes atraviesan el suelo o
  // flotan ~20 km de mas.
  fx.atmosphere.update = function (lla, force, updateTime) {
    if (!this.postProcessingStages) return;
    if (updateTime && !updateTime(this, 1000) && !force) return;

    const cart = api.viewer.scene.globe.ellipsoid.cartographicToCartesian(
      new Cesium.Cartographic(lla[1] * Math.PI / 180, lla[0] * Math.PI / 180, 0)
    );
    const R = Cesium.Cartesian3.magnitude(cart);
    const planetR = R - fx.atmosphere.planetRadiusOffset;
    const atmoR = planetR + fx.atmosphere.atmosphereThickness;
    fx.atmosphere.realPlanetRadius = R;

    const { cloudThickness, baseThickness, layer, cloudBaseRadius, cloudTopRadius } =
      computeCloudLayerRadii(R, weather.definition.cloudBase, weather.definition.cloudTop,
        fx.atmosphere.cloudLayerPosition);

    const u = this.atmospherePostProcessStage.uniforms;
    u.planetRadius = planetR;
    u.realPlanetRadius = R;
    u.atmoRadiusSquared = atmoR * atmoR;
    u.cloudBase = weather.definition.cloudBase;
    u.cloudTop = weather.definition.cloudTop;
    u.cloudThickness = cloudThickness;
    u.baseThickness = baseThickness;
    u.layer = layer;
    u.cloudBaseRadius = cloudBaseRadius;
    u.cloudTopRadius = cloudTopRadius;

    if (this.cloudsPostProcessStage) {
      const c = this.cloudsPostProcessStage.uniforms;
      c.planetRadius = planetR;
      c.realPlanetRadius = R;
      c.cloudBase = u.cloudBase; c.cloudTop = u.cloudTop;
      c.cloudThickness = cloudThickness; c.baseThickness = baseThickness;
      c.layer = layer; c.cloudBaseRadius = cloudBaseRadius; c.cloudTopRadius = cloudTopRadius;
    }
  };

  // Cambia viento/cobertura en caliente (p.ej. al cambiar de METAR o de
  // capa de clima) y fuerza un update inmediato de geometria.
  fx.atmosphere.setConditions = function (windWC, cover01, cameraLla) {
    if (!this.postProcessingStages || !this.volumetricClouds) return;
    if (this.realTimeClouds) cover01 = 1;
    this.atmospherePostProcessStage.uniforms.windVector = windWC;
    this.atmospherePostProcessStage.uniforms.cloudCover = cover01;
    this.cloudsPostProcessStage.uniforms.windVector = windWC;
    this.cloudsPostProcessStage.uniforms.cloudCover = cover01;
    this.update(cameraLla, true);
  };

  // Fog volumetrico horizontal (capa entre bottom/top), usado por
  // CloudManager.update() al entrar/salir de overcast (ver cloud-manager.js).
  fx.atmosphere.setVolumetricFog = function (bottom, top, density) {
    if (!this.atmospherePostProcessStage) return;
    const u = this.atmospherePostProcessStage.uniforms;
    u.volumetricFogBottom = bottom;
    u.volumetricFogTop = top;
    u.volumetricFogDensity = density || 0;
  };

  fx.atmosphere.setFogDensity = function (density) {
    if (!this.atmospherePostProcessStage) return;
    this.atmospherePostProcessStage.uniforms.backgroundFogDensity = density;
  };

  return fx;
}
