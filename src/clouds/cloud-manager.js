// ============================================================================
// PARTE 6.8 — CloudManager (SISTEMA A: billboards / modelos)
//
// Se usa cuando las volumetricas estan OFF, o cuando la cobertura llega a
// overcast (100%): en ese caso un unico "techo" (CloudCover) sustituye a
// las nubes individuales y se combina con fog denso al atravesarlo.
//
// Ambos sistemas (A y B) leen la MISMA weather.definition (cloudCover,
// cloudBase, cloudTop). Cuando las volumetricas estan ON, quien las
// activa (atmosphere-stage.js / codigo de PARTE 12) debe poner la
// cobertura visual de billboards a 0 -- las volumetricas sustituyen, no
// se suman (verlas dobladas se nota mucho).
//
// Dependencias inyectadas via `deps` (nada de globals):
//   aircraft   { instance: { llaLocation } }
//   weather    { definition, belowCloudsBrightness }
//   fx         { atmosphere, precipitation, cloudManager (se auto-asigna) }
//   api        { billboard(lla, url, opts), Model(url, opts), Cesium,
//                setAtmosphereColorModifier, setImageryColorModifier,
//                removeImageryColorModifier, hideSun, showSun }
//   camera     { lla }
//   enableShadows, disableShadows   funciones de PARTE 10 (render)
// ============================================================================

import { clamp } from '../core/constants.js';
import { TWO_PI } from '../core/constants.js';
import { V3 } from '../core/vectors.js';
import { xy2ll, lla2xyz } from '../core/coordinates.js';

// Tipos de nube: billboard (sprite PNG, siempre orientado a camara) o
// modelo glTF plano (mas caro, mejor de cerca / desde arriba). belowCeiling/
// aboveCeiling son offsets en metros SOBRE cloudBase, no altitudes absolutas.
const CLOUD_TYPES = [
  { billboard: 'images/weather/clouds/1.png', belowCeiling: 500, aboveCeiling: 1000,
    minScale: 6, maxScale: 10, maxRadius: 5e4, opacity: 0.9, shadow: true },
  { billboard: 'images/weather/clouds/6.png', belowCeiling: 500, aboveCeiling: 1000,
    minScale: 10, maxScale: 15, maxRadius: 5e4, opacity: 0.9, shadow: true },
  { billboard: 'images/weather/clouds/cumulonimbus.png', belowCeiling: 500, aboveCeiling: 100,
    minScale: 6, maxScale: 10, maxRadius: 1e5, opacity: 0.9, shadow: true },
  { model: 'models/clouds/flat1.gltf', belowCeiling: 2000, aboveCeiling: 9000,
    minScale: 4e4, maxScale: 45e3, maxRadius: 3e5, rotationMultiplier: 360, opacity: 1 },
  { model: 'models/clouds/flat2.gltf', belowCeiling: 2000, aboveCeiling: 9000,
    minScale: 4e4, maxScale: 45e3, maxRadius: 3e5, rotationMultiplier: 360, opacity: 1 },
];
const CLOUD_DEFAULT_TYPE = { belowCeiling: 0, aboveCeiling: 1000, opacity: 0.8, minRadius: 1, maxRadius: 1e5 };

export function createCloudManager(deps) {
  const { aircraft, weather, fx, api, camera } = deps;

  // --------------------------------------------------------------------
  // Cloud: una nube individual (billboard o modelo), colocada en un anillo
  // alrededor del punto de spawn (normalmente la posicion del avion).
  // --------------------------------------------------------------------
  function Cloud() {
    this._id = fx.cloudManager.instance.currentID++;
    this._type = Object.assign({}, CLOUD_DEFAULT_TYPE,
      CLOUD_TYPES[Math.floor(Math.random() * CLOUD_TYPES.length)]);
    fx.cloudManager.instance.numberOfClouds++;
    fx.cloudManager.instance.clouds[this._id] = this;
    this.create();
  }

  Cloud.prototype.create = function (lla) {
    if (!lla) {
      const theta = Math.random() * TWO_PI;
      // sqrt(random) reparte UNIFORMEMENTE EN AREA: con random lineal las
      // nubes se amontonarian cerca del centro (el area de un anillo
      // crece con r, asi que hace falta mas densidad de muestras lejos).
      const radius = Math.sqrt(Math.random()) * (this._type.maxRadius - (this._type.minRadius || 0))
        + (this._type.minRadius || 0);
      const xy = [Math.cos(theta) * radius, Math.sin(theta) * radius];
      lla = V3.add(aircraft.instance.llaLocation, xy2ll(xy, aircraft.instance.llaLocation));
      lla[2] = Math.random() * (this._type.aboveCeiling - this._type.belowCeiling)
        + (weather.definition.cloudBase + this._type.belowCeiling);
    }
    this._location = lla;
    if (this._type.billboard) {
      const opt = {
        sizeInMeters: true,
        scale: clamp(Math.random() * (this._type.maxScale - this._type.minScale) + this._type.minScale,
          this._type.minScale, this._type.maxScale),
        translucencyByDistance: new api.Cesium.NearFarScalar(
          this._type.maxRadius / 2, this._type.opacity, this._type.maxRadius, 0.3
        ),
        fixCameraRotation: true,
      };
      this._entity = new api.billboard(lla, this._type.billboard, opt);
    } else {
      this._entity = new api.Model(this._type.model, {
        location: lla,
        scale: this._type.minScale + Math.random() * (this._type.maxScale - this._type.minScale),
        rotation: [0, 0, Math.random() * this._type.rotationMultiplier],
      });
    }
  };

  Cloud.prototype.destroy = function () {
    if (this._entity && this._entity.destroy) this._entity.destroy();
    delete fx.cloudManager.instance.clouds[this._id];
  };

  // --------------------------------------------------------------------
  // CloudCover: el "techo solido" de overcast. Un modelo/plano enorme a
  // cloudBase, o un fog denso, segun lo que implemente `api`. Se esconde
  // al atravesarlo (ver CloudManager.update, situacion sit&4) para no
  // ver la cara de abajo de un plano gigante.
  // --------------------------------------------------------------------
  function CloudCover(lla) {
    this.entity = new api.Model('models/clouds/overcast.gltf', {
      location: lla,
      scale: 1,
    });
  }
  CloudCover.prototype.destroy = function () {
    if (this.entity && this.entity.destroy) this.entity.destroy();
  };

  const cloudManager = {
    cloudCoverToCloudNumber: 15,     // numero de nubes = percent(0-100) * este factor
    clouds: {},
    numberOfClouds: 0,
    currentID: 0,
    maxNumberOfClouds: 0,
    refreshDistance: 1000,           // m: si el avion se aleja mas de esto, respawn total
    currentCenter: [0, 0, 0],
    cloudSituation: null,
    percentCoverage: 0,

    // Llamar una vez por frame (o al ritmo que convenga) con la lla
    // actual del avion: decide si hay que reciclar el conjunto de nubes
    // porque nos alejamos demasiado del centro donde se generaron.
    init(lla) {
      this.cloudSituation = null;
      const d = lla2xyz(V3.sub(this.currentCenter, lla), aircraft.instance.llaLocation);
      if (V3.length(d) > this.refreshDistance) this.destroyAllClouds();
      this.currentCenter = lla;
      this.numberOfClouds = 0;
      fx.cloudManager.instance = this;
    },

    destroyAllClouds() {
      for (const id of Object.keys(this.clouds)) this.clouds[id].destroy();
      this.clouds = {};
      this.numberOfClouds = 0;
    },

    destroyLastCloud() {
      const ids = Object.keys(this.clouds);
      if (!ids.length) return;
      this.clouds[ids[ids.length - 1]].destroy();
    },

    // Ajusta el numero de nubes vivas hacia this.maxNumberOfClouds
    // (llamar tras setNumberOfClouds/setCloudCover, o cada N frames para
    // ir generando/despoblando gradualmente en vez de todas de golpe).
    spawnClouds() {
      let n = this.maxNumberOfClouds - this.numberOfClouds;
      if (n > 0) { while (n--) new Cloud(); } else { while (n++ < 0) this.destroyLastCloud(); }
    },

    setNumberOfClouds(n) {
      this.maxNumberOfClouds = Math.round(n);
    },

    // percent: 0-100. A 100% se activa CloudCover (techo solido) en vez
    // de seguir poblando billboards individuales (serian miles de sprites
    // superpuestos, carisimo y feo). setAtmosphereColorModifier empana el
    // cielo/terreno progresivamente segun cobertura (weatherHaze).
    setCloudCover(percent) {
      this.percentCoverage = percent || 0;
      const t = 0.01 * this.percentCoverage;
      if (this.percentCoverage >= 100) {
        if (!this.fullCover) {
          this.fullCover = new CloudCover([
            camera.lla[0], camera.lla[1], weather.definition.cloudBase,
          ]);
        }
      } else if (this.fullCover) {
        this.fullCover.destroy();
        this.fullCover = null;
      }
      api.setAtmosphereColorModifier('weatherHaze', {
        groundBrightnessShift: clamp(0.5 * t, 0, 0.1),
        fogBrightness: clamp(1 + t, 1, 1.2),
        brightnessShift: clamp(0.5 * t, 0, 0.1),
      });
      this.setNumberOfClouds(this.percentCoverage * this.cloudCoverToCloudNumber);
    },

    // Estado de vuelo respecto a la capa, como bitmask:
    //   2  = por debajo de la capa
    //   6  = entrando en la base   (2|4)
    //   12 = dentro de la capa     (4|8)
    //   8  = por encima de la capa
    //   +1 = ademas dentro de fogCeiling (niebla de superficie)
    // Se usa para decidir sombras on/off, sol visible/oculto, y densidad
    // de fog, solo cuando el bitmask CAMBIA (evita trabajo por frame).
    update(lla) {
      const def = weather.definition;
      const brightness = clamp(
        (lla[2] - (def.cloudBase - def.coverHalfThickness)) / def.cloudCoverThickness,
        weather.belowCloudsBrightness, 1
      );
      let sit = lla[2] < def.cloudBase ? 2
        : lla[2] < def.cloudBase + def.coverHalfThickness ? 6
          : lla[2] < def.cloudBase + def.cloudCoverThickness ? 12
            : 8;
      if (lla[2] < def.fogCeiling) sit += 1;

      if (this.cloudSituation !== sit) {
        fx.atmosphere.setVolumetricFog(def.fogBottom, def.fogCeiling, def.fog);
        if (sit <= 7) {
          fx.atmosphere.setFogDensity(def.backgroundFogDensity);
          if (this.fullCover) {
            fx.precipitation.show();
            this.fullCover.entity.show();
            deps.disableShadows();
            api.hideSun();
            api.setImageryColorModifier('cloudcover', {
              saturation: clamp(brightness, 0.2, 1),
              brightness: clamp(brightness, 0.2, 1),
            });
          } else {
            deps.enableShadows();
            api.showSun();
            api.removeImageryColorModifier('cloudcover');
          }
        }
        if (sit & 8) {
          fx.atmosphere.setFogDensity(0);
          fx.precipitation.hide();
          deps.enableShadows();
          api.showSun();
        }
      }
      // Transicion suave al atravesar la capa: sube fogDensity con la
      // proximidad a cloudBase mientras se esta "dentro" (sit&4), y
      // esconde/muestra el techo solido segun cuanto fog haya (evita el
      // "pop" de ver/perder el modelo de golpe).
      if ((sit & 4) && this.fullCover) {
        const baseFog = sit < 8 ? def.backgroundFogDensity : 0;
        const r = clamp((def.coverHalfThickness - Math.abs(def.cloudBase - lla[2])) * 0.1, baseFog, 1);
        fx.atmosphere.setFogDensity(r);
        if (r > 0.5) this.fullCover.entity.hide();
        else this.fullCover.entity.show();
      }
      this.cloudSituation = sit;
    },
  };

  fx.cloudManager = cloudManager;
  return { cloudManager, Cloud, CloudCover };
}
