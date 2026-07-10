import * as THREE from 'three';
import { mulberry32, fbm } from '../utils.js';
import { riverField, cityMask, terrainHeight, WORLD } from './terrain.js';

/**
 * Extra scenic details: rocks, reeds, boats, birds, ambient particles.
 * Pushes the world past a "tech demo" feel.
 */
export function createWorldDetails(scene) {
  const group = new THREE.Group();
  group.name = 'details';
  const rand = mulberry32(404);

  // ── Rocks along banks and hills ──
  const rockGeo = new THREE.DodecahedronGeometry(0.6, 0);
  const rockMat = new THREE.MeshStandardMaterial({
    color: 0x6b6560,
    roughness: 0.95,
    flatShading: true,
  });
  const rockMat2 = new THREE.MeshStandardMaterial({
    color: 0x8a7f72,
    roughness: 0.92,
    flatShading: true,
  });
  const rocks = [];
  for (let i = 0; i < 100; i++) {
    const x = (rand() - 0.5) * WORLD.size * 0.9;
    const z = (rand() - 0.5) * WORLD.size * 0.9;
    const river = riverField(x, z);
    const y = terrainHeight(x, z);
    const nearBank = river > 1.5 && river < 8;
    const onHill = y > 3.5;
    if (!nearBank && !onHill) continue;
    if (y < -0.3) continue;
    rocks.push({ x, y, z, s: 0.4 + rand() * 1.4, mat: rand() > 0.5 ? 0 : 1 });
  }
  const rockInst = [
    new THREE.InstancedMesh(rockGeo, rockMat, rocks.length),
    new THREE.InstancedMesh(rockGeo, rockMat2, rocks.length),
  ];
  rockInst.forEach((im) => {
    im.castShadow = true;
    im.receiveShadow = true;
    im.count = 0;
  });
  const dummy = new THREE.Object3D();
  const counts = [0, 0];
  rocks.forEach((r) => {
    dummy.position.set(r.x, r.y + 0.15 * r.s, r.z);
    dummy.scale.set(r.s, r.s * (0.6 + rand() * 0.5), r.s * 0.9);
    dummy.rotation.set(rand() * 1, rand() * 6, rand() * 1);
    dummy.updateMatrix();
    const mi = r.mat;
    rockInst[mi].setMatrixAt(counts[mi]++, dummy.matrix);
  });
  rockInst.forEach((im, i) => {
    im.count = counts[i];
    im.instanceMatrix.needsUpdate = true;
    group.add(im);
  });

  // ── Reeds / cattails along water ──
  const reedGeo = new THREE.CylinderGeometry(0.03, 0.05, 1.2, 4);
  const reedMat = new THREE.MeshStandardMaterial({ color: 0x4a6b32, roughness: 0.9, flatShading: true });
  const reedTopGeo = new THREE.SphereGeometry(0.08, 5, 4);
  const reedTopMat = new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.85 });
  const reedPositions = [];
  for (let i = 0; i < 140; i++) {
    const x = (rand() - 0.5) * 200;
    const z = (rand() - 0.5) * 200;
    const river = riverField(x, z);
    if (river < 0.3 || river > 4.5) continue;
    const y = terrainHeight(x, z);
    if (y < -0.8 || y > 1.5) continue;
    reedPositions.push(x, y, z);
  }
  const reedInst = new THREE.InstancedMesh(reedGeo, reedMat, reedPositions.length / 3);
  const reedTopInst = new THREE.InstancedMesh(reedTopGeo, reedTopMat, reedPositions.length / 3);
  reedInst.castShadow = true;
  for (let i = 0; i < reedPositions.length; i += 3) {
    const s = 0.7 + rand() * 0.8;
    dummy.position.set(reedPositions[i], reedPositions[i + 1] + 0.55 * s, reedPositions[i + 2]);
    dummy.scale.set(1, s, 1);
    dummy.rotation.set(0, rand() * 6, (rand() - 0.5) * 0.2);
    dummy.updateMatrix();
    reedInst.setMatrixAt(i / 3, dummy.matrix);
    dummy.position.y += 0.55 * s;
    dummy.scale.setScalar(s);
    dummy.updateMatrix();
    reedTopInst.setMatrixAt(i / 3, dummy.matrix);
  }
  reedInst.instanceMatrix.needsUpdate = true;
  reedTopInst.instanceMatrix.needsUpdate = true;
  group.add(reedInst, reedTopInst);

  // ── Small wooden boat on river ──
  const boat = new THREE.Group();
  const hull = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 0.35, 0.9),
    new THREE.MeshStandardMaterial({ color: 0x8b5a2b, roughness: 0.85 }),
  );
  hull.position.y = 0.1;
  hull.castShadow = true;
  const prow = new THREE.Mesh(
    new THREE.ConeGeometry(0.45, 0.9, 4),
    new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.85, flatShading: true }),
  );
  prow.rotation.z = -Math.PI / 2;
  prow.position.set(1.3, 0.15, 0);
  boat.add(hull, prow);
  boat.position.set(4, -0.15, 18);
  boat.rotation.y = 0.4;
  boat.userData.bob = true;
  group.add(boat);

  const boat2 = boat.clone();
  boat2.position.set(-8, -0.15, -35);
  boat2.rotation.y = -1.1;
  boat2.userData.bob = true;
  group.add(boat2);

  // ── Birds (simple animated) ──
  const birdGeo = new THREE.ConeGeometry(0.15, 0.5, 4);
  const birdMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, flatShading: true });
  const birds = new THREE.Group();
  birds.name = 'birds';
  for (let i = 0; i < 12; i++) {
    const b = new THREE.Mesh(birdGeo, birdMat);
    b.rotation.x = Math.PI / 2;
    b.userData = {
      phase: rand() * Math.PI * 2,
      radius: 30 + rand() * 50,
      speed: 0.15 + rand() * 0.25,
      height: 18 + rand() * 16,
      centerX: (rand() - 0.5) * 40,
      centerZ: (rand() - 0.5) * 40,
    };
    birds.add(b);
  }
  group.add(birds);

  // ── City plaza fountains / monuments ──
  function monument(x, z, color) {
    const g = new THREE.Group();
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(2.2, 2.5, 0.4, 8),
      new THREE.MeshStandardMaterial({ color: 0x9ca3af, roughness: 0.8 }),
    );
    base.position.y = 0.2;
    base.castShadow = true;
    const pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.35, 0.45, 4.5, 8),
      new THREE.MeshStandardMaterial({ color: 0xd1d5db, roughness: 0.7, metalness: 0.1 }),
    );
    pillar.position.y = 2.5;
    pillar.castShadow = true;
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 12, 10),
      new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.55,
        metalness: 0.3,
        roughness: 0.4,
      }),
    );
    orb.position.y = 5.1;
    // No PointLight — emissive orb is enough for look without FPS cost
    g.add(base, pillar, orb);
    g.position.set(x, Math.max(0, terrainHeight(x, z)), z);
    return g;
  }
  group.add(monument(WORLD.groupsCenter.x, WORLD.groupsCenter.z, 0x5eead4));
  group.add(monument(WORLD.itemsCenter.x, WORLD.itemsCenter.z, 0xfbbf24));

  // ── Wooden dock near bridge ──
  const dockMat = new THREE.MeshStandardMaterial({ color: 0x7c5a3a, roughness: 0.88 });
  const dock = new THREE.Mesh(new THREE.BoxGeometry(6, 0.2, 2.2), dockMat);
  dock.position.set(-14, 0.15, 8);
  dock.castShadow = true;
  dock.receiveShadow = true;
  group.add(dock);
  for (let i = 0; i < 4; i++) {
    const pile = new THREE.Mesh(
      new THREE.CylinderGeometry(0.12, 0.15, 1.8, 6),
      dockMat,
    );
    pile.position.set(-16 + i * 1.5, -0.5, 7.2 + (i % 2) * 1.6);
    pile.castShadow = true;
    group.add(pile);
  }

  // ── Fireflies for night (points, opacity controlled externally) ──
  const flyCount = 60;
  const flyPos = new Float32Array(flyCount * 3);
  for (let i = 0; i < flyCount; i++) {
    flyPos[i * 3] = (rand() - 0.5) * 120;
    flyPos[i * 3 + 1] = 1 + rand() * 8;
    flyPos[i * 3 + 2] = (rand() - 0.5) * 120;
  }
  const flyGeo = new THREE.BufferGeometry();
  flyGeo.setAttribute('position', new THREE.BufferAttribute(flyPos, 3));
  const flyMat = new THREE.PointsMaterial({
    color: 0xc4f07a,
    size: 0.35,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const fireflies = new THREE.Points(flyGeo, flyMat);
  fireflies.name = 'fireflies';
  fireflies.userData.base = flyPos.slice();
  group.add(fireflies);

  scene.add(group);
  return group;
}

export function updateWorldDetails(group, dt, t, isNight) {
  if (!group) return;

  // Bob boats
  group.children.forEach((c) => {
    if (c.userData?.bob) {
      c.position.y = -0.15 + Math.sin(t * 1.5 + c.position.z) * 0.08;
      c.rotation.z = Math.sin(t * 1.2 + c.position.x) * 0.04;
    }
  });

  // Birds circle
  const birds = group.getObjectByName('birds');
  if (birds) {
    birds.children.forEach((b) => {
      const u = b.userData;
      u.phase += u.speed * dt;
      b.position.x = u.centerX + Math.cos(u.phase) * u.radius;
      b.position.z = u.centerZ + Math.sin(u.phase) * u.radius;
      b.position.y = u.height + Math.sin(u.phase * 3) * 1.5;
      b.rotation.y = -u.phase + Math.PI / 2;
    });
  }

  // Fireflies — opacity only (no per-vertex rewrite every frame)
  const flies = group.getObjectByName('fireflies');
  if (flies) {
    flies.material.opacity = isNight ? 0.85 : 0;
    if (isNight) {
      flies.rotation.y = t * 0.08;
    }
  }
}
