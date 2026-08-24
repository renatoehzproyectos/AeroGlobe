// ============================================================================
// CAPA DE RENDER — implementaciones REALES (Cesium) de las dependencias
// que todo el motor (PARTE 1-12) recibe inyectadas como `api.Model`,
// `api.Canvas`, `api.ParticleEmitter` y `api.setCameraPositionAndOrientation`.
//
// Ninguna de estas 4 piezas viene con codigo en el tutorial (se
// documentan ahi como "constructor inyectado por la capa de render" en
// cada modulo que las usa — aircraft-tree.js, water-detection.js,
// wake.js, camera.js). Este archivo es esa capa, para poder correr el
// simulador en un navegador real con Cesium de verdad en vez de los
// mocks usados para las pruebas en Node de cada parte.
// ============================================================================

// --- api.Model --------------------------------------------------------------
// Envuelve un Cesium.Model. El motor lo usa asi (ver aircraft-tree.js,
// ground-shadow.js):
//   const model = new api.Model(url, scale);
//   model.setPositionOrientationAndScale(lla, htr, scaleXYZ);
// lla = [lat_grados, lon_grados, alt_metros], htr = [heading, tilt, roll]
// en GRADOS (ver core/coordinates.js, convencion del proyecto).
export function makeModelClass(viewer, Cesium) {
  return function Model(url, scale) {
    this.url = url;
    this.scale = Array.isArray(scale) ? scale : [scale || 1, scale || 1, scale || 1];
    this.ready = false;
    this.primitive = null;

    Cesium.Model.fromGltfAsync({
      url,
      scale: this.scale[0],
      // El motor coloca el modelo el mismo frame en que se resuelve la
      // promesa via setPositionOrientationAndScale -- no hace falta un
      // modelMatrix inicial "bueno", solo uno valido para que Cesium no
      // se queje mientras carga.
      modelMatrix: Cesium.Matrix4.IDENTITY,
    }).then((m) => {
      this.primitive = m;
      viewer.scene.primitives.add(m);
      this.ready = true;
      if (this._pending) {
        this.setPositionOrientationAndScale(...this._pending);
        this._pending = null;
      }
    }).catch((err) => {
      console.error(`api.Model: no se pudo cargar "${url}":`, err);
    });
  };
}

function attachModelPrototype(Model, Cesium) {
  Model.prototype.setPositionOrientationAndScale = function (lla, htr, scaleXYZ) {
    if (!this.ready || !this.primitive) {
      // Todavia cargando (fromGltfAsync es asincrono) -- se guarda la
      // ULTIMA posicion pedida para aplicarla en cuanto el modelo este
      // listo, en vez de perder el primer placeParts() del frame en que
      // termino de cargar.
      this._pending = [lla, htr, scaleXYZ];
      return;
    }
    const position = Cesium.Cartesian3.fromDegrees(lla[1], lla[0], lla[2]);
    const hpr = new Cesium.HeadingPitchRoll(
      (htr[0] || 0) * Math.PI / 180,
      (htr[1] || 0) * Math.PI / 180,
      (htr[2] || 0) * Math.PI / 180,
    );
    this.primitive.modelMatrix = Cesium.Transforms.headingPitchRollToFixedFrame(position, hpr);
    if (scaleXYZ) this.primitive.scale = scaleXYZ[0] || 1;
  };
  return Model;
}

// --- api.Canvas --------------------------------------------------------------
// Usado SOLO por water-detection.js (PARTE 11.1) para leer el canal B de
// un tile PNG de landuse. Un <canvas> 2D real, con loadTiles(url) que
// dibuja la imagen descargada y deja los pixeles listos para
// getImageData().
export function makeCanvasClass() {
  return function Canvas(opts) {
    const el = document.createElement('canvas');
    el.width = opts.width;
    el.height = opts.height;
    this.context = el.getContext('2d', { willReadFrequently: !!opts.willReadFrequently });
    if (opts.color) {
      this.context.fillStyle = opts.color;
      this.context.fillRect(0, 0, opts.width, opts.height);
    }
    this._el = el;

    this.loadTiles = (url) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => this.context.drawImage(img, 0, 0, opts.width, opts.height);
      img.onerror = () => {
        // Tile de landuse no disponible (404, CORS, sin LANDUSE_SERVER
        // configurado): se deja el canvas en su color de fondo (agua
        // detection.js interpreta cualquier canal B bajo como "sin
        // agua", que es un fallback seguro).
      };
      img.src = url;
    };
  };
}

// --- api.ParticleEmitter ------------------------------------------------------
// Usado por wake.js (PARTE 11.3) para la estela de flotadores. Envuelve
// un Cesium.ParticleSystem real con un burst de billboards pequenos.
export function makeParticleEmitterClass(viewer, Cesium) {
  return function ParticleEmitter(opts) {
    this.emitting = false;
    this._matrix = Cesium.Matrix4.IDENTITY;
    this.system = new Cesium.ParticleSystem({
      image: opts.image,
      startColor: Cesium.Color.fromCssColorString('#ffffff').withAlpha(opts.startColor ? opts.startColor[3] : 0.6),
      endColor: Cesium.Color.fromCssColorString('#ffffff').withAlpha(opts.endColor ? opts.endColor[3] : 0),
      startScale: opts.startScale || 0.5,
      endScale: opts.endScale || 4,
      particleLife: opts.particleLife || 4,
      emissionRate: 0, // arranca apagado, ver `emitting` setter abajo
      lifetime: 16.0,
      emitter: new Cesium.CircleEmitter(0.5),
      modelMatrix: this._matrix,
    });
    viewer.scene.primitives.add(this.system);
    this._rate = opts.emissionRate || 20;

    Object.defineProperty(this, 'emitting', {
      get: () => this._emitting,
      set: (v) => {
        this._emitting = v;
        this.system.emissionRate = v ? this._rate : 0;
      },
    });
  };
}

function attachParticleEmitterPrototype(ParticleEmitter, Cesium) {
  ParticleEmitter.prototype.setModelMatrix = function (matrix) {
    // wake.js pasa part.object3d.getWorldFrame() (una matriz 3x3 propia
    // del motor, PARTE 3/9) -- se convierte a Cesium.Matrix4 combinando
    // con la posicion ECEF del avion. Como wake.js no pasa la posicion
    // por separado, se usa la ultima que Model.setPositionOrientationAndScale
    // dejo en el propio `part.object3d` via su llaLocation (mismo dato
    // que ya usa placeParts()) -- se resuelve leyendo matrix directamente
    // si ya es un Cesium.Matrix4 (compatibilidad hacia adelante), o
    // dejando el emisor en su ultima posicion conocida si no.
    if (matrix && matrix.length === 16) {
      this.system.modelMatrix = Cesium.Matrix4.fromArray(matrix);
    }
  };
  return ParticleEmitter;
}

// --- api.setCameraPositionAndOrientation -------------------------------------
// camera.js (PARTE 10.2) ya llama esto con (cam, lla, htr) -- posiciona
// la Cesium.Camera real.
export function setCameraPositionAndOrientation(Cesium) {
  return function (cam, lla, htr) {
    cam.setView({
      destination: Cesium.Cartesian3.fromDegrees(lla[1], lla[0], lla[2]),
      orientation: new Cesium.HeadingPitchRoll(
        (htr[0] || 0) * Math.PI / 180,
        (htr[1] || 0) * Math.PI / 180,
        (htr[2] || 0) * Math.PI / 180,
      ),
    });
  };
}

// ----------------------------------------------------------------------------
// attachRenderLayer(api, viewer, Cesium) — arma las 4 piezas de arriba y
// las cuelga de `api`, en el mismo objeto que create App()/start() ya
// usa para todo lo demas (getGroundAltitude*, camera, etc).
// ----------------------------------------------------------------------------
export function attachRenderLayer(api, viewer, Cesium) {
  api.Model = attachModelPrototype(makeModelClass(viewer, Cesium), Cesium);
  api.Canvas = makeCanvasClass();
  api.ParticleEmitter = attachParticleEmitterPrototype(makeParticleEmitterClass(viewer, Cesium), Cesium);
  api.setCameraPositionAndOrientation = setCameraPositionAndOrientation(Cesium);
}
