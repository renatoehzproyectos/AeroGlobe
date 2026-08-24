// ============================================================================
// TELEPORT UI — no forma parte del tutorial; capa HTML minima para
// escribir "lat, lon" (o un nombre de lugar) y teletransportar la
// aeronave ahi. Reusa app.flyTo(coords) tal cual (PARTE 4.10,
// makeFlyTo) -- MISMO formato de coords que bootstrap.js ya usa para el
// punto de partida: [lat, lon, alt, heading, isAbsolute, speedKnots].
// alt=0 + isAbsolute=false = "en tierra, altura la calcula el motor
// solo" (ver flyTo en elevation-management.js).
//
// Igual que touch-controls.js: pointerdown/up con stopPropagation() para
// no pelear con el listener de orbita de camara que esta colgado del
// MISMO contenedor (#view3d) -- ver nota extensa del fix anterior en
// touch-controls.js sobre por que esto es obligatorio, no cosmetico.
// ============================================================================

function makeEl(tag, styles, parent) {
  const el = document.createElement(tag);
  Object.assign(el.style, styles);
  if (parent) parent.appendChild(el);
  return el;
}

// Geocodificacion opcional via Nominatim (OpenStreetMap) si lo que se
// escribe no son dos numeros "lat, lon" -- asi "Palo Alto Airport" o
// "Paris" tambien funcionan, no solo coordenadas crudas. Sin API key,
// uso liviano (1 pedido por Enter/click), Nominatim lo tolera.
async function geocode(query) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('geocode http ' + res.status);
  const data = await res.json();
  if (!data || !data.length) throw new Error('sin resultados');
  return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon), label: data[0].display_name };
}

function parseLatLon(text) {
  const m = text.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,\s]\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = parseFloat(m[1]), lon = parseFloat(m[2]);
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

export function attachTeleportUI(app, containerEl) {
  containerEl.style.position = containerEl.style.position || 'relative';

  const box = makeEl('div', {
    position: 'absolute', left: '12px', top: '12px',
    display: 'flex', gap: '6px', zIndex: '20',
    fontFamily: 'sans-serif', fontSize: '13px',
    pointerEvents: 'auto', touchAction: 'none',
  }, containerEl);

  const input = makeEl('input', {
    width: '210px', padding: '8px 10px', borderRadius: '8px',
    border: '1px solid rgba(255,255,255,0.35)', outline: 'none',
    background: 'rgba(20,20,25,0.6)', color: '#fff',
  }, box);
  input.type = 'text';
  input.placeholder = 'lat, lon o un lugar (ej: Paris)';
  input.autocomplete = 'off';
  input.spellcheck = false;

  const button = makeEl('button', {
    padding: '8px 14px', borderRadius: '8px', cursor: 'pointer',
    border: '1px solid rgba(255,255,255,0.35)',
    background: 'rgba(120,200,255,0.55)', color: '#fff', fontWeight: '600',
  }, box);
  button.type = 'button';
  button.textContent = 'Ir';

  const status = makeEl('div', {
    position: 'absolute', left: '0', top: '42px',
    color: '#fff', background: 'rgba(20,20,25,0.6)',
    padding: '4px 8px', borderRadius: '6px', fontSize: '12px',
    display: 'none', maxWidth: '260px',
  }, box);

  function setStatus(text, isError) {
    status.textContent = text;
    status.style.display = text ? 'block' : 'none';
    status.style.color = isError ? '#ff9b9b' : '#fff';
  }

  // Evita que arrastrar/tipear dentro del input orbite la camara o
  // dispare atajos de teclado del simulador (W/S/A/D, etc. -- controls.js
  // escucha keydown/keyup en `document`, no en el input, asi que sin
  // esto escribir "Paris" tambien haria cabecear/alabear el avion).
  [box, input, button].forEach((el) => {
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('pointerup', (e) => e.stopPropagation());
    el.addEventListener('pointermove', (e) => e.stopPropagation());
  });
  input.addEventListener('keydown', (e) => e.stopPropagation());
  input.addEventListener('keyup', (e) => e.stopPropagation());

  async function go() {
    const text = input.value;
    if (!text.trim()) return;
    button.disabled = true;
    setStatus('Buscando...', false);
    try {
      let target = parseLatLon(text);
      let label = `${target ? target.lat.toFixed(4) : ''}, ${target ? target.lon.toFixed(4) : ''}`;
      if (!target) {
        const g = await geocode(text);
        target = { lat: g.lat, lon: g.lon };
        label = g.label;
      }
      // heading: mantiene el rumbo actual de la aeronave si existe,
      // si no, 0 (norte) -- no tiene sentido "resetear" el rumbo del
      // piloto solo por moverlo de lugar.
      const ac = app.aircraft && app.aircraft.instance;
      const heading = ac && ac.htr ? ac.htr[0] : 0;
      await app.flyTo([target.lat, target.lon, 0, heading, false, null]);
      setStatus(`Listo: ${label}`, false);
    } catch (err) {
      console.error('Teleport fallo:', err);
      setStatus('No se encontro ese lugar. Probá "lat, lon".', true);
    } finally {
      button.disabled = false;
    }
  }

  button.addEventListener('click', go);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });

  return function detach() {
    box.remove();
  };
}
