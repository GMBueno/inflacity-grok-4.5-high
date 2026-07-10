import * as THREE from 'three';
import { getTheme, FLOOR_HEIGHT, BUILDING_FOOTPRINT, BLOCK_SPACING } from './themes.js';
import { WORLD, terrainHeight } from './world/terrain.js';
import { lerp } from './utils.js';

/** Base floors at 0% variation; +1 floor per +10% (no max height). */
export const BASE_FLOORS = 10;
export const PCT_PER_FLOOR = 10;

/**
 * floors = 10 + pct/10
 * 0% → 10 andares, 10% → 11, 100% → 20, sem teto máximo.
 */
export function valueToFloors(value, _mode) {
  if (value == null || Number.isNaN(value)) return BASE_FLOORS;
  return BASE_FLOORS + value / PCT_PER_FLOOR;
}

export function floorsToHeight(floors) {
  // allow sub-base for deflation, but keep a tiny visible stub
  return Math.max(FLOOR_HEIGHT * 0.5, floors * FLOOR_HEIGHT);
}

/**
 * Procedural window texture (canvas)
 */
const texCache = new Map();

function makeWindowTexture(theme, night = false) {
  const key = `${theme.body}_${night}`;
  if (texCache.has(key)) return texCache.get(key);

  const W = 128;
  const H = 256;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  const body = `#${theme.body.toString(16).padStart(6, '0')}`;
  const bodyDark = `#${theme.bodyDark.toString(16).padStart(6, '0')}`;
  const winLit = `#${theme.windowLit.toString(16).padStart(6, '0')}`;
  const winDark = `#${theme.windowDark.toString(16).padStart(6, '0')}`;
  const accent = `#${theme.accent.toString(16).padStart(6, '0')}`;

  // body
  const grad = ctx.createLinearGradient(0, 0, W, 0);
  grad.addColorStop(0, bodyDark);
  grad.addColorStop(0.5, body);
  grad.addColorStop(1, bodyDark);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // floor bands
  const floors = 16;
  const fh = H / floors;
  for (let f = 0; f < floors; f++) {
    const y = f * fh;
    // ledge
    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    ctx.fillRect(0, y, W, 2);
    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.fillRect(0, y + 2, W, 1);

    // windows 3 per floor
    const cols = 3;
    const ww = 18;
    const wh = fh * 0.48;
    for (let c = 0; c < cols; c++) {
      const x = 14 + c * ((W - 28) / cols);
      const lit = night ? Math.random() > 0.35 : Math.random() > 0.85;
      ctx.fillStyle = lit ? winLit : winDark;
      ctx.fillRect(x, y + fh * 0.28, ww, wh);
      // frame
      ctx.strokeStyle = accent;
      ctx.lineWidth = 1;
      ctx.globalAlpha = 0.35;
      ctx.strokeRect(x, y + fh * 0.28, ww, wh);
      ctx.globalAlpha = 1;
      if (lit && night) {
        ctx.fillStyle = 'rgba(255,240,180,0.25)';
        ctx.fillRect(x - 1, y + fh * 0.28 - 1, ww + 2, wh + 2);
      }
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  texCache.set(key, tex);
  return tex;
}

function makeNightWindowTexture(theme) {
  return makeWindowTexture(theme, true);
}

export class Building {
  /**
   * @param {object} data - { name, theme, monthly, cumulative, rolling12 }
   * @param {THREE.Vector3} position
   * @param {object} opts
   */
  constructor(data, position, opts = {}) {
    this.data = data;
    this.theme = getTheme(data.theme);
    this.group = new THREE.Group();
    this.group.position.copy(position);
    this.group.userData.building = this;
    this.group.name = data.name;

    this.footprint = opts.footprint || BUILDING_FOOTPRINT;
    this.floors = BASE_FLOORS;
    this.currentHeight = floorsToHeight(BASE_FLOORS);
    this.targetHeight = this.currentHeight;
    this.mode = 'cumulative';
    this.monthIndex = 0;
    this.selected = false;
    this.hovered = false;
    this.value = 0;
    this._needsHeightUpdate = true;

    this._buildBase();
    this._buildBody();
    this._buildRoof();
    this._buildProp();
    this._buildLabel();

    this.hitMesh = this.bodyMesh;
  }

  _buildBase() {
    const t = this.theme;
    const f = this.footprint;
    // plaza
    const plaza = new THREE.Mesh(
      new THREE.BoxGeometry(f + 2.4, 0.18, f + 2.4),
      new THREE.MeshStandardMaterial({ color: t.base, roughness: 0.88 }),
    );
    plaza.position.y = 0.09;
    plaza.receiveShadow = true;
    plaza.castShadow = true;
    this.group.add(plaza);
    this.plaza = plaza;

    // steps
    const step = new THREE.Mesh(
      new THREE.BoxGeometry(f + 1.2, 0.12, f + 1.2),
      new THREE.MeshStandardMaterial({ color: t.bodyDark, roughness: 0.85 }),
    );
    step.position.y = 0.22;
    step.castShadow = true;
    this.group.add(step);

    // ground ring accent
    const ring = new THREE.Mesh(
      new THREE.BoxGeometry(f + 2.8, 0.06, f + 2.8),
      new THREE.MeshStandardMaterial({
        color: t.accent,
        roughness: 0.7,
        emissive: t.accent,
        emissiveIntensity: 0.05,
      }),
    );
    ring.position.y = 0.03;
    this.group.add(ring);

    // entrance door + canopy
    const door = new THREE.Mesh(
      new THREE.BoxGeometry(f * 0.28, 1.15, 0.12),
      new THREE.MeshStandardMaterial({ color: t.bodyDark, roughness: 0.7, metalness: 0.1 }),
    );
    door.position.set(0, 0.28 + 0.55, f * 0.5 + 0.05);
    door.castShadow = true;
    this.group.add(door);
    const doorGlass = new THREE.Mesh(
      new THREE.BoxGeometry(f * 0.18, 0.55, 0.06),
      new THREE.MeshStandardMaterial({
        color: t.windowLit,
        emissive: t.windowLit,
        emissiveIntensity: 0.12,
        roughness: 0.25,
        metalness: 0.2,
      }),
    );
    doorGlass.position.set(0, 0.28 + 0.75, f * 0.5 + 0.1);
    this.group.add(doorGlass);
    const canopy = new THREE.Mesh(
      new THREE.BoxGeometry(f * 0.5, 0.1, 0.55),
      new THREE.MeshStandardMaterial({
        color: t.accent,
        roughness: 0.55,
        emissive: t.accent,
        emissiveIntensity: 0.08,
      }),
    );
    canopy.position.set(0, 0.28 + 1.35, f * 0.5 + 0.2);
    canopy.castShadow = true;
    this.group.add(canopy);
  }

  _buildBody() {
    const t = this.theme;
    const f = this.footprint;
    const h = this.currentHeight;

    // Clone cached textures so each building can set its own UV repeat
    const tex = makeWindowTexture(t, false).clone();
    tex.needsUpdate = true;
    tex.repeat.set(1, Math.max(1, h / (FLOOR_HEIGHT * 4)));

    const mat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.72,
      metalness: 0.08,
      color: 0xffffff,
      emissive: t.emissive || 0x000000,
      emissiveIntensity: t.emissiveIntensity || 0,
    });

    const body = new THREE.Mesh(new THREE.BoxGeometry(f, h, f), mat);
    body.position.y = 0.28 + h / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    body.userData.building = this;
    this.group.add(body);
    this.bodyMesh = body;
    this.bodyMat = mat;
    this.dayTex = tex;
    this.nightTex = makeNightWindowTexture(t).clone();
    this.nightTex.needsUpdate = true;

    // corner pillars
    const pillarMat = new THREE.MeshStandardMaterial({
      color: t.bodyDark,
      roughness: 0.7,
      metalness: 0.15,
    });
    const pw = 0.22;
    this.pillars = [];
    for (const [sx, sz] of [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(pw, h, pw), pillarMat);
      p.position.set(sx * (f * 0.5 - 0.05), 0.28 + h / 2, sz * (f * 0.5 - 0.05));
      p.castShadow = true;
      this.group.add(p);
      this.pillars.push(p);
    }

    // floor ledge rings (every few floors for depth)
    this.ledges = [];
    this.ledgeMat = new THREE.MeshStandardMaterial({
      color: t.accent,
      roughness: 0.55,
      metalness: 0.2,
      emissive: t.accent,
      emissiveIntensity: 0.04,
    });
  }

  _ensureLedges() {
    if (this.ledges.length) return;
    const f = this.footprint;
    // Fixed set of 4 ledges, repositioned by height (no per-frame mesh thrash)
    for (let i = 0; i < 4; i++) {
      const ledge = new THREE.Mesh(
        new THREE.BoxGeometry(f + 0.25, 0.1, f + 0.25),
        this.ledgeMat,
      );
      ledge.castShadow = false;
      ledge.receiveShadow = false;
      this.group.add(ledge);
      this.ledges.push(ledge);
    }
  }

  _placeLedges(h) {
    this._ensureLedges();
    // space ledges evenly along the shaft
    for (let i = 0; i < this.ledges.length; i++) {
      const t = (i + 1) / (this.ledges.length + 1);
      this.ledges[i].position.y = 0.28 + h * t;
      this.ledges[i].visible = h > FLOOR_HEIGHT * 4;
    }
  }

  _buildRoof() {
    const t = this.theme;
    const f = this.footprint;
    this.roofGroup = new THREE.Group();
    this.group.add(this.roofGroup);

    const style = t.style;
    if (style === 'silo' || style === 'dairy' || style === 'utility') {
      const top = new THREE.Mesh(
        new THREE.CylinderGeometry(f * 0.48, f * 0.5, 0.5, 12),
        new THREE.MeshStandardMaterial({ color: t.roof, metalness: 0.4, roughness: 0.45 }),
      );
      top.castShadow = true;
      this.roofGroup.add(top);
      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(f * 0.42, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: t.accent, metalness: 0.5, roughness: 0.35 }),
      );
      dome.position.y = 0.35;
      this.roofGroup.add(dome);
    } else if (style === 'hospital' || style === 'school') {
      const top = new THREE.Mesh(
        new THREE.BoxGeometry(f + 0.3, 0.35, f + 0.3),
        new THREE.MeshStandardMaterial({ color: t.roof, roughness: 0.7 }),
      );
      top.castShadow = true;
      this.roofGroup.add(top);
      // parapet
      const parapet = new THREE.Mesh(
        new THREE.BoxGeometry(f + 0.45, 0.45, f + 0.45),
        new THREE.MeshStandardMaterial({ color: t.bodyDark, roughness: 0.75 }),
      );
      parapet.position.y = 0.3;
      // hollow-ish via scale - just solid block slightly inset top
      this.roofGroup.add(parapet);
    } else if (style === 'power' || style === 'tech') {
      const top = new THREE.Mesh(
        new THREE.BoxGeometry(f * 0.9, 0.4, f * 0.9),
        new THREE.MeshStandardMaterial({
          color: t.roof,
          metalness: 0.6,
          roughness: 0.3,
          emissive: t.accent,
          emissiveIntensity: 0.2,
        }),
      );
      this.roofGroup.add(top);
    } else if (style === 'station') {
      // canopy roof like gas station
      const canopy = new THREE.Mesh(
        new THREE.BoxGeometry(f + 1.6, 0.18, f + 1.2),
        new THREE.MeshStandardMaterial({
          color: t.accent,
          metalness: 0.3,
          roughness: 0.5,
          emissive: t.accent,
          emissiveIntensity: 0.15,
        }),
      );
      canopy.position.y = 0.2;
      canopy.castShadow = true;
      this.roofGroup.add(canopy);
    } else if (style === 'brewery' || style === 'cafe' || style === 'bakery') {
      // pitched roof
      const roof = new THREE.Mesh(
        new THREE.ConeGeometry(f * 0.72, 1.2, 4),
        new THREE.MeshStandardMaterial({ color: t.roof, roughness: 0.85, flatShading: true }),
      );
      roof.rotation.y = Math.PI / 4;
      roof.position.y = 0.5;
      roof.castShadow = true;
      this.roofGroup.add(roof);
    } else {
      // modern flat roof + AC units
      const top = new THREE.Mesh(
        new THREE.BoxGeometry(f + 0.2, 0.28, f + 0.2),
        new THREE.MeshStandardMaterial({ color: t.roof, roughness: 0.8 }),
      );
      top.castShadow = true;
      this.roofGroup.add(top);
      const ac = new THREE.Mesh(
        new THREE.BoxGeometry(0.7, 0.35, 0.5),
        new THREE.MeshStandardMaterial({ color: 0x9ca3af, metalness: 0.4, roughness: 0.5 }),
      );
      ac.position.set(f * 0.2, 0.35, f * 0.15);
      this.roofGroup.add(ac);
    }

    this._positionRoof(this.currentHeight);
  }

  _buildProp() {
    const t = this.theme;
    this.propGroup = new THREE.Group();
    this.roofGroup.add(this.propGroup);
    const prop = t.prop;
    const accentMat = new THREE.MeshStandardMaterial({
      color: t.accent,
      emissive: t.accent,
      emissiveIntensity: 0.35,
      metalness: 0.3,
      roughness: 0.45,
    });
    const darkMat = new THREE.MeshStandardMaterial({ color: t.roof, metalness: 0.4, roughness: 0.5 });

    if (prop === 'bolt') {
      // lightning bolt (energy)
      const bolt = new THREE.Group();
      const s1 = new THREE.Mesh(new THREE.BoxGeometry(0.25, 1.0, 0.12), accentMat);
      s1.position.set(0.1, 0.9, 0);
      s1.rotation.z = 0.35;
      const s2 = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.7, 0.12), accentMat);
      s2.position.set(-0.15, 0.35, 0);
      s2.rotation.z = -0.4;
      bolt.add(s1, s2);
      this.propGroup.add(bolt);
    } else if (prop === 'pump') {
      // gas pump
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.3, 0.45), darkMat);
      body.position.set(this.footprint * 0.55, 0.65, 0);
      const hose = new THREE.Mesh(
        new THREE.CylinderGeometry(0.04, 0.04, 0.9, 6),
        new THREE.MeshStandardMaterial({ color: 0x1c1917 }),
      );
      hose.position.set(this.footprint * 0.55 + 0.4, 0.9, 0);
      hose.rotation.z = 0.5;
      const sign = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.4, 0.12), accentMat);
      sign.position.set(0, 0.9, 0);
      this.propGroup.add(body, hose, sign);
    } else if (prop === 'cross') {
      const v = new THREE.Mesh(new THREE.BoxGeometry(0.35, 1.2, 0.2), accentMat);
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.35, 0.2), accentMat);
      v.position.y = 1.0;
      h.position.y = 1.15;
      this.propGroup.add(v, h);
    } else if (prop === 'plane') {
      const fuselage = new THREE.Mesh(
        new THREE.CylinderGeometry(0.12, 0.12, 1.6, 8),
        new THREE.MeshStandardMaterial({ color: 0xe0f2fe, metalness: 0.5, roughness: 0.35 }),
      );
      fuselage.rotation.z = Math.PI / 2;
      fuselage.position.y = 0.9;
      const wing = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 0.06, 0.35),
        new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.4, roughness: 0.4 }),
      );
      wing.position.y = 0.9;
      this.propGroup.add(fuselage, wing);
    } else if (prop === 'bus') {
      const bus = new THREE.Mesh(
        new THREE.BoxGeometry(1.4, 0.7, 0.6),
        new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.6 }),
      );
      bus.position.y = 0.7;
      this.propGroup.add(bus);
    } else if (prop === 'dish') {
      const dish = new THREE.Mesh(
        new THREE.SphereGeometry(0.55, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2),
        new THREE.MeshStandardMaterial({ color: 0xd1d5db, metalness: 0.7, roughness: 0.25 }),
      );
      dish.position.y = 0.55;
      dish.rotation.x = -0.6;
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.8, 6), darkMat);
      pole.position.y = 0.4;
      this.propGroup.add(dish, pole);
    } else if (prop === 'barrel') {
      const barrel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.35, 0.35, 0.7, 10),
        new THREE.MeshStandardMaterial({ color: 0x92400e, roughness: 0.8 }),
      );
      barrel.position.set(0.6, 0.55, 0.5);
      this.propGroup.add(barrel);
    } else if (prop === 'tank') {
      const tank = new THREE.Mesh(
        new THREE.CylinderGeometry(0.45, 0.45, 1.0, 12),
        new THREE.MeshStandardMaterial({ color: t.accent, metalness: 0.55, roughness: 0.35 }),
      );
      tank.position.y = 0.7;
      this.propGroup.add(tank);
    } else if (prop === 'clock') {
      const face = new THREE.Mesh(
        new THREE.CircleGeometry(0.45, 16),
        new THREE.MeshStandardMaterial({ color: 0xfffbeb, emissive: 0xfbbf24, emissiveIntensity: 0.15 }),
      );
      face.position.set(0, 0.7, this.footprint * 0.51);
      this.propGroup.add(face);
    } else if (prop === 'chimney') {
      const ch = new THREE.Mesh(
        new THREE.BoxGeometry(0.4, 1.1, 0.4),
        new THREE.MeshStandardMaterial({ color: 0x7c2d12, roughness: 0.9 }),
      );
      ch.position.set(0.8, 0.7, 0.8);
      this.propGroup.add(ch);
    } else if (prop === 'antenna' || prop === 'chip') {
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.6, 5), darkMat);
      ant.position.y = 0.9;
      const tip = new THREE.Mesh(
        new THREE.SphereGeometry(0.1, 8, 8),
        new THREE.MeshStandardMaterial({
          color: 0xf87171,
          emissive: 0xf87171,
          emissiveIntensity: 0.8,
        }),
      );
      tip.position.y = 1.7;
      this.propGroup.add(ant, tip);
    } else if (prop === 'fruit' || prop === 'grain' || prop === 'olive' || prop === 'nest' || prop === 'cup' || prop === 'bubble' || prop === 'soil' || prop === 'smoke' || prop === 'awning') {
      // decorative sphere cluster / awning
      if (prop === 'awning') {
        const aw = new THREE.Mesh(
          new THREE.BoxGeometry(this.footprint + 0.4, 0.12, 0.8),
          accentMat,
        );
        aw.position.set(0, 0.15, this.footprint * 0.55);
        this.propGroup.add(aw);
      } else {
        const ball = new THREE.Mesh(new THREE.SphereGeometry(0.35, 10, 8), accentMat);
        ball.position.y = 0.7;
        this.propGroup.add(ball);
      }
    } else {
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 8), accentMat);
      ball.position.y = 0.55;
      this.propGroup.add(ball);
    }
  }

  _buildLabel() {
    // sprite label shown on hover/select — created lazily via canvas
    this.labelSprite = null;
  }

  _positionRoof(h) {
    this.roofGroup.position.y = 0.28 + h;
  }

  setNight(isNight) {
    if (!this.bodyMat) return;
    const prev = this.bodyMat.map;
    const next = isNight ? this.nightTex : this.dayTex;
    if (prev && next) {
      next.repeat.copy(prev.repeat);
    }
    this.bodyMat.map = next;
    this.bodyMat.needsUpdate = true;
    this.bodyMat.emissiveIntensity = isNight
      ? (this.theme.emissiveIntensity || 0) + 0.15
      : this.theme.emissiveIntensity || 0;
  }

  setHighlight(hovered, selected) {
    this.hovered = hovered;
    this.selected = selected;
    const s = selected ? 1.04 : hovered ? 1.02 : 1;
    this.group.scale.set(s, 1, s);
    if (this.ledgeMat) {
      this.ledgeMat.emissiveIntensity = selected ? 0.45 : hovered ? 0.25 : 0.04;
    }
  }

  /**
   * Update target height from data
   */
  setFromMonth(monthIndex, mode) {
    this.monthIndex = monthIndex;
    this.mode = mode;
    const arr = mode === 'rolling12' ? this.data.rolling12 : this.data.cumulative;
    let value = arr[monthIndex];
    // find last valid if null
    if (value == null) {
      for (let i = monthIndex; i >= 0; i--) {
        if (arr[i] != null) {
          value = arr[i];
          break;
        }
      }
    }
    this.value = value ?? 0;
    this.floors = valueToFloors(this.value, mode);
    this.targetHeight = floorsToHeight(this.floors);
    this.monthlyValue = this.data.monthly[monthIndex];
    this._needsHeightUpdate = true;
  }

  update(dt) {
    if (!this._needsHeightUpdate && Math.abs(this.currentHeight - this.targetHeight) < 0.01) {
      return;
    }
    const k = 1 - Math.exp(-dt * 4.5);
    this.currentHeight = lerp(this.currentHeight, this.targetHeight, k);
    if (Math.abs(this.currentHeight - this.targetHeight) < 0.01) {
      this.currentHeight = this.targetHeight;
      this._needsHeightUpdate = false;
    }
    this._applyHeight(this.currentHeight);
  }

  _applyHeight(h) {
    const f = this.footprint;
    // rebuild body geometry scale (efficient)
    this.bodyMesh.scale.y = h / FLOOR_HEIGHT; // base geo was height FLOOR_HEIGHT? wait we used h at create
    // Actually body was created with `h` at construction — better replace scale from unit height
  }

  /** Call once after construction to use unit-height body for scaling */
  finalize() {
    // Recreate body with height=1 for easy scaling
    const t = this.theme;
    const f = this.footprint;
    this.group.remove(this.bodyMesh);
    this.bodyMesh.geometry.dispose();

    const tex = this.dayTex;
    const mat = this.bodyMat;
    const body = new THREE.Mesh(new THREE.BoxGeometry(f, 1, f), mat);
    body.position.y = 0.28 + 0.5;
    body.castShadow = true;
    body.receiveShadow = false;
    body.userData.building = this;
    this.group.add(body);
    this.bodyMesh = body;
    this.hitMesh = body;

    // pillars unit height
    this.pillars.forEach((p) => {
      this.group.remove(p);
      p.geometry.dispose();
    });
    this.pillars = [];
    const pillarMat = new THREE.MeshStandardMaterial({
      color: t.bodyDark,
      roughness: 0.7,
      metalness: 0.15,
    });
    const pw = 0.22;
    for (const [sx, sz] of [
      [-1, -1],
      [-1, 1],
      [1, -1],
      [1, 1],
    ]) {
      const p = new THREE.Mesh(new THREE.BoxGeometry(pw, 1, pw), pillarMat);
      p.position.set(sx * (f * 0.5 - 0.05), 0.28 + 0.5, sz * (f * 0.5 - 0.05));
      p.castShadow = false;
      this.group.add(p);
      this.pillars.push(p);
    }

    this._applyHeight = (h) => {
      const yScale = Math.max(0.4, h);
      this.bodyMesh.scale.y = yScale;
      this.bodyMesh.position.y = 0.28 + yScale / 2;
      for (let i = 0; i < this.pillars.length; i++) {
        const p = this.pillars[i];
        p.scale.y = yScale;
        p.position.y = 0.28 + yScale / 2;
      }
      // window texture repeat tracks floors (shared textures — set once per apply)
      if (this.bodyMat.map) {
        this.bodyMat.map.repeat.set(1, Math.max(1, h / (FLOOR_HEIGHT * 3.5)));
      }
      this._positionRoof(h);
      this._placeLedges(h);
    };

    this._applyHeight(this.currentHeight);
  }

  getDisplayValue() {
    return this.value;
  }
}

/** Layout buildings on a city grid with organic jitter */
export function layoutCity(items, center, cols) {
  const positions = [];
  const n = items.length;
  const c = cols || Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / c);
  const spacing = BLOCK_SPACING;
  const offsetX = ((c - 1) * spacing) / 2;
  const offsetZ = ((rows - 1) * spacing) / 2;

  items.forEach((item, i) => {
    const col = i % c;
    const row = Math.floor(i / c);
    // slight organic offset
    const jx = Math.sin(i * 2.1 + item.name.length) * 1.2;
    const jz = Math.cos(i * 1.7) * 1.1;
    const x = center.x + col * spacing - offsetX + jx;
    const z = center.z + row * spacing - offsetZ + jz;
    const y = Math.max(0, terrainHeight(x, z));
    positions.push(new THREE.Vector3(x, y, z));
  });
  return positions;
}

export function createBuildings(scene, data) {
  const buildings = [];

  // Groups city — 3x3
  const groupPos = layoutCity(data.groups, WORLD.groupsCenter, 3);
  data.groups.forEach((g, i) => {
    const b = new Building(g, groupPos[i], { footprint: 4.8 });
    b.finalize();
    b.city = 'groups';
    scene.add(b.group);
    buildings.push(b);
  });

  // Items city — ~5-6 columns
  const itemPos = layoutCity(data.items, WORLD.itemsCenter, 6);
  data.items.forEach((item, i) => {
    const b = new Building(item, itemPos[i], { footprint: 3.8 });
    b.finalize();
    b.city = 'items';
    scene.add(b.group);
    buildings.push(b);
  });

  return buildings;
}
