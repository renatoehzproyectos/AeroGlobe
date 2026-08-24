// ============================================================================
// PARTE 10.3 — INICIALIZAR EL GLOBO
//
// Transcripcion del tutorial, con la unica adaptacion de inyeccion de
// dependencias del proyecto: en vez de un `Cesium` global y un
// `initTerrain`/`SRTM_URL` implicitos, se reciben como parametros. La
// logica (requestRenderMode + loop propio para poder pausar sin gastar
// GPU, skybox, preRender -> frameCallbackWrapper) es identica a la del
// tutorial.
//
// api.frameCallbackWrapper: DEBE existir ANTES de llamar a initWorld
// (viewer.scene.preRender.addEventListener(api.frameCallbackWrapper) se
// engancha en la misma llamada) — ver main-loop.js, que es quien lo
// define. Orden de arranque tipico (ver tambien PARTE 12):
//   1. createMainLoop(deps) -> define api.frameCallbackWrapper
//   2. initWorld(...) -> crea el viewer y lo engancha
// ============================================================================

export function initWorld(deps, containerId) {
  const { api, sim, Cesium, initTerrain, SRTM_URL } = deps;

  const viewer = new Cesium.Viewer(containerId, {
    terrainProvider: undefined,            // lo pone initTerrain() mas abajo
    imageryProvider: false,
    baseLayerPicker: false,
    geocoder: false, homeButton: false, sceneModePicker: false,
    navigationHelpButton: false, animation: false, timeline: false,
    fullscreenButton: false, vrButton: false, infoBox: false,
    selectionIndicator: false,
    requestRenderMode: true,               // NO renderizar si nada cambia
    maximumRenderTimeChange: Infinity,
    useDefaultRenderLoop: false,           // loop propio, para pausar
    contextOptions: { webgl: { alpha: false, powerPreference: 'high-performance' } },
  });
  api.viewer = viewer;
  api.camera = viewer.camera;

  sim.renderLoop = function () {
    if (!sim.pause) viewer.render();
    requestAnimationFrame(sim.renderLoop);
  };
  sim.renderLoop();

  viewer.scene.skyBox = new Cesium.SkyBox({
    sources: {
      positiveX: 'images/skybox/px.png', negativeX: 'images/skybox/mx.png',
      positiveY: 'images/skybox/py.png', negativeY: 'images/skybox/my.png',
      positiveZ: 'images/skybox/pz.png', negativeZ: 'images/skybox/mz.png',
    },
  });
  viewer.scene.globe.depthTestAgainstTerrain = true;
  viewer.scene.globe.showWaterEffect = false;
  viewer.scene.preRender.addEventListener(api.frameCallbackWrapper);

  // BUGFIX (encontrado al integrar con Cesium real, ver bootstrap.js):
  // terrain-provider.js exporta `initTerrain(viewer, Cesium, srtmUrl, ...)`
  // -- CUATRO parametros con Cesium en el medio -- pero esta llamada solo
  // pasaba (viewer, SRTM_URL), dejando `Cesium` en el lugar de `srtmUrl`
  // y `srtmUrl` sin usar. Se corrige pasando Cesium explicitamente.
  if (initTerrain) initTerrain(viewer, Cesium, SRTM_URL);
  return viewer;
}
