# APENDICE C — Trampas y recetas de depuracion

Tabla y dos recetas de codigo transcritas del tutorial. Las funciones
reales (`debugContacts`, `logSubstep`) estan en
`src/debug/debug-utils.js`, ya probadas contra una corrida real del
simulador (ver `CHECKLIST.txt`, PARTE 12).

## Tabla de sintomas

| Sintoma | Causa mas probable | Arreglo |
|---|---|---|
| El avion explota al spawn | tile de terreno no cargado + colision en el primer frame | `getGuarantiedGroundAltitude` + `probeTerrain` 10 s |
| El avion flota 2 m | `startAltitude` mal / ruedas mal colocadas | mide el glTF, ajusta `collisionPoints.z` |
| El avion se hunde en la pista | SRTM sin flatten | `FlatRunwayTerrainProvider` |
| Rebote eterno en pista | `restitution > 0` o `stiffness` alto, o `dt` demasiado grande | `e=0`, `k~8`, `damping~0.4`, subpasos 10 ms |
| El avion gira al reves en roll | A/D invertidos o `tau` con un solo signo cambiado | A = roll negativo, NO toques solo un `cross()` |
| Cabeceo divergente | CG delante del 25% o hStab pequena | mueve CoM atras, sube area cola |
| No entra en perdida | `stalls:false` o `stallIncidence` 90 | 14-18 grados, `zeroLift` 20-24 |
| Techo de servicio ridiculo | `GM_RL` mal o `zeroThrustAltitude` bajo | verifica ISA a 11 km |
| Nubes planas en el horizonte | radio constante, no esfera | `raySphereIntersect` |
| Nubes atraviesan el suelo | `planetRadius` fijo, no local | medir `|ECEF|` cada segundo |
| Nubes en el cockpit | `minDistance < 10` | `tmin = max(tmin, 10)` |
| Banding de nubes | sin dither | blue noise * shortStep |
| Linea negra al ocaso | `d<0` en el rayo al sol | `if (d<=0) d=1` |
| Suelo negro bajo nubes | mask de sombra llega a 0 | `clamp(mask, 0.2, 1)` |
| IAS no coincide con el stall | `kias=ktas` | `IAS = TAS*sqrt(rho/rhoSL)` |
| Camara bajo tierra | `avoidGround` off o margin 0 | margin 0.5 m, ignore 100 m |
| Z-fight de la sombra | `shadowOffset` 0 | 0.1 m |
| Helice no genera viento | propwash 0 | `0.002 * rpm` como velocidad |
| Spin no aparece | un solo airfoil para las dos alas | dos alas, `forceSourcePoint` a +-2 m |
| Tile "salta" 40 m en vuelo | sin filtro `wrongAltitude` | 5 tries, threshold 10 m |
| `getHeight = undefined` | tile no cargado | `lastGroundAltitude` |
| `sampleHeight` golpea el avion | sample en el CG | offset 1e-4 grados |
| Mie pinta el sol en una loma | `allow_mie` true siempre | `allow_mie = maxDist > ray.y` |
| dt de 2 segundos al volver | sin clamp | `dtMs = min(dtMs, 100)` |
| Drift de rotacion a 1 h | Euler no ortonormal | `resetRotationMatrix` cada 10 s |

Donde este proyecto ya construyo el arreglo (no solo lo menciona), la
referencia esta en `CHECKLIST.txt`:

- `getGuarantiedGroundAltitude` + `probeTerrain` 10 s: PARTE 4.3/4.10.
- `FlatRunwayTerrainProvider`: PARTE 4.2.
- `e=0`/subpasos 10 ms: PARTE 4.8/PARTE 12 (`api.renderingSettings.physicsDeltaMs`).
- `raySphereIntersect`/dither/`tmin=max(tmin,10)`/`d<=0 => d=1`/`clamp(mask,0.2,1)`: PARTE 6/7 (shaders).
- `IAS = TAS*sqrt(rho/rhoSL)`: PARTE 5 (`aircraft/atmosphere.js` + `airfoils.js`).
- `avoidGround` margin/ignore: PARTE 10.2 (`camera.js`, `GROUND_AVOIDANCE_MARGIN`/`GROUND_AVOIDANCE_IGNORE`).
- `shadowOffset`: PARTE 4.11 (`ground-shadow.js`).
- propwash: PARTE 5.4 (`engines.js`).
- filtro `wrongAltitude`/5 tries/threshold 10 m: PARTE 4.3 (`ground-sampling.js`).
- `lastGroundAltitude`: PARTE 4.9 (`elevation-management.js`).
- `dtMs = min(dtMs, 100)`: PARTE 10.4 (`main-loop.js`).
- `resetRotationMatrix` periodico: PARTE 9.1 (`object3d.js`).

## Receta: visualizar collisionPoints

```javascript
import { debugContacts } from './src/debug/debug-utils.js';

debugContacts(aircraft, sim, debug); // debug = {placeProbe(lla, colorHex)}, opcional
```

Verde = punto en aire, rojo = en contacto, azul = suelo bajo el CG. Si el
azul esta 3 m sobre el verde, tu `startAltitude` o el modelo estan mal.

`debug` es opcional: sin el, `debugContacts` sigue devolviendo el array
de `{lla, color, contact}` (util en tests/consola sin una capa de render
real conectada — asi es como se probo en PARTE 12).

## Receta: log de un subpaso

```javascript
import { logSubstep } from './src/debug/debug-utils.js';

logSubstep(aircraft, sim, weather); // console.table + devuelve el objeto
```
