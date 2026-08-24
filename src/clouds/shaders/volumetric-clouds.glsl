// ============================================================================
// PARTE 6.3 — volumetricCloudsFS.glsl
//
// Requiere atmosphere-common.glsl concatenado antes (raySphereIntersect,
// noise, cloudDensity, Schlick/isotropic) y calculate_scattering() de
// atmosphereOnlyFS.glsl (PARTE 7) para la atmosfera detras de la primera
// nube. Los #define de calidad (MAXIMUM_CLOUDS_STEPS, CLOUDS_MARCH_STEP,
// etc.) los antepone buildShaderDefines() en JS (ver ../constants.js).
//
// Idea central: la mayoria del cielo esta VACIO. Se marcha rapido
// (longStep, 500-1000 m/paso) hasta que la densidad supera 0.01; en ese
// momento se RETROCEDE un paso largo y se pasa a marcha fina (shortStep,
// 100-200 m) para integrar scattering con precision. Al salir de la nube
// se esperan `nApproach` pasos finos antes de volver a paso largo, para
// no generar flicker en los bordes (histeresis barata).
// ============================================================================

#define CLOUDS_MAX_VIEWING_DISTANCE 250000.0

// start = posicion de camara en ECEF, dir = direccion del rayo del pixel,
// maxDistance = distancia hasta el terreno/skybox en este pixel (depth),
// light_dir = direccion hacia el sol, wind = vector de adveccion ya
// escalado por czm_frameNumber (ver atmosphere-common.glsl).
//
// Devuelve vec4: rgb = luz acumulada (inscatter front-to-back), a =
// OPACIDAD (no transmitancia: se invierte al final, ver ultima linea).
vec4 calculate_clouds(vec3 start, vec3 dir, float maxDistance, vec3 light_dir, vec3 wind) {
  vec4 cloud = vec4(0.0, 0.0, 0.0, 1.0);     // rgb = inscatter, a = transmittance (por ahora)
  vec2 toTop  = raySphereIntersect(start, dir, cloudTopRadius);
  vec2 toBase = raySphereIntersect(start, dir, cloudBaseRadius);
  float startHeight = length(start) - realPlanetRadius;
  float tmin = 10.0;
  float tmax = maxDistance;

  // 6.3 Entrada/salida de la cascara, segun donde este la camara respecto
  // a la capa [cloudBase, cloudTop]. Siempre tmin >= 10 m (no queremos
  // "nubes" pegadas al cristal del cockpit) y tmax <= distancia de vista.
  if (startHeight > cloudTop) {
    if (toTop.x < 0.0) return vec4(0.0);
    tmin = toTop.x;
    tmax = (toBase.x > 0.0) ? min(toBase.x, maxDistance) : min(toTop.y, maxDistance);
  } else if (startHeight < cloudBase) {
    tmin = toBase.y;
    tmax = min(toTop.y, maxDistance);
  } else {
    tmax = (toBase.x > 0.0) ? min(toBase.x, maxDistance) : min(toTop.y, maxDistance);
  }
  tmin = max(tmin, 10.0);
  tmax = min(tmax, CLOUDS_MAX_VIEWING_DISTANCE);
  if (tmax < tmin) return vec4(0.0);

  float rayLength = tmax - tmin;
  float longStep  = max(rayLength / float(MAXIMUM_CLOUDS_STEPS), CLOUDS_MARCH_STEP);
  float shortStep = CLOUDS_DENS_MARCH_STEP;
  float nApproach = (CLOUDS_MARCH_STEP / CLOUDS_DENS_MARCH_STEP) * 2.0;

  // Dither temporal con blue noise: rompe el banding de planos paralelos
  // a la camara (pasos de marcha constantes generarian anillos visibles).
  float dither = texture(noiseTexture, mod(gl_FragCoord.xy / 512.0, 1.0)).r * 2.0 - 1.0;
  float dist = tmin + dither * shortStep;

  float kIn = 0.99;
  float mu  = dot(dir, light_dir);
  float inScattering  = Schlick(kIn, mu);
  float outScattering = 0.07957747154;               // 1/(4pi), isotropico
  float sunPhase      = mix(outScattering, inScattering, mu);
  float ambPhase      = outScattering;

  bool inCloud = false;
  bool rayDone = false;
  float stepsBeforeExit = 0.0;
  float lastDensity = 0.0;
  float distanceToFirstCloud = 0.0;

  for (int i = 0; i < MAXIMUM_CLOUDS_STEPS; i++) {
    vec3 pos = start + dir * dist;
    int lod = inCloud ? (CLOUDS_MAX_LOD - int(dist * DISTANCE_QUALITY_RATIO)) : 0;
    float march = inCloud ? shortStep : longStep;
    float heightRatio;
    float dens = cloudDensity(pos, wind, lod, heightRatio);

    if (dens > 0.01) {
      if (!inCloud) {
        // Primer hit: se retrocede un paso largo para no "cortar" el
        // borde de entrada de la nube y se conmuta a marcha fina.
        inCloud = true;
        stepsBeforeExit = nApproach;
        dist = clamp(dist - CLOUDS_MARCH_STEP, tmin, tmax);
        continue;
      }
      // Iluminacion local SIN ray march hacia el sol (seria carisimo):
      // se compara el GRADIENTE de densidad a lo largo del rayo con mu.
      // Si la densidad crece hacia el sol, estamos en la cara oscura.
      // Es una aproximacion barata que se ve razonablemente bien.
      float dDens = clamp((dens - lastDensity) * 10.0, -1.0, 1.0);
      float lighting = (abs(dDens - mu) / 2.0) * clamp((heightRatio - 0.02) * 20.0, 0.5, 1.0);
      lastDensity = dens;

      float scatterC = 0.25 * dens;
      float extinctC = 0.01 * dens;
      cloud.a *= exp(-extinctC * march);                 // Beer-Lambert

      float sunAtSurface = clamp(0.2 - dens, 0.0, 1.0);
      vec3 sunLight = lighting * czm_lightColor * sunAtSurface * czm_lightColor.z;
      vec3 ambSun   = czm_lightColor * sunAtSurface * czm_lightColor.z * ambPhase;
      vec3 skyAmb   = vec3(0.705, 0.850, 0.952) * czm_lightColor.z + ambSun;
      vec3 gndAmb   = vec3(0.5, 0.55, 0.5) * czm_lightColor.z * 0.5 + ambSun;
      // heightRatio apaga la base: nubes mas oscuras abajo, por auto-sombra
      // (como en la realidad, sin tener que raymarchear luz interna).
      vec3 ambient  = mix(gndAmb, skyAmb, heightRatio);

      vec3 stepScat = scatterC * march * (sunPhase * sunLight + ambPhase * ambient);
      cloud.rgb += cloud.a * stepScat;                   // composicion front-to-back

      if (cloud.a < 0.01) { cloud.a = 0.0; break; }
      if (distanceToFirstCloud == 0.0) distanceToFirstCloud = dist;
    } else {
      // Histeresis de salida: espera stepsBeforeExit pasos finos antes de
      // volver a marcha larga, para no parpadear en el borde de la nube.
      if (stepsBeforeExit > 0.0) stepsBeforeExit--;
      else inCloud = false;
    }

    dist += march;
    if (dist > tmax) {
      if (rayDone) break;
      rayDone = true;
      dist = tmax;
    }
  }

  // Atmosfera SOLO hasta la primera nube (no hasta el fondo): si se
  // integrara hasta tmax, una nube cercana se veria azulada como si
  // estuviera a 100 km de distancia.
  vec4 atmo = calculate_scattering(czm_viewerPositionWC, dir, distanceToFirstCloud, light_dir) * 0.2;
  cloud.rgb = cloud.rgb * (1.0 - atmo.a) + atmo.rgb;
  cloud.a = 1.0 - cloud.a;                               // transmittance -> opacidad
  return cloud;
}
