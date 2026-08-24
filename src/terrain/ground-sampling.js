// ============================================================================
// PARTE 4.3 / 4.4 / 4.5 — ALTURA DE SUELO, NORMAL, RESULTADO DE COLISION
//
// Este modulo es el corazon de "que altura tiene el suelo aqui" para la
// fisica. Todo el codigo asume que `api` es un objeto de contexto inyectado
// por el caller con: viewer (Cesium.Viewer), Cesium, googleTileset (opcional),
// renderingSettings { buildingCollision, degradedCollisions }.
//
// Los `ctx` que se pasan por ahi son objetos de estado POR PUNTO DE MUESTREO
// (uno por collisionPoint, o uno global para el CG) que persisten entre
// frames: {lastGroundAltitude, groundContact, wrongAltitudeTries, oldNormal,
// wrongNormal}. Sin ese estado el filtro anti-spike no tiene memoria.
// ============================================================================

import { V3 } from '../core/vectors.js';
import { xyz2lla_fast, lla2xyz } from '../core/coordinates.js';

// ----------------------------------------------------------------------------
// 4.3  getGroundAltitude — el sample que usa la fisica
//
// Hay TRES/CUATRO fuentes de altura, en este orden de preferencia segun
// configuracion:
//   A) Objetos del mundo (edificios, portaaviones, plataformas) si un rayo
//      vertical los golpea. Devuelven {location, normal, object}.
//   B) Tileset fotorealista (si lo usas): tileset.getHeight(cartographic, scene)
//   C) El globo: scene.globe.getHeight(cartographic)
//   D) Fallback: scene.sampleHeight (incluye modelos 3D de edificios)
//
// Y un filtro anti-spikes encima.
// ----------------------------------------------------------------------------

export function createGroundAltitudeApi(api) {
  api.contactAltitudeErrorThreshold = 0.2;   // m, si estas en contacto
  api.generalAltitudeErrorThreshold = 10;    // m, en vuelo
  api.wrongAltitudeAllowedTries = 5;
  api.oldNormal = [0, 0, 1];
  api.normalDotThreshold = 0.95;
  api.wrongNormalTries = 3;

  const Cesium = api.Cesium;

  // Fuente cruda de altura (sin filtro). fallback = sim.groundElevation||0
  api.getGroundAltitude = function (lla, ctx) {
    const fallback = api.sim && api.sim.groundElevation != null ? api.sim.groundElevation : 0;
    let h;

    if (api.googleTileset) {
      const c = Cesium.Cartographic.fromDegrees(lla[1], lla[0], fallback);
      h = api.googleTileset.getHeight(c, api.viewer.scene);
    } else if (api.renderingSettings && api.renderingSettings.buildingCollision) {
      // Offset minimo para no samplear exactamente el origen del modelo del
      // avion (si no, Cesium puede golpear el propio mesh y el tren "flota")
      const c = Cesium.Cartographic.fromDegrees(lla[1] + 1e-4, lla[0] + 1e-4, 0);
      h = api.viewer.scene.sampleHeight(c, api.aircraftModels || []);
    } else {
      const c = Cesium.Cartographic.fromDegrees(lla[1], lla[0], fallback);
      h = api.viewer.scene.globe.getHeight(c);
    }

    if (h < -1000) h = undefined; // sentinel de "sin dato"

    if (h === undefined) {
      if (ctx && ctx.lastGroundAltitude != null) {
        h = fallback || ctx.lastGroundAltitude;
        if (ctx) ctx.wrongValue = 'undefined';
      } else {
        h = fallback;
      }
      return h;
    }

    if (ctx) {
      ctx.lastGroundAltitude = ctx.lastGroundAltitude != null ? ctx.lastGroundAltitude : fallback;
      const jump = Math.abs(ctx.lastGroundAltitude - h);
      const threshold = ctx.groundContact
        ? api.contactAltitudeErrorThreshold  // en contacto: 30cm ya es un rebote visible
        : api.generalAltitudeErrorThreshold; // en crucero: 30cm es ruido de tile

      if (jump > threshold) {
        ctx.wrongAltitudeTries = ctx.wrongAltitudeTries || 0;
        if (ctx.wrongAltitudeTries <= api.wrongAltitudeAllowedTries) {
          ctx.wrongAltitudeTries++;
          ctx.wrongValue = h;
          return ctx.lastGroundAltitude || 0; // IGNORA el spike
        }
      }
      ctx.wrongAltitudeTries = 0;
      ctx.lastGroundAltitude = h;
    }
    return h;
  };

  // Envoltorio que tambien consulta objetos del mundo (edificios, barcos...)
  api.getGroundAltitudeWithObjects = function (lla, ctx) {
    const fromObject = api.objects && api.objects.getAltitudeAtLocation
      ? api.objects.getAltitudeAtLocation(lla)
      : null;
    if (fromObject) return fromObject; // {location:[lat,lon,h], normal, object}
    const h = api.getGroundAltitude(lla, ctx);
    return { location: [lla[0], lla[1], h] };
  };

  // globe.getHeight es SINCRONO y barato: lee el tile ya cargado. Si el
  // tile no esta, devuelve undefined. NUNCA bloquees el frame con
  // sampleTerrain (async) dentro de la fisica. Para flyTo si conviene:
  api.getGuarantiedGroundAltitude = function (lla) {
    const c = [Cesium.Cartographic.fromDegrees(lla[1], lla[0], 0)];
    if (api.googleTileset) {
      return api.viewer.scene.sampleHeightMostDetailed(c, null, 1);
    }
    if (api.viewer.terrainProvider) {
      return Cesium.sampleTerrain(
        api.viewer.terrainProvider,
        api.viewer.terrainProvider.maximumLevel,
        c
      );
    }
    return Promise.resolve([{ height: 0 }]);
  };

  api.getFastTerrainElevation = function (lla) {
    const c = Cesium.Cartographic.fromDegrees(lla[1], lla[0], lla[2]);
    if (api.googleTileset) return api.googleTileset.getHeight(c, api.viewer.scene) || 0;
    return api.viewer.scene.globe.getHeight(c) || 0;
  };

  // --------------------------------------------------------------------------
  // 4.4  Normal del terreno por tres puntos
  //
  // No confies en las vertex normals del quantized-mesh. Samplea un
  // triangulo de 1 m alrededor del punto y calcula la normal geometrica.
  // --------------------------------------------------------------------------

  api.getGroundNormal = function (lla, ctx) {
    ctx = ctx || {};
    ctx.oldNormal = ctx.oldNormal || [0, 0, 1];

    const p0 = V3.dup(lla);
    const step = xyz2lla_fast([1, 1, 0], p0); // ~1 m este y 1 m norte
    const pE = [p0[0] + step[0], p0[1], p0[2]];
    const pN = [p0[0], p0[1] + step[1], p0[2]];

    p0[2] = api.getGroundAltitude(p0);
    pE[2] = api.getGroundAltitude(pE);
    pN[2] = api.getGroundAltitude(pN);

    const vE = lla2xyz([pE[0] - p0[0], pE[1] - p0[1], pE[2] - p0[2]], p0);
    const vN = lla2xyz([pN[0] - p0[0], pN[1] - p0[1], pN[2] - p0[2]], p0);
    // TRAMPA: el orden es vN x vE. Al reves, la normal apunta hacia abajo
    // y el avion es "succionado" por el suelo.
    const n = V3.normalize(V3.cross(vN, vE));

    // Rechaza normales que giran demasiado respecto a la anterior (spike)
    if (V3.dot(n, ctx.oldNormal) < api.normalDotThreshold &&
        (ctx.wrongNormal || 0) < api.wrongNormalTries) {
      ctx.wrongNormal = (ctx.wrongNormal || 0) + 1;
      return ctx.oldNormal;
    }
    ctx.wrongNormal = 0;
    ctx.oldNormal = n;
    return n;
  };

  return api;
}

// En modo degradedCollisions no se recalcula la normal cada frame:
// throttling a 10-100 ms segun calidad. `throttleWithDefault` es un helper
// generico: llama a `fn` solo si paso `periodMs` desde la ultima vez,
// devolviendo `defaultValue` en caso contrario.
export function throttleWithDefault(fn, defaultValue, periodMs, ctx) {
  const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
  if (!ctx._lastThrottleCall || now - ctx._lastThrottleCall >= periodMs) {
    ctx._lastThrottleCall = now;
    return fn();
  }
  return defaultValue;
}

export function getNormalFromCollision(api, collResult, ctx) {
  const period = api.renderingSettings && api.renderingSettings.degradedCollisions ? 100 : 10;
  if (api.googleTileset) return [0, 0, 1]; // photoreal tileset: asume up
  if (collResult.normal) return collResult.normal;
  return throttleWithDefault(
    () => api.getGroundNormal(collResult.location, ctx),
    ctx.oldNormal || [0, 0, 1],
    period,
    ctx
  );
}

// ----------------------------------------------------------------------------
// 4.5  getCollisionResult — altura en un punto desplazado
//
// Cuando un collisionPoint no esta en el CG, no quieres un sample nuevo si
// estas en modo degradado o en la app movil. Proyectas el punto sobre el
// plano del contacto anterior:
//
//   z = z0 + x * (-nx/nz) + y * (-ny/nz)
//
// Eso es la ecuacion del plano n·(p-p0)=0 despejando z.
// ----------------------------------------------------------------------------

export function getAltitudeAtPointFromCollisionResult(coll, localOffset) {
  // localOffset = [x, y, z] en metros ENU relativos al sample original
  const nx = coll.normal[0], ny = coll.normal[1], nz = coll.normal[2];
  const dzdx = -nx / nz;
  const dzdy = -ny / nz;
  return coll.location[2] + localOffset[0] * dzdx + localOffset[1] * dzdy;
}

export function getCollisionResult(api, sim, lla, localOffset, prevColl, ctx) {
  const degraded = sim.isApp ||
    (api.renderingSettings && api.renderingSettings.degradedCollisions) ||
    sim.cautiousWithTerrain;

  if (localOffset && prevColl && degraded) {
    let z;
    if (prevColl.normal[2] < 0.45) {
      // Pendiente > ~63 deg: el plano es inestable, usa z del sample
      z = prevColl.location[2];
    } else {
      z = getAltitudeAtPointFromCollisionResult(prevColl, [localOffset[0], localOffset[1], 0]);
    }
    return {
      location: [lla[0], lla[1], z],
      normal: V3.dup(prevColl.normal),
      object: prevColl.object,
    };
  }
  return api.getGroundAltitudeWithObjects(lla, ctx);
}
