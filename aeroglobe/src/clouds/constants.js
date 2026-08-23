// ============================================================================
// PARTE 6.1 / 6.4 — CONSTANTES DE NUBES Y NIVELES DE CALIDAD
//
// fx.atmosphere.* son las constantes "geometricas" globales del cielo:
// el radio del planeta usado en los shaders es MENOR que el real (offset
// de 10 km) para que la atmosfera se vea mas gruesa; las nubes en cambio
// usan realPlanetRadius (el radio real), si no flotan sobre el terreno.
//
// realPlanetRadius se recalcula CADA SEGUNDO en atmosphere-stage.js con
// el radio local del elipsoide en la posicion de la camara: a 6371 km fijo,
// en latitudes altas (elipsoide mas chato en los polos) las nubes
// atraviesan el suelo o flotan ~20 km de mas.
// ============================================================================

export const ATMOSPHERE_DEFAULTS = {
  planetRadiusOffset: 10000,      // m
  planetRadius: 6361000,          // m  (radio "shader", con offset restado)
  realPlanetRadius: 6371000,      // m  (radio real, recalculado en runtime)
  atmosphereThickness: 111000,    // m
  cloudLayerPosition: 0.2,        // 20% de la altura de la capa = "base densa"
};

export const CLOUD_LAYER_DEFAULTS = {
  cloudCover: 40,                 // 0-100 (%)
  cloudBase: 1000,                // m
  cloudTop: 3000,                 // m  (o cloudBase + cloudThickness)
  cloudThickness: 4000,           // m  (manual, si se prefiere sobre cloudTop)
  cloudCoverThickness: 200,       // m, grosor de "sopa" al estar in-cloud
};

export const CLOUDS_MAX_VIEWING_DISTANCE = 250000; // m

// Niveles de calidad 0-7 del ray march volumetrico (definen los #define
// que se inyectan en el fragment shader, ver atmosphere-stage.js).
// PRIMARY_STEPS/LIGHT_STEPS son de la atmosfera Rayleigh (PARTE 7), no de
// nubes; el stage de nubes redefine esos dos a 1/0 porque no integra
// Rayleigh dentro del march (se aplica una vez al final, en composite).
export const CLOUD_QUALITY_LEVELS = {
  0: { primarySteps: 3, lightSteps: 1, maxLod: 0, marchStep: 1000, densMarchStep: 200, maxSteps: 10, distanceQualityRatio: 0.0004, shadows: false },
  1: { primarySteps: 3, lightSteps: 1, maxLod: 0, marchStep: 1000, densMarchStep: 200, maxSteps: 20, distanceQualityRatio: 0.0004, shadows: false },
  2: { primarySteps: 6, lightSteps: 1, maxLod: 0, marchStep: 1000, densMarchStep: 200, maxSteps: 50, distanceQualityRatio: 0.0002, shadows: true },
  3: { primarySteps: 6, lightSteps: 2, maxLod: 0, marchStep: 750, densMarchStep: 150, maxSteps: 75, distanceQualityRatio: 0.0001, shadows: true },
  4: { primarySteps: 9, lightSteps: 3, maxLod: 1, marchStep: 750, densMarchStep: 150, maxSteps: 100, distanceQualityRatio: 0.00007, shadows: true },
  5: { primarySteps: 9, lightSteps: 3, maxLod: 1, marchStep: 750, densMarchStep: 150, maxSteps: 150, distanceQualityRatio: 0.00005, shadows: true },
  6: { primarySteps: 12, lightSteps: 4, maxLod: 1, marchStep: 500, densMarchStep: 100, maxSteps: 200, distanceQualityRatio: 0.00004, shadows: true },
  7: { primarySteps: 16, lightSteps: 4, maxLod: 1, marchStep: 500, densMarchStep: 100, maxSteps: 300, distanceQualityRatio: 0.00003, shadows: true },
};

// texScale = clamp(0.12 * quality, 0.25, 1) -> a calidad 4, 48% de
// resolucion. El PostProcessStage de nubes corre a esta escala; un blur
// posterior esconde el undersampling (ver atmosphere-stage.js).
export function cloudsTextureScale(quality) {
  return Math.min(Math.max(0.12 * quality, 0.25), 1);
}

// stepSize del blur posterior al stage de nubes (mas barato a mayor
// calidad, porque hay menos undersampling que esconder).
export function blurStepSize(quality) {
  return Math.min(Math.max(6 - quality, 1), 4);
}

// Construye el bloque de #define que se antepone a los shaders segun
// las flags activas y la calidad elegida (ver 6.7, atmosphere-stage.js).
export function buildShaderDefines({ advanced, quality, volumetric, realtime, retro }) {
  const q = CLOUD_QUALITY_LEVELS[quality] ?? CLOUD_QUALITY_LEVELS[4];
  let defs = '';
  if (advanced) defs += '#define ADVANCED_ATMOSPHERE\n';
  if (retro) defs += '#define RETRO\n';
  if (realtime) defs += '#define REALTIME_CLOUDS\n';
  if (volumetric) defs += '#define VOLUMETRIC_CLOUDS\n';
  defs += `#define QUALITY_${quality}\n`;
  defs += `#define PRIMARY_STEPS ${q.primarySteps}\n`;
  defs += `#define LIGHT_STEPS ${q.lightSteps}\n`;
  defs += `#define CLOUDS_MAX_LOD ${q.maxLod}\n`;
  defs += `#define CLOUDS_MARCH_STEP ${q.marchStep.toFixed(1)}\n`;
  defs += `#define CLOUDS_DENS_MARCH_STEP ${q.densMarchStep.toFixed(1)}\n`;
  defs += `#define MAXIMUM_CLOUDS_STEPS ${q.maxSteps}\n`;
  defs += `#define DISTANCE_QUALITY_RATIO ${q.distanceQualityRatio}\n`;
  if (q.shadows) defs += '#define CLOUD_SHADOWS\n';
  return defs;
}
