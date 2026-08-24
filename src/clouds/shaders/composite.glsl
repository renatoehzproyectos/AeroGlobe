// ============================================================================
// PARTE 6.5 / 6.6 — atmosphereOnlyFS.glsl (composite final)
//
// Este es el PostProcessStage principal (fx.atmosphere.atmospherePostProcessStage,
// ver ../atmosphere-stage.js). Corre a resolucion completa, DESPUES del
// stage de nubes volumetricas (que corre a resolucion reducida y ya trae
// su propio blur). Aqui se componen: color de escena, fog volumetrico,
// sombra de nube sobre el terreno, atmosfera Rayleigh/Mie (PARTE 7),
// textura de nubes volumetricas, y tone mapping.
//
// Requiere atmosphere-common.glsl (raySphereIntersect, cloudDensity) y
// calculate_scattering() de PARTE 7 concatenados antes.
// ============================================================================

void main() {
  vec4 color = texture(colorTexture, v_textureCoordinates);
  float depth = texture(depthTexture, v_textureCoordinates).r;
  vec4 positionEC = czm_windowToEyeCoordinates(gl_FragCoord.xy, depth);
  vec4 worldCoordinate = czm_inverseView * positionEC;
  vec3 vWorldPosition = worldCoordinate.xyz / worldCoordinate.w;
  vec3 posToEye = vWorldPosition - czm_viewerPositionWC;
  vec3 direction = normalize(posToEye);
  vec3 lightDirection = normalize(czm_sunPositionWC);
  float distance = length(posToEye);
  float elevation;

  if (depth >= 1.0) {
    // Pixel de cielo (sin geometria): usa la elevacion de la CAMARA para
    // decidir el fog, y una distancia muy grande para que la atmosfera
    // se integre "hasta el infinito" sin el clamp de un arco de terreno.
    elevation = length(czm_viewerPositionWC) - realPlanetRadius;
    distance = max(distance, 1e7);
  } else {
    elevation = length(vWorldPosition) - realPlanetRadius;
  }

  // ---- Fog volumetrico (capa horizontal entre volumetricFogBottom/Top) ----
  float fragFog = clamp((volumetricFogTop - elevation) /
                        (volumetricFogTop - volumetricFogBottom), 0.0, 1.0)
                  * volumetricFogDensity * depth;
  color = mix(color, vec4(czm_lightColor, 1.0), clamp(fragFog, 0.0, 1.0));

#ifdef CLOUD_SHADOWS
  // 6.5 — Sombra de nube sobre el terreno: solo si hay geometria (depth<1)
  // y el sol esta razonablemente alto (evita sombras absurdas al ras del
  // horizonte). Un UNICO sample de densidad hacia el sol, lod 0 (barato:
  // nada de raymarch real, solo "hay nube en la vertical solar o no").
  if (depth < 1.0 && czm_lightColor.z > 0.15) {
    float baseDistance = 250000.0;
    vec2 toClouds = raySphereIntersect(vWorldPosition, -lightDirection, cloudBaseRadius);
    if (toClouds.x > 0.0 && toClouds.x < baseDistance) {
      vec3 position = vWorldPosition + (-lightDirection * toClouds.x);
      float hr;
      vec3 noWind = vec3(0.0);
      float dens = cloudDensity(position, noWind, 0, hr);
      // mask minimo 0.2: nunca dejar el suelo completamente negro bajo
      // una nube densa; es suficiente para leer la mancha de un
      // cumulonimbus sobre el campo.
      float mask = clamp(1.0 - dens * 2.0, 0.2, 1.0);
      color *= mask;
    }
  }
#endif

#ifdef ADVANCED_ATMOSPHERE
  // 6.6 — Atmosfera Rayleigh/Mie (PARTE 7) compuesta sobre la escena.
  vec4 atmosphereColor = calculate_scattering(
    czm_viewerPositionWC, direction, distance, lightDirection
  );
  color = atmosphereColor + color * (1.0 - atmosphereColor.a);

#ifdef VOLUMETRIC_CLOUDS
  // Textura precomputada por el stage de nubes (resolucion reducida +
  // blur, ver atmosphere-stage.js). *3.0 compensa la perdida de energia
  // de correr a baja resolucion y aplicar blur encima.
  vec4 clouds = texture(volumetricCloudsTexture, v_textureCoordinates);
  clouds.rgb *= 3.0;
  // Si la camara esta bajo la base de nubes, se requiere mas profundidad
  // de escena (0.9) para que un objeto lejano "tape" la nube -- evita ver
  // nubes flotando dentro de un bosque cercano. Si esta arriba, 0.5 basta.
  float depthMaskDistance = (length(czm_viewerPositionWC) < cloudBaseRadius) ? 0.9 : 0.5;
  color = mix(color, clouds, clouds.a * clouds.a *
              clamp((depth - depthMaskDistance) * 100.0, 0.0, 1.0));
#endif

  // Tone mapping tipo Reinhard/exposure simple. exposure=1.2 evita que
  // el cielo despejado sature a blanco puro cerca del sol.
  float exposure = 1.2;
  color = vec4(1.0 - exp(-exposure * color));
#endif

  // Fog de fondo (neblina general de la escena, independiente del fog
  // volumetrico de arriba: mas simple, basado solo en depth).
  color = mix(color, vec4(backgroundFogColor.rgb, 1.0), clamp(backgroundFogDensity * depth, 0.0, 1.0));
  gl_FragColor = color;
}
