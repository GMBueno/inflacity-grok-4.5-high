import * as THREE from 'three';
import {
  createTerrain,
  createWater,
  updateWater,
  createBridge,
  createRoads,
  createPark,
  WORLD,
} from './world/terrain.js';
import { createVegetation, createClouds, updateClouds } from './world/vegetation.js';
import { createWorldDetails, updateWorldDetails } from './world/details.js';
import { createBuildings } from './buildings.js';
import { GameCamera } from './systems/camera.js';
import { LightingSystem, updateStreetLights } from './systems/lighting.js';
import { formatMonth, formatPct } from './utils.js';

function formatFloors(n) {
  if (n == null || Number.isNaN(n)) return '—';
  // show one decimal when not near-integer (e.g. 11.5)
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

// ─── Bootstrap ───────────────────────────────────────────────
let canvas = document.getElementById('c');
const loaderEl = document.getElementById('loader');
const loaderFill = document.getElementById('loader-fill');

function setLoad(p) {
  if (loaderFill) loaderFill.style.width = `${Math.round(p * 100)}%`;
}

/**
 * Try WebGL configs from preferred → more compatible.
 * First attempt keeps high-performance + antialias so machines that already
 * work well stay on the discrete GPU when available. Fallbacks only run if
 * that fails (dual-GPU glitches, software path, etc.).
 * Returns { renderer, canvas } — canvas may be replaced after failed attempts.
 */
function createRenderer(startCanvas) {
  const attempts = [
    {
      antialias: true,
      powerPreference: 'high-performance',
      failIfMajorPerformanceCaveat: false,
    },
    {
      antialias: true,
      powerPreference: 'default',
      failIfMajorPerformanceCaveat: false,
    },
    {
      antialias: false,
      powerPreference: 'default',
      failIfMajorPerformanceCaveat: false,
    },
    {
      antialias: false,
      powerPreference: 'low-power',
      failIfMajorPerformanceCaveat: false,
    },
  ];
  let lastError = null;
  // Fresh canvas per attempt: a failed getContext can "poison" the element.
  let canvasEl = startCanvas;
  for (let i = 0; i < attempts.length; i++) {
    const opts = attempts[i];
    if (i > 0) {
      const next = document.createElement('canvas');
      next.id = canvasEl.id || 'c';
      canvasEl.replaceWith(next);
      canvasEl = next;
    }
    try {
      const r = new THREE.WebGLRenderer({
        canvas: canvasEl,
        alpha: false,
        stencil: false,
        depth: true,
        ...opts,
      });
      if (r.getContext()) return { renderer: r, canvas: canvasEl };
      r.dispose();
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('WebGL unavailable');
}

function isSoftwareGL(renderer) {
  try {
    const gl = renderer.getContext();
    const info = renderer.extensions?.get?.('WEBGL_debug_renderer_info');
    if (!info) return false;
    const name = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) || '');
    return /swiftshader|llvmpipe|softpipe|microsoft basic render|software/i.test(
      name,
    );
  } catch {
    return false;
  }
}

function showWebGLError(err) {
  console.error(err);
  const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const isWin = /Win/.test(navigator.platform || navigator.userAgent);
  const steps = isMac
    ? [
        'Abra o Chrome/Edge → <strong>Configurações → Sistema</strong>',
        'Ative <strong>“Usar aceleração de hardware quando disponível”</strong>',
        'Reinicie o navegador e recarregue esta página',
      ]
    : isWin
      ? [
          'Chrome/Edge → <strong>Configurações → Sistema</strong>',
          'Ative <strong>“Usar aceleração de hardware quando disponível”</strong>',
          'Atualize o driver da placa de vídeo (ou tente outro navegador)',
          'Reinicie o navegador e recarregue esta página',
        ]
      : [
          'Nas configurações do navegador, ative <strong>aceleração de hardware</strong>',
          'Atualize o driver da GPU, se possível',
          'Tente Chrome, Firefox ou Edge atualizados',
        ];

  loaderEl.classList.remove('done');
  loaderEl.innerHTML = `
    <div class="loader-inner webgl-error">
      <div class="loader-skyline" aria-hidden="true"></div>
      <h1>WebGL indisponível</h1>
      <p>
        Esta visualização 3D precisa de <strong>WebGL</strong> no navegador.
        No seu dispositivo o contexto gráfico está desligado
        (comum com aceleração de hardware desativada).
      </p>
      <ol>
        ${steps.map((s) => `<li>${s}</li>`).join('')}
      </ol>
      <p class="webgl-error-note">
        Sites não conseguem religar o WebGL sozinhos — isso é uma opção do
        navegador/sistema. Depois de ativar, esta página funciona sem passos extras.
      </p>
      <button type="button" class="webgl-retry" id="webgl-retry">Tentar de novo</button>
    </div>
  `;
  document.getElementById('webgl-retry')?.addEventListener('click', () => {
    window.location.reload();
  });
}

let renderer;
let scene;
let camera;
let gameCam;
let lighting;

try {
  ({ renderer, canvas } = createRenderer(canvas));
  // Cap DPR for stable 60fps on retina; software GL stays lighter
  const soft = isSoftwareGL(renderer);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, soft ? 1 : 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = !soft;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.info.autoReset = true;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87b0d0);

  camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    0.5,
    600,
  );

  gameCam = new GameCamera(camera, canvas);
  lighting = new LightingSystem(scene, renderer);
} catch (err) {
  showWebGLError(err);
}

// ─── State ───────────────────────────────────────────────────
const state = {
  data: null,
  buildings: [],
  monthIndex: 0,
  mode: 'cumulative', // cumulative | rolling12
  city: 'groups',
  period: 'afternoon',
  selected: null,
  hovered: null,
};

// ─── Load data & build world ─────────────────────────────────
async function init() {
  setLoad(0.1);
  const res = await fetch(`${import.meta.env.BASE_URL}data/ipca.json`);
  state.data = await res.json();
  setLoad(0.25);

  createTerrain(scene);
  setLoad(0.4);
  state.water = createWater(scene);
  createBridge(scene);
  createRoads(scene);
  createPark(scene);
  setLoad(0.55);
  createVegetation(scene);
  createClouds(scene);
  state.details = createWorldDetails(scene);
  setLoad(0.7);

  state.buildings = createBuildings(scene, state.data);
  setLoad(0.85);

  // City nameplates floating
  createCitySigns(scene);

  // Init UI
  setupUI();
  state.monthIndex = state.data.months.length - 1;
  applyMonth();
  setLoad(1);

  requestAnimationFrame(() => {
    loaderEl.classList.add('done');
  });

  // Start loop — target ~60fps
  let last = performance.now();
  let streetLightCached = -1;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    update(dt);
    // Street lights only when intensity bucket changes
    const li = lighting.streetLightIntensity || 0;
    if (Math.abs(li - streetLightCached) > 0.03) {
      streetLightCached = li;
      updateStreetLights(scene, li);
    }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function createCitySigns(scene) {
  const makeSign = (text, position, color) => {
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, 512, 128);
    // plate
    ctx.fillStyle = 'rgba(10,16,28,0.72)';
    roundRect(ctx, 20, 24, 472, 80, 18);
    ctx.fill();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    roundRect(ctx, 20, 24, 472, 80, 18);
    ctx.stroke();
    ctx.font = '600 36px DM Sans, system-ui, sans-serif';
    ctx.fillStyle = '#f2f4f8';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 64);

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      opacity: 0.92,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.position.copy(position);
    sprite.scale.set(28, 7, 1);
    scene.add(sprite);
    return sprite;
  };

  makeSign('Cidade dos Grupos', new THREE.Vector3(WORLD.groupsCenter.x, 22, WORLD.groupsCenter.z - 28), '#5eead4');
  makeSign('Cidade dos Selecionados', new THREE.Vector3(WORLD.itemsCenter.x, 24, WORLD.itemsCenter.z - 36), '#fbbf24');
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ─── UI ──────────────────────────────────────────────────────
const tooltip = document.getElementById('tooltip');
const card = document.getElementById('card');
const tlSlider = document.getElementById('tl-slider');
const tlNow = document.getElementById('tl-now');
const tlMin = document.getElementById('tl-min');
const tlMax = document.getElementById('tl-max');

function setupUI() {
  const months = state.data.months;
  tlSlider.min = 0;
  tlSlider.max = months.length - 1;
  tlSlider.value = months.length - 1;
  tlMin.textContent = formatMonth(months[0]);
  tlMax.textContent = formatMonth(months[months.length - 1]);
  tlNow.textContent = formatMonth(months[months.length - 1]);

  tlSlider.addEventListener('input', () => {
    state.monthIndex = Number(tlSlider.value);
    tlNow.textContent = formatMonth(months[state.monthIndex]);
    applyMonth();
    if (state.selected) showCard(state.selected);
  });

  document.querySelectorAll('#city-seg button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#city-seg button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.city = btn.dataset.city;
      gameCam.teleportTo(state.city);
    });
  });

  document.querySelectorAll('#time-seg button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#time-seg button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.period = btn.dataset.time;
      lighting.setPeriod(state.period);
      const night = state.period === 'night';
      state.buildings.forEach((b) => b.setNight(night));
    });
  });

  document.querySelectorAll('#mode-seg button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#mode-seg button').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      state.mode = btn.dataset.mode;
      applyMonth();
      if (state.selected) showCard(state.selected);
    });
  });

  document.getElementById('btn-reset').addEventListener('click', () => {
    gameCam.reset('overview');
  });

  document.getElementById('card-close').addEventListener('click', () => {
    hideCard();
  });

  // Raycasting
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pointerMoved = false;
  let downPos = { x: 0, y: 0 };

  canvas.addEventListener('pointerdown', (e) => {
    downPos = { x: e.clientX, y: e.clientY };
    pointerMoved = false;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y) > 4) pointerMoved = true;
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    const meshes = state.buildings.map((b) => b.bodyMesh);
    const hits = raycaster.intersectObjects(meshes, false);
    if (hits.length) {
      const b = hits[0].object.userData.building;
      if (state.hovered !== b) {
        if (state.hovered && state.hovered !== state.selected) state.hovered.setHighlight(false, false);
        state.hovered = b;
        b.setHighlight(true, b === state.selected);
      }
      showTooltip(b, e.clientX, e.clientY);
      canvas.style.cursor = 'pointer';
    } else {
      if (state.hovered && state.hovered !== state.selected) {
        state.hovered.setHighlight(false, false);
      }
      state.hovered = null;
      hideTooltip();
      canvas.style.cursor = 'grab';
    }
  });

  canvas.addEventListener('pointerup', (e) => {
    if (pointerMoved) return;
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    const meshes = state.buildings.map((b) => b.bodyMesh);
    const hits = raycaster.intersectObjects(meshes, false);
    if (hits.length) {
      const b = hits[0].object.userData.building;
      selectBuilding(b);
    } else {
      hideCard();
    }
  });

  window.addEventListener('resize', onResize);
}

function applyMonth() {
  state.buildings.forEach((b) => b.setFromMonth(state.monthIndex, state.mode));
}

function selectBuilding(b) {
  if (state.selected && state.selected !== b) {
    state.selected.setHighlight(false, false);
  }
  state.selected = b;
  b.setHighlight(true, true);
  showCard(b);
}

function showTooltip(b, x, y) {
  const v = b.getDisplayValue();
  const neg = v != null && v < 0;
  tooltip.innerHTML = `
    <div class="t-name">${b.data.name}</div>
    <div class="t-pct${neg ? ' neg' : ''}">${formatPct(v)} · ${formatFloors(b.floors)} andares</div>
  `;
  tooltip.classList.remove('hidden');
  const pad = 16;
  let left = x + 14;
  let top = y + 14;
  if (left + 200 > window.innerWidth) left = x - 200;
  if (top + 60 > window.innerHeight) top = y - 50;
  tooltip.style.left = `${Math.max(pad, left)}px`;
  tooltip.style.top = `${Math.max(pad, top)}px`;
}

function hideTooltip() {
  tooltip.classList.add('hidden');
}

function showCard(b) {
  const months = state.data.months;
  const v = b.getDisplayValue();
  const neg = v != null && v < 0;
  const r12 = b.data.rolling12[state.monthIndex];
  const monthly = b.data.monthly[state.monthIndex];

  // find first valid month for this series
  let firstIdx = 0;
  for (let i = 0; i < months.length; i++) {
    if (b.data.cumulative[i] != null) {
      firstIdx = i;
      break;
    }
  }

  document.getElementById('card-theme').style.background =
    `#${b.theme.accent.toString(16).padStart(6, '0')}`;
  document.getElementById('card-name').textContent = b.data.name;
  const pctEl = document.getElementById('card-pct');
  pctEl.textContent = formatPct(v);
  pctEl.classList.toggle('neg', neg);
  document.getElementById('card-floors').textContent = formatFloors(b.floors);
  document.getElementById('card-range').textContent =
    `${formatMonth(months[firstIdx])} → ${formatMonth(months[state.monthIndex])}`;
  document.getElementById('card-last').textContent = formatPct(monthly);
  document.getElementById('card-r12').textContent = formatPct(r12);
  card.classList.remove('hidden');
}

function hideCard() {
  if (state.selected) {
    state.selected.setHighlight(false, false);
    state.selected = null;
  }
  card.classList.add('hidden');
}

function onResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

// ─── Update ──────────────────────────────────────────────────
const clouds = () => scene.getObjectByName('clouds');
let elapsed = 0;

function update(dt) {
  elapsed += dt;
  gameCam.update(dt);
  lighting.update(dt);
  updateClouds(clouds(), dt);
  // water bob every other frame-ish is fine; keep cheap
  if ((elapsed * 60 | 0) % 2 === 0) updateWater(state.water, elapsed);
  updateWorldDetails(state.details, dt, elapsed, lighting.isNight);
  const buildings = state.buildings;
  for (let i = 0; i < buildings.length; i++) buildings[i].update(dt);
}

// ─── Go ──────────────────────────────────────────────────────
if (renderer) {
  init().catch((err) => {
    console.error(err);
    const p = loaderEl.querySelector('p');
    if (p) p.textContent = 'Erro ao carregar. Veja o console.';
  });
}
