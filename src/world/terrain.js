import * as THREE from 'three';
import { fbm, noise2, smoothstep, mulberry32 } from '../utils.js';

/**
 * Continuous map with:
 * - two organic city plateaus (groups west, items east)
 * - sinuous river + tributaries + ponds
 * - grass fields, sandy banks, hills, cliff edges
 */

export const WORLD = {
  size: 280,
  half: 140,
  // City centers
  groupsCenter: new THREE.Vector3(-48, 0, 0),
  itemsCenter: new THREE.Vector3(52, 0, 4),
  groupsRadius: 38,
  itemsRadius: 52,
  riverWidth: 10,
  floorY: 0,
};

/** Signed distance-ish river field: negative = in water */
export function riverField(x, z) {
  // Main sinuous river roughly along x≈0, flowing north-south with meanders
  const meander = Math.sin(z * 0.035) * 14 + Math.sin(z * 0.09 + 1.2) * 5;
  const cx = meander + 2;
  const distMain = Math.abs(x - cx);

  // Tributary from west hills
  const trib1z = z + 30;
  const trib1x = -40 + Math.sin(z * 0.05) * 8;
  const along1 = smoothstep(55, 5, Math.abs(z + 18));
  const distTrib1 = Math.hypot(x - trib1x, (z + 18) * 0.4) / (1 + along1 * 0.5);

  // Tributary toward items city (south-east)
  const distTrib2 = Math.hypot(x - 28, z - 42) * 0.9 - 6 + Math.sin(x * 0.08) * 2;

  // Ponds / lagoons
  const pond1 = Math.hypot(x + 18, z - 55) - 7;
  const pond2 = Math.hypot(x - 62, z + 48) - 6.5;
  const pond3 = Math.hypot(x + 55, z + 35) - 5; // park pond near groups
  const pond4 = Math.hypot(x - 20, z + 60) - 5.5;

  let d = distMain - WORLD.riverWidth * 0.5;
  d = Math.min(d, distTrib1 - 2.2);
  d = Math.min(d, distTrib2);
  d = Math.min(d, pond1, pond2, pond3, pond4);
  return d;
}

/** Organic city mask 0..1 */
export function cityMask(x, z, center, radius) {
  const dx = x - center.x;
  const dz = z - center.z;
  const ang = Math.atan2(dz, dx);
  // lobed organic outline
  const r =
    radius *
    (0.82 +
      0.12 * Math.sin(ang * 3 + 0.4) +
      0.08 * Math.sin(ang * 5 - 1.1) +
      0.05 * noise2(x * 0.04, z * 0.04));
  const dist = Math.hypot(dx, dz);
  return smoothstep(r + 6, r - 4, dist);
}

export function terrainHeight(x, z) {
  const river = riverField(x, z);
  const gMask = cityMask(x, z, WORLD.groupsCenter, WORLD.groupsRadius);
  const iMask = cityMask(x, z, WORLD.itemsCenter, WORLD.itemsRadius);
  const urban = Math.max(gMask, iMask);

  // Base rolling hills
  let h = fbm(x * 0.012, z * 0.012, 5) * 6.5;
  h += fbm(x * 0.04 + 20, z * 0.04, 3) * 1.6;

  // Distant hills ring
  const distCenter = Math.hypot(x, z);
  const rim = smoothstep(90, 130, distCenter);
  h += rim * (8 + fbm(x * 0.02, z * 0.02, 3) * 10);

  // City plateaus flatten
  h = lerp(h, 0.15 + noise2(x * 0.2, z * 0.2) * 0.08, urban * 0.92);

  // River banks dig down
  if (river < 8) {
    const bank = smoothstep(8, 0, river);
    const waterBed = -1.35 - smoothstep(3, -2, river) * 0.9;
    h = lerp(h, waterBed, bank);
    // sandy shoulder slightly raised at bank edge
    if (river > 0 && river < 4) {
      h += Math.sin(((river - 0) / 4) * Math.PI) * 0.18;
    }
  }

  // Cliff edge near map border (terra / falésia)
  const edge = Math.max(Math.abs(x), Math.abs(z));
  const cliff = smoothstep(WORLD.half - 28, WORLD.half - 8, edge);
  if (cliff > 0) {
    h = lerp(h, -14 - fbm(x * 0.05, z * 0.05, 2) * 4, cliff);
  }

  return h;
}

function lerp(a, b, t) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

export function createTerrain(scene) {
  const size = WORLD.size;
  const segs = 112;
  const geo = new THREE.PlaneGeometry(size, size, segs, segs);
  geo.rotateX(-Math.PI / 2);

  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const color = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const y = terrainHeight(x, z);
    pos.setY(i, y);

    const river = riverField(x, z);
    const gMask = cityMask(x, z, WORLD.groupsCenter, WORLD.groupsRadius);
    const iMask = cityMask(x, z, WORLD.itemsCenter, WORLD.itemsRadius);
    const urban = Math.max(gMask, iMask);
    const edge = Math.max(Math.abs(x), Math.abs(z));
    const cliff = smoothstep(WORLD.half - 28, WORLD.half - 6, edge);
    const n = fbm(x * 0.08, z * 0.08, 3);

    // Base grass
    color.setRGB(0.28 + n * 0.08, 0.48 + n * 0.1, 0.22 + n * 0.05);

    // Dry grass variation
    if (n > 0.55) {
      color.lerp(new THREE.Color(0x8f9a4a), 0.25);
    }

    // City plaza / pavement tint
    if (urban > 0.15) {
      const pavement = new THREE.Color(0x6b7280);
      color.lerp(pavement, urban * 0.55);
      // plaza warmer tone near centers
      color.lerp(new THREE.Color(0x9ca3af), urban * 0.2);
    }

    // Sand banks
    if (river > 0 && river < 5.5) {
      const sandAmt = smoothstep(5.5, 1.2, river) * (1 - urban * 0.7);
      color.lerp(new THREE.Color(0xd6c49a), sandAmt * 0.85);
    }

    // Underwater bed (hidden by water mesh but edges show)
    if (river < 0) {
      color.setRGB(0.22, 0.32, 0.28);
    }

    // Cliff dirt / rock
    if (cliff > 0.05 || y < -2) {
      const rock = new THREE.Color(0x6b5344);
      const dirt = new THREE.Color(0x8b6914);
      color.lerp(rock, cliff * 0.8);
      if (y < -1) color.lerp(dirt, 0.4);
    }

    // Hill top greener
    if (y > 4 && urban < 0.1) {
      color.lerp(new THREE.Color(0x3d7a3a), 0.25);
    }

    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.92,
    metalness: 0.02,
    flatShading: false,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  scene.add(mesh);

  // Cliff skirt ring (extra vertical dirt wall for falésia look)
  createCliffSkirt(scene);

  return mesh;
}

function createCliffSkirt(scene) {
  const outer = WORLD.half + 2;
  const segs = 96;
  const positions = [];
  const colors = [];
  const indices = [];

  for (let i = 0; i <= segs; i++) {
    const t = (i / segs) * Math.PI * 2;
    // organic outline
    const r = outer + Math.sin(t * 3) * 4 + Math.cos(t * 5) * 2.5;
    const x = Math.cos(t) * r;
    const z = Math.sin(t) * r;
    const topY = terrainHeight(x * 0.92, z * 0.92);
    const botY = -18;

    const vi = i * 2;
    positions.push(x, topY + 0.5, z, x * 1.02, botY, z * 1.02);

    // dirt gradient
    colors.push(0.35, 0.42, 0.22, 0.42, 0.3, 0.18);

    if (i < segs) {
      const a = vi;
      const b = vi + 1;
      const c = vi + 2;
      const d = vi + 3;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0,
      side: THREE.DoubleSide,
    }),
  );
  mesh.receiveShadow = true;
  mesh.castShadow = true;
  scene.add(mesh);
}

export function createWater(scene) {
  const group = new THREE.Group();
  group.name = 'water';

  // Build a continuous water mesh from river-distance field samples
  const step = 2.4;
  const verts = [];
  const cols = [];
  const indices = [];
  const grid = new Map();
  const key = (ix, iz) => `${ix},${iz}`;

  const minI = Math.floor(-WORLD.half / step);
  const maxI = Math.ceil(WORLD.half / step);

  // Collect water cells
  const cells = [];
  for (let ix = minI; ix <= maxI; ix++) {
    for (let iz = minI; iz <= maxI; iz++) {
      const x = ix * step;
      const z = iz * step;
      const d = riverField(x, z);
      if (d < 2.4) cells.push([ix, iz, x, z, d]);
    }
  }

  // Create vertices for each cell corner (shared)
  function ensureVert(ix, iz) {
    const k = key(ix, iz);
    if (grid.has(k)) return grid.get(k);
    const x = ix * step;
    const z = iz * step;
    const d = riverField(x, z);
    const y = -0.32 + Math.min(0.15, Math.max(-0.2, -d * 0.04));
    const idx = verts.length / 3;
    verts.push(x, y, z);
    // color: deeper = darker blue
    const depth = smoothstep(2.5, -2, d);
    const r = lerp(0.15, 0.05, depth);
    const g = lerp(0.55, 0.28, depth);
    const b = lerp(0.65, 0.42, depth);
    cols.push(r, g, b);
    grid.set(k, idx);
    return idx;
  }

  for (const [ix, iz] of cells) {
    // only create quad if cell center is water-ish
    const a = ensureVert(ix, iz);
    const b = ensureVert(ix + 1, iz);
    const c = ensureVert(ix + 1, iz + 1);
    const d = ensureVert(ix, iz + 1);
    indices.push(a, b, c, a, c, d);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();

  // StandardMaterial is far cheaper than Physical+transmission
  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.22,
    metalness: 0.12,
    transparent: true,
    opacity: 0.82,
    side: THREE.DoubleSide,
    depthWrite: false,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 1;
  mesh.userData.waterMesh = true;
  group.add(mesh);

  // Soft foam / edge strips
  const foamMat = new THREE.MeshStandardMaterial({
    color: 0xb8dce8,
    transparent: true,
    opacity: 0.35,
    roughness: 1,
    depthWrite: false,
  });
  const foamPatches = [];
  for (const [ix, iz, x, z, d] of cells) {
    if (d > 0.2 && d < 2.0) foamPatches.push(x, z);
  }
  if (foamPatches.length) {
    const foamGeo = new THREE.PlaneGeometry(step * 1.1, step * 1.1);
    foamGeo.rotateX(-Math.PI / 2);
    const foam = new THREE.InstancedMesh(foamGeo, foamMat, foamPatches.length / 2);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < foamPatches.length; i += 2) {
      dummy.position.set(foamPatches[i], -0.22, foamPatches[i + 1]);
      dummy.updateMatrix();
      foam.setMatrixAt(i / 2, dummy.matrix);
    }
    foam.instanceMatrix.needsUpdate = true;
    foam.renderOrder = 2;
    group.add(foam);
  }

  scene.add(group);
  return group;
}

/** Gentle water bob animation (cheap — skip normal recompute) */
export function updateWater(group, t) {
  if (!group) return;
  const mesh = group.children.find((c) => c.userData.waterMesh);
  if (!mesh) return;
  // Bob whole mesh slightly for sparkle without per-vertex cost
  mesh.position.y = Math.sin(t * 0.9) * 0.03;
}

export function createBridge(scene) {
  const group = new THREE.Group();
  group.name = 'bridge';

  // Bridge crosses river near z=0 between cities
  const z = 2;
  const x0 = -18;
  const x1 = 22;
  const len = x1 - x0;
  const y = 0.55;

  // Deck
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(len, 0.35, 5.5),
    new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.75, metalness: 0.2 }),
  );
  deck.position.set((x0 + x1) / 2, y, z);
  deck.castShadow = true;
  deck.receiveShadow = true;
  group.add(deck);

  // Road surface
  const road = new THREE.Mesh(
    new THREE.BoxGeometry(len - 0.2, 0.06, 3.8),
    new THREE.MeshStandardMaterial({ color: 0x374151, roughness: 0.9 }),
  );
  road.position.set((x0 + x1) / 2, y + 0.2, z);
  group.add(road);

  // Center dashed line
  const lineMat = new THREE.MeshStandardMaterial({
    color: 0xfbbf24,
    emissive: 0xfbbf24,
    emissiveIntensity: 0.15,
    roughness: 0.6,
  });
  for (let i = 0; i < 10; i++) {
    const dash = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.04, 0.18), lineMat);
    dash.position.set(x0 + 2 + i * 3.6, y + 0.24, z);
    group.add(dash);
  }

  // Sidewalks
  const walkMat = new THREE.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.85 });
  for (const side of [-1, 1]) {
    const walk = new THREE.Mesh(new THREE.BoxGeometry(len, 0.2, 0.7), walkMat);
    walk.position.set((x0 + x1) / 2, y + 0.12, z + side * 2.4);
    walk.castShadow = true;
    group.add(walk);
  }

  // Railings
  const railMat = new THREE.MeshStandardMaterial({ color: 0xd1d5db, metalness: 0.6, roughness: 0.35 });
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(len, 0.12, 0.12), railMat);
    rail.position.set((x0 + x1) / 2, y + 1.1, z + side * 2.65);
    group.add(rail);
    for (let i = 0; i <= 16; i++) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.9, 0.12), railMat);
      post.position.set(x0 + (i / 16) * len, y + 0.7, z + side * 2.65);
      post.castShadow = true;
      group.add(post);
    }
  }

  // Stone piers
  const pierMat = new THREE.MeshStandardMaterial({ color: 0x78716c, roughness: 0.9 });
  for (const px of [x0 + 6, (x0 + x1) / 2, x1 - 6]) {
    const pier = new THREE.Mesh(new THREE.BoxGeometry(1.4, 2.2, 2.2), pierMat);
    pier.position.set(px, -0.4, z);
    pier.castShadow = true;
    pier.receiveShadow = true;
    group.add(pier);
  }

  // Arches (simple half-cylinders under deck)
  const archMat = new THREE.MeshStandardMaterial({ color: 0x8b8680, roughness: 0.88 });
  for (const px of [x0 + 12, x1 - 12]) {
    const arch = new THREE.Mesh(
      new THREE.TorusGeometry(2.2, 0.35, 8, 16, Math.PI),
      archMat,
    );
    arch.rotation.y = Math.PI / 2;
    arch.rotation.z = Math.PI;
    arch.position.set(px, y - 0.1, z);
    group.add(arch);
  }

  // Street lamps on bridge
  for (const px of [x0 + 4, (x0 + x1) / 2, x1 - 4]) {
    for (const side of [-1, 1]) {
      createLamp(group, px, y + 0.3, z + side * 2.5);
    }
  }

  scene.add(group);
  return group;
}

// Shared lamp materials (avoid unique materials per lamp)
const LAMP_POLE_MAT = new THREE.MeshStandardMaterial({ color: 0x374151, metalness: 0.5, roughness: 0.4 });
const LAMP_BULB_MAT = new THREE.MeshStandardMaterial({
  color: 0xfff7d6,
  emissive: 0xffd78a,
  emissiveIntensity: 0.6,
  roughness: 0.3,
});
const LAMP_POLE_GEO = new THREE.CylinderGeometry(0.06, 0.08, 2.4, 5);
const LAMP_ARM_GEO = new THREE.BoxGeometry(0.5, 0.06, 0.06);
const LAMP_BULB_GEO = new THREE.SphereGeometry(0.16, 6, 6);

/** Registry of bulb materials/meshes for cheap night updates (no PointLights). */
export const streetLampBulbs = [];

export function createLamp(parent, x, y, z) {
  const pole = new THREE.Mesh(LAMP_POLE_GEO, LAMP_POLE_MAT);
  pole.position.set(x, y + 1.2, z);
  pole.castShadow = false;
  parent.add(pole);

  const arm = new THREE.Mesh(LAMP_ARM_GEO, LAMP_POLE_MAT);
  arm.position.set(x + 0.15, y + 2.3, z);
  parent.add(arm);

  // Unique material clone only for emissive intensity control — use shared + track meshes
  const lamp = new THREE.Mesh(LAMP_BULB_GEO, LAMP_BULB_MAT);
  lamp.position.set(x + 0.35, y + 2.2, z);
  lamp.userData.isLamp = true;
  parent.add(lamp);
  streetLampBulbs.push(lamp);
  // No PointLight — dozens of lights destroy FPS; emissive + sun/moon is enough
}

/** Roads grid inside city footprints */
export function createRoads(scene) {
  const group = new THREE.Group();
  group.name = 'roads';

  const asphalt = new THREE.MeshStandardMaterial({
    color: 0x3f4550,
    roughness: 0.92,
    metalness: 0.05,
  });
  const lineMat = new THREE.MeshStandardMaterial({
    color: 0xf5f5f4,
    roughness: 0.7,
    emissive: 0xf5f5f4,
    emissiveIntensity: 0.05,
  });
  const yellowMat = new THREE.MeshStandardMaterial({
    color: 0xfbbf24,
    roughness: 0.65,
    emissive: 0xfbbf24,
    emissiveIntensity: 0.08,
  });
  const curbMat = new THREE.MeshStandardMaterial({ color: 0xa8a29e, roughness: 0.88 });

  const walkMat = new THREE.MeshStandardMaterial({ color: 0xb0a89c, roughness: 0.9 });

  function addRoadSegment(x1, z1, x2, z2, width = 3.2) {
    const dx = x2 - x1;
    const dz = z2 - z1;
    const len = Math.hypot(dx, dz);
    if (len < 0.1) return;
    const angle = Math.atan2(dx, dz);
    const midX = (x1 + x2) / 2;
    const midZ = (z1 + z2) / 2;
    const y = 0.08;

    const road = new THREE.Mesh(new THREE.BoxGeometry(width, 0.1, len + 0.2), asphalt);
    road.position.set(midX, y, midZ);
    road.rotation.y = angle;
    road.receiveShadow = true;
    road.castShadow = false;
    group.add(road);

    // curbs (both sides)
    for (const side of [-1, 1]) {
      const curb = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.18, len + 0.2), curbMat);
      curb.position.set(
        midX + Math.cos(angle) * side * (width * 0.5 + 0.1),
        y + 0.05,
        midZ - Math.sin(angle) * side * (width * 0.5 + 0.1),
      );
      curb.rotation.y = angle;
      curb.castShadow = false;
      group.add(curb);
    }

    // single continuous center line (not N dash meshes)
    const line = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.04, Math.max(0.5, len * 0.9)), yellowMat);
    line.position.set(midX, y + 0.07, midZ);
    line.rotation.y = angle;
    group.add(line);

    // sidewalks
    for (const side of [-1, 1]) {
      const walk = new THREE.Mesh(
        new THREE.BoxGeometry(1.1, 0.08, len + 0.2),
        walkMat,
      );
      walk.position.set(
        midX + Math.cos(angle) * side * (width * 0.5 + 0.85),
        y + 0.02,
        midZ - Math.sin(angle) * side * (width * 0.5 + 0.85),
      );
      walk.rotation.y = angle;
      walk.receiveShadow = true;
      walk.castShadow = false;
      group.add(walk);
    }
  }

  function cityGrid(center, radius, seed) {
    const rand = mulberry32(seed);
    const spacing = 14;
    const roads = [];
    // organic bounds: only draw if both ends somewhat in city
    for (let gx = -4; gx <= 4; gx++) {
      const x = center.x + gx * spacing;
      let zStart = null;
      for (let gz = -4; gz <= 4; gz++) {
        const z = center.z + gz * spacing;
        const inside = cityMask(x, z, center, radius) > 0.35;
        if (inside && zStart === null) zStart = z - spacing * 0.5;
        if (!inside && zStart !== null) {
          roads.push(['v', x, zStart, z - spacing * 0.5]);
          zStart = null;
        }
      }
      if (zStart !== null) {
        roads.push(['v', x, zStart, center.z + 4 * spacing * 0.5]);
      }
    }
    for (let gz = -4; gz <= 4; gz++) {
      const z = center.z + gz * spacing;
      let xStart = null;
      for (let gx = -4; gx <= 4; gx++) {
        const x = center.x + gx * spacing;
        const inside = cityMask(x, z, center, radius) > 0.35;
        if (inside && xStart === null) xStart = x - spacing * 0.5;
        if (!inside && xStart !== null) {
          roads.push(['h', z, xStart, x - spacing * 0.5]);
          xStart = null;
        }
      }
      if (xStart !== null) {
        roads.push(['h', z, xStart, center.x + 4 * spacing * 0.5]);
      }
    }

    for (const r of roads) {
      if (r[0] === 'v') {
        addRoadSegment(r[1], r[2], r[1], r[3], 3.4);
        // lamps along road
        const len = Math.abs(r[3] - r[2]);
        const n = Math.floor(len / 10);
        for (let i = 0; i <= n; i++) {
          const z = r[2] + ((r[3] - r[2]) * i) / Math.max(1, n);
          if (cityMask(r[1], z, center, radius) > 0.4 && rand() > 0.62) {
            createLamp(group, r[1] + 2.2, 0.1, z);
          }
        }
      } else {
        addRoadSegment(r[2], r[1], r[3], r[1], 3.4);
      }
    }
  }

  cityGrid(WORLD.groupsCenter, WORLD.groupsRadius, 42);
  cityGrid(WORLD.itemsCenter, WORLD.itemsRadius, 99);

  // Main avenue connecting to bridge
  addRoadSegment(-22, 2, -18, 2, 4);
  addRoadSegment(22, 2, 28, 2, 4);

  scene.add(group);
  return group;
}

export function createPark(scene) {
  const group = new THREE.Group();
  group.name = 'park';
  // Park near groups city with visible pond (pond already in riverField at +55,+35 area — wait groups is -48)
  // Place decorative park at groups city edge: -55, 28
  const cx = -55;
  const cz = 28;

  // Grass circle plaza
  const grass = new THREE.Mesh(
    new THREE.CircleGeometry(9, 24),
    new THREE.MeshStandardMaterial({ color: 0x4a9c4a, roughness: 0.95 }),
  );
  grass.rotation.x = -Math.PI / 2;
  grass.position.set(cx, 0.12, cz);
  grass.receiveShadow = true;
  group.add(grass);

  // Pond (explicit visible lake)
  const pond = new THREE.Mesh(
    new THREE.CircleGeometry(3.2, 24),
    new THREE.MeshStandardMaterial({
      color: 0x2a9fb8,
      roughness: 0.18,
      metalness: 0.15,
      transparent: true,
      opacity: 0.88,
    }),
  );
  pond.rotation.x = -Math.PI / 2;
  pond.position.set(cx - 1.5, 0.18, cz + 1);
  group.add(pond);

  const pondRing = new THREE.Mesh(
    new THREE.RingGeometry(3.2, 3.8, 24),
    new THREE.MeshStandardMaterial({ color: 0xc4b48a, roughness: 0.9 }),
  );
  pondRing.rotation.x = -Math.PI / 2;
  pondRing.position.set(cx - 1.5, 0.16, cz + 1);
  group.add(pondRing);

  // Benches
  const wood = new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.85 });
  for (let i = 0; i < 3; i++) {
    const ang = (i / 3) * Math.PI * 2 + 0.4;
    const bx = cx + Math.cos(ang) * 5.5;
    const bz = cz + Math.sin(ang) * 5.5;
    const bench = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.12, 0.45), wood);
    bench.position.set(bx, 0.45, bz);
    bench.rotation.y = -ang + Math.PI / 2;
    bench.castShadow = true;
    group.add(bench);
    const leg1 = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.35, 0.4), wood);
    leg1.position.set(bx, 0.25, bz);
    group.add(leg1);
  }

  // Path ring
  const path = new THREE.Mesh(
    new THREE.RingGeometry(5.8, 6.6, 32),
    new THREE.MeshStandardMaterial({ color: 0xc4b8a0, roughness: 0.92 }),
  );
  path.rotation.x = -Math.PI / 2;
  path.position.set(cx, 0.13, cz);
  group.add(path);

  scene.add(group);
  return group;
}
