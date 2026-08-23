// ============================================================================
// PARTE 6.1 / 6.2 — atmosphereCommon.glsl
//
// Funciones compartidas por atmosphereOnlyFS.glsl (Rayleigh/Mie, PARTE 7)
// y volumetricCloudsFS.glsl (ray march de nubes, PARTE 6.3). Se concatena
// como texto ANTES de esos dos shaders al construir el PostProcessStage
// (ver ../atmosphere-stage.js: defAdv + defRet + defRt + defVol + defQ +
// common + <fs especifico>).
//
// Uniforms que este bloque asume disponibles (subidos desde JS, ver
// atmosphere-stage.js):
//   float planetRadius, realPlanetRadius, atmoRadiusSquared;
//   float cloudCover, cloudBase, cloudTop, cloudThickness, baseThickness;
//   float layer, cloudBaseRadius, cloudTopRadius;
//   vec3  windVector;
//   sampler2D coverageTexture;   // solo si REALTIME_CLOUDS
// ============================================================================

// --------------------------------------------------------------------------
// 6.1  Interseccion rayo-esfera
//
// r0 = origen del rayo en ECEF (czm_viewerPositionWC para la camara). rd =
// direccion del rayo del pixel. sr = radio de la esfera (planeta, capa de
// nube base, o capa de nube techo, segun para que se llame). Devuelve
// (tEntrada, tSalida); t<0 = interseccion detras del origen del rayo.
// --------------------------------------------------------------------------
vec2 raySphereIntersect(vec3 r0, vec3 rd, float sr) {
  float a = dot(rd, rd);
  float b = 2.0 * dot(rd, r0);
  float c = dot(r0, r0) - (sr * sr);
  float d = (b * b) - 4.0 * a * c;
  if (d < 0.0) return vec2(-1.0, -1.0);
  float sd = sqrt(d);
  return vec2((-b - sd) / (2.0 * a), (-b + sd) / (2.0 * a));
}

// --------------------------------------------------------------------------
// Fases de scattering. isotropic = 1/(4*pi): dispersion uniforme en todas
// direcciones (luz ambiente). Schlick(k=0.99, mu) es un lobulo MUY
// estrecho hacia el sol: produce el "silver lining" en el borde de un
// cumulus a contraluz. HenyeyGreenstein se deja disponible para PARTE 7
// (Mie de la atmosfera real), no se usa en el march de nubes.
// --------------------------------------------------------------------------
float isotropic() { return 0.07957747154594767; }          // 1/(4pi)

float Schlick(float k, float costh) {
  return (1.0 - k * k) / (12.5663706144 * pow(1.0 - k * costh, 2.0));
}

float HenyeyGreenstein(float g, float costh) {
  return (1.0 - g * g) / (12.5663706144 * pow(1.0 + g * g - 2.0 * g * costh, 1.5));
}

// --------------------------------------------------------------------------
// 6.2  Ruido de valor (value noise), base para la forma de las nubes.
// hash() es un hash escalar barato (Bourke-style). noise() interpola
// trilinear con suavizado Hermite (3 - 2f) para evitar artefactos de
// rejilla. No es Perlin gradiente: mas barato, suficientemente organico
// a la escala en que se usa (multiplicado por 0.3 / 0.05 / 1x, ver abajo).
// --------------------------------------------------------------------------
float hash(float p) {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

float noise(in vec3 x) {
  vec3 p = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);          // hermite
  float n = p.x + p.y * 157.0 + 113.0 * p.z;
  return mix(mix(mix(hash(n +   0.0), hash(n +   1.0), f.x),
                 mix(hash(n + 157.0), hash(n + 158.0), f.x), f.y),
             mix(mix(hash(n + 113.0), hash(n + 114.0), f.x),
                 mix(hash(n + 270.0), hash(n + 271.0), f.x), f.y), f.z);
}

// --------------------------------------------------------------------------
// 6.2  Densidad procedural de nubes en un punto p (ECEF).
//
// heightRatio: 0 en la base de la capa, 1 en el techo (se escribe en el
// parametro inout, lo usa el march para iluminacion local y para el
// perfil vertical).
//
// shapeHeight ALTO  -> cumulonimbus (torre, maximo en heightRatio=0.5)
// shapeHeight BAJO  -> stratocumulus (fino, maximo en heightRatio=0.12)
// Entre medio, cumulus (maximo en heightRatio=0.25).
//
// lod: 0 = solo 1 octava de detalle (nubes lejanas, o calidades bajas).
// >=1 = 2 octavas. El fbm es lo mas caro del shader; no subir a 5
// octavas, 2 basta para que no parezcan bolas lisas.
// --------------------------------------------------------------------------
float cloudDensity(vec3 p, vec3 wind, int lod, inout float heightRatio) {
  float finalCoverage = cloudCover;

#ifdef REALTIME_CLOUDS
  // Cobertura satelital en tiempo real (6.9): un canal de una textura
  // equirectangular NOAA/EUMETSAT proyectada sobre el elipsoide WGS84.
  // El umbral 0.4 y el *10 convierten un mapa suave en una mascara con
  // bordes razonablemente definidos.
  vec3 sphericalNormal = normalize(p);
  vec2 uv = czm_ellipsoidWgs84TextureCoordinates(sphericalNormal);
  float sampled = texture(coverageTexture, uv).r;
  float live = clamp((sampled - 0.4) * 10.0, 0.0, 1.0);
  finalCoverage *= live;
#endif

  if (finalCoverage <= 0.1) return 0.0;

  float height = length(p) - realPlanetRadius;
  heightRatio = (height - cloudBase) / cloudThickness;

  p = p * 0.002 + wind;                 // escala de mundo -> escala de ruido, + adveccion
  float shape = noise(p * 0.3);         // forma grande (silueta)
  float shapeHeight = noise(p * 0.05);  // elige el TIPO de nube (perfil vertical)

  float bn = 0.5 * noise(p); p *= 2.0;              // octava 1
  if (lod >= 1) { bn += 0.2 * noise(p); p *= 2.11; } // octava 2 (solo cerca / calidad alta)

  float cumuloNimbus = saturate((shapeHeight - 0.5) * 2.0);
  cumuloNimbus *= saturate(1.0 - pow(heightRatio - 0.5, 2.0) * 4.0);
  float cumulus = saturate(1.0 - pow(heightRatio - 0.25, 2.0) * 25.0) * shapeHeight;
  float stratoCumulus = saturate(1.0 - pow(heightRatio - 0.12, 2.0) * 60.0) * (1.0 - shapeHeight);

  float dens = saturate(stratoCumulus + cumulus + cumuloNimbus) * 2.0 * finalCoverage;
  dens -= 1.0 - shape;   // "erosiona" donde la forma grande no acompana
  dens -= bn;            // detalle fino
  return clamp(dens, 0.0, 1.0);
}

// Adveccion: fuera de este archivo, el llamador construye
//   wind = windVector * czm_frameNumber * 0.0002
// czm_frameNumber es el contador de frame de Cesium. 0.0002 a 60 fps
// equivale a ~0.012 unidades de ruido por segundo: las nubes "andan"
// visiblemente con el viento sin que el patron se repita rapido.

// ============================================================================
// PARTE 7 — ATMOSFERA RAYLEIGH / MIE
//
// calculate_scattering() se define ACA (no en atmosphereOnlyFS.glsl) porque
// dos consumidores distintos la necesitan, concatenados en dos shaders
// separados que solo comparten este archivo comun (ver atmosphere-stage.js:
// defines + common + atmoFS, y defines + common + cldFS):
//   - composite.glsl la usa (bajo #ifdef ADVANCED_ATMOSPHERE) para pintar
//     el cielo/horizonte completo detras de la escena.
//   - volumetric-clouds.glsl la usa SIN guardar con #ifdef, para integrar
//     la atmosfera solo hasta la primera nube (si no, una nube cercana se
//     veria azulada como si estuviera lejos).
// Por eso queda SIEMPRE definida aca, incondicional, en vez de encerrada
// en un #ifdef ADVANCED_ATMOSPHERE: si volumetric=true y advanced=false
// (nubes sin nuestro cielo custom), cldFS igual necesita el simbolo.
//
// Requiere los uniforms planetRadius / atmoRadiusSquared (subidos en
// atmosphere-stage.js, ver create()/update()).
// ============================================================================

vec3  light_intensity      = vec3(100.0);
vec3  beta_ray              = vec3(5.5e-6, 13.0e-6, 22.4e-6);  // Rayleigh RGB (azul)
vec3  beta_mie               = vec3(21e-6);                     // Mie (aerosoles, blanco)
vec3  beta_ambient          = vec3(0.0);
float atmosphere_g          = 0.9;                              // asimetria Mie (hacia adelante)
float height_ray            = 10e3;                             // escala de altura Rayleigh
float height_mie             = 3.2e3;                            // escala de altura Mie
float density_multiplier    = 4.0;                              // opacidad extra

// start = origen del rayo en ECEF (czm_viewerPositionWC). dir = direccion
// del rayo del pixel (normalizada). maxDistance = hasta donde integrar
// (distancia a la geometria de la escena, o 1e7 para pixeles de cielo sin
// geometria, ver composite.glsl). light_dir = direccion HACIA el sol
// (normalize(czm_sunPositionWC)).
//
// Devuelve vec4: rgb = luz de cielo acumulada (Rayleigh + Mie + ambiente),
// a = OPACIDAD (no transmitancia) para componer: color = atmosphere +
// scene * (1 - atmosphere.a).
vec4 calculate_scattering(vec3 start, vec3 dir, float maxDistance, vec3 light_dir) {
  // Interseccion con la esfera exterior de la atmosfera: si el rayo ni
  // siquiera toca la capa de aire, no hay nada que integrar.
  float a = dot(dir, dir);
  float b = 2.0 * dot(dir, start);
  float c = dot(start, start) - atmoRadiusSquared;
  float d = (b * b) - 4.0 * a * c;
  if (d < 0.0) return vec4(0.0);
  float sd = sqrt(d);
  vec2 ray_length = vec2(
    max((-b - sd) / (2.0 * a), 0.0),
    min((-b + sd) / (2.0 * a), maxDistance)
  );
  if (ray_length.x > ray_length.y) return vec4(0.0);

  // allow_mie: si el rayo GOLPEA el suelo/escena antes de salir al
  // espacio, no anadir el lobulo Mie (el disco del sol no debe pintarse
  // encima de una montana). Si escapa al espacio (maxDistance mas grande
  // que la salida de la atmosfera), si.
  bool allow_mie = maxDistance > ray_length.y;
  float step_size_i = (ray_length.y - ray_length.x) / float(PRIMARY_STEPS);
  float ray_pos_i = ray_length.x;
  vec3 total_ray = vec3(0.0);
  vec3 total_mie = vec3(0.0);
  vec2 opt_i = vec2(0.0);
  vec2 scale_height = vec2(height_ray, height_mie);

  // Fases de scattering evaluadas UNA vez (dependen solo de la geometria
  // rayo/sol, no de la posicion a lo largo del rayo). phase_ray usa la
  // aproximacion Rayleigh clasica; phase_mie usa Henyey-Greenstein con
  // asimetria atmosphere_g, escalada 3x cuando el lobulo Mie esta
  // permitido (si no, un termino isotropico chico evita un salto visible
  // al cruzar el horizonte de allow_mie).
  float mu = dot(dir, light_dir);
  float mumu = mu * mu;
  float gg = atmosphere_g * atmosphere_g;
  float phase_ray = 3.0 / 50.2654824574 * (1.0 + mumu);
  float phase_mie = (allow_mie ? 3.0 : 0.5) / 25.1327412287
                  * ((1.0 - gg) * (mumu + 1.0))
                  / (pow(1.0 + gg - 2.0 * mu * atmosphere_g, 1.5) * (2.0 + gg));

  // Marcha primaria a lo largo del rayo de la camara (PRIMARY_STEPS,
  // definido por buildShaderDefines() segun el nivel de calidad, ver
  // ../constants.js: CLOUD_QUALITY_LEVELS). En cada paso se acumula
  // densidad optica (opt_i) y se lanza una marcha SECUNDARIA hacia el sol
  // (LIGHT_STEPS) para saber cuanta luz sobrevive hasta ese punto.
  for (int i = 0; i < PRIMARY_STEPS; ++i) {
    vec3 pos_i = start + dir * (ray_pos_i + step_size_i);
    float height_i = length(pos_i) - planetRadius;
    vec2 density = exp(-height_i / scale_height) * step_size_i;
    opt_i += density;

    // Interseccion del rayo secundario (hacia el sol) con la esfera de
    // atmosfera: mismo discriminante que arriba, pero desde pos_i.
    a = dot(light_dir, light_dir);
    b = 2.0 * dot(light_dir, pos_i);
    c = dot(pos_i, pos_i) - atmoRadiusSquared;
    d = (b * b) - 4.0 * a * c;
    // d<=0 significa que el sol esta bajo el horizonte atmosferico visto
    // desde pos_i: forzar d=1.0 evita sqrt(negativo) -> NaN, que de otro
    // modo se propaga como una raya negra en el amanecer/atardecer.
    if (d <= 0.0) d = 1.0;
    float step_size_l = (-b + sqrt(d)) / (2.0 * a * float(LIGHT_STEPS));
    float ray_pos_l = 0.0;
    vec2 opt_l = vec2(0.0);
    for (int l = 0; l < LIGHT_STEPS; ++l) {
      vec3 pos_l = pos_i + light_dir * (ray_pos_l + step_size_l * 0.5);
      float height_l = length(pos_l) - planetRadius;
      opt_l += exp(-height_l / scale_height) * step_size_l;
      ray_pos_l += step_size_l;
    }

    // Atenuacion por Beer-Lambert acumulada en AMBAS marchas (camara->pos_i
    // y pos_i->sol): esto es lo que da el degrade azul->naranja->rojo del
    // atardecer (el camino hacia el sol se alarga y el azul se atenua mas
    // rapido que el rojo).
    vec3 attn = exp(-((beta_mie * (opt_i.y + opt_l.y)) + (beta_ray * (opt_i.x + opt_l.x))));
    total_ray += density.x * attn;
    total_mie += density.y * attn;
    ray_pos_i += step_size_i;
  }

  // Opacidad final: cuanta luz de la escena detras se deja pasar. A mas
  // densidad optica acumulada (mirando SOLO hacia la camara, opt_i, sin
  // el termino de luz opt_l), mas opaca la "cortina" de atmosfera.
  float opacity = length(exp(-((beta_mie * opt_i.y) + (beta_ray * opt_i.x)) * density_multiplier));
  return vec4(
    (phase_ray * beta_ray * total_ray + phase_mie * beta_mie * total_mie + opt_i.x * beta_ambient)
    * light_intensity,
    1.0 - opacity
  );
}
