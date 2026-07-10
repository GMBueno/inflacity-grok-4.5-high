import * as THREE from 'three';
import { mulberry32, fbm } from '../utils.js';
import { riverField, cityMask, terrainHeight, WORLD } from './terrain.js';

export function createVegetation(scene) {
  const group = new THREE.Group();
  group.name = 'vegetation';

  const rand = mulberry32(2026);

  // Shared geometries
  const trunkGeo = new THREE.CylinderGeometry(0.12, 0.22, 1.4, 6);
  const canopyGeo = new THREE.IcosahedronGeometry(1, 0);
  const bushGeo = new THREE.IcosahedronGeometry(0.55, 0);
  const pineTrunk = new THREE.CylinderGeometry(0.1, 0.18, 1.8, 6);
  const pineCanopy = new THREE.ConeGeometry(0.85, 2.2, 7);

  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.9 });
  const leafColors = [0x3d8b3d, 0x2f6b2f, 0x4a9c4a, 0x3a7a38, 0x568b3a];
  const leafMats = leafColors.map(
    (c) =>
      new THREE.MeshStandardMaterial({
        color: c,
        roughness: 0.88,
        flatShading: true,
      }),
  );
  const bushMats = [0x4a7c3a, 0x3d6b32, 0x5a8f40].map(
    (c) =>
      new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, flatShading: true }),
  );
  const pineMat = new THREE.MeshStandardMaterial({
    color: 0x1f5c38,
    roughness: 0.85,
    flatShading: true,
  });

  // Collect placement samples
  const trees = [];
  const bushes = [];
  const pines = [];

  for (let i = 0; i < 420; i++) {
    const x = (rand() - 0.5) * WORLD.size * 0.92;
    const z = (rand() - 0.5) * WORLD.size * 0.92;
    const river = riverField(x, z);
    if (river < 3.5) continue;
    const urban = Math.max(
      cityMask(x, z, WORLD.groupsCenter, WORLD.groupsRadius),
      cityMask(x, z, WORLD.itemsCenter, WORLD.itemsRadius),
    );
    // sparse in cities, denser outside
    if (urban > 0.55 && rand() > 0.08) continue;
    if (urban > 0.25 && rand() > 0.35) continue;

    const y = terrainHeight(x, z);
    if (y < -0.5 || y > 14) continue;
    // avoid bridge zone
    if (Math.abs(z - 2) < 5 && x > -20 && x < 24) continue;

    const n = fbm(x * 0.05, z * 0.05, 2);
    const roll = rand();
    if (roll < 0.55) {
      trees.push({ x, y, z, s: 0.7 + rand() * 0.9, mat: (rand() * leafMats.length) | 0, n });
    } else if (roll < 0.82) {
      bushes.push({ x, y, z, s: 0.5 + rand() * 0.7, mat: (rand() * bushMats.length) | 0 });
    } else {
      // pines more on hills
      if (y > 2 || n > 0.5) pines.push({ x, y, z, s: 0.75 + rand() * 0.8 });
      else bushes.push({ x, y, z, s: 0.5 + rand() * 0.6, mat: 0 });
    }
  }

  // City avenue trees (planned rows)
  for (const center of [WORLD.groupsCenter, WORLD.itemsCenter]) {
    for (let i = -3; i <= 3; i++) {
      for (let j = -3; j <= 3; j++) {
        if (rand() > 0.45) continue;
        const x = center.x + i * 14 + 5.5 + (rand() - 0.5);
        const z = center.z + j * 14 + (rand() - 0.5) * 2;
        if (cityMask(x, z, center, center === WORLD.groupsCenter ? WORLD.groupsRadius : WORLD.itemsRadius) < 0.4)
          continue;
        if (riverField(x, z) < 5) continue;
        const y = terrainHeight(x, z);
        trees.push({ x, y, z, s: 0.65 + rand() * 0.35, mat: (rand() * leafMats.length) | 0, n: 0.5 });
      }
    }
  }

  // Instanced deciduous trees
  const trunkInst = new THREE.InstancedMesh(trunkGeo, trunkMat, trees.length);
  trunkInst.castShadow = false;
  trunkInst.receiveShadow = true;
  const canopyInsts = leafMats.map(
    (m) => {
      const im = new THREE.InstancedMesh(canopyGeo, m, trees.length);
      im.castShadow = true; // canopies only — main soft shadow mass
      im.receiveShadow = false;
      im.count = 0;
      return im;
    },
  );
  const dummy = new THREE.Object3D();
  const canopyCounts = leafMats.map(() => 0);

  trees.forEach((t, i) => {
    dummy.position.set(t.x, t.y + 0.7 * t.s, t.z);
    dummy.scale.set(t.s, t.s, t.s);
    dummy.rotation.set(0, t.n * 10, 0);
    dummy.updateMatrix();
    trunkInst.setMatrixAt(i, dummy.matrix);

    dummy.position.set(t.x, t.y + 1.8 * t.s, t.z);
    dummy.scale.set(t.s * 1.3, t.s * 1.15, t.s * 1.3);
    dummy.rotation.set(rand() * 0.3, t.n * 6, rand() * 0.3);
    dummy.updateMatrix();
    const mi = t.mat;
    canopyInsts[mi].setMatrixAt(canopyCounts[mi]++, dummy.matrix);
  });
  trunkInst.instanceMatrix.needsUpdate = true;
  canopyInsts.forEach((im, i) => {
    im.count = canopyCounts[i];
    im.instanceMatrix.needsUpdate = true;
    group.add(im);
  });
  group.add(trunkInst);

  // Bushes
  if (bushes.length) {
    const bushInsts = bushMats.map((m) => {
      const im = new THREE.InstancedMesh(bushGeo, m, bushes.length);
      im.castShadow = true;
      im.count = 0;
      return im;
    });
    const counts = bushMats.map(() => 0);
    bushes.forEach((b) => {
      dummy.position.set(b.x, b.y + 0.3 * b.s, b.z);
      dummy.scale.set(b.s * 1.2, b.s * 0.85, b.s * 1.1);
      dummy.rotation.set(0, rand() * Math.PI, 0);
      dummy.updateMatrix();
      bushInsts[b.mat].setMatrixAt(counts[b.mat]++, dummy.matrix);
    });
    bushInsts.forEach((im, i) => {
      im.count = counts[i];
      im.instanceMatrix.needsUpdate = true;
      group.add(im);
    });
  }

  // Pines
  if (pines.length) {
    const pTrunk = new THREE.InstancedMesh(pineTrunk, trunkMat, pines.length);
    const pCanopy = new THREE.InstancedMesh(pineCanopy, pineMat, pines.length);
    pTrunk.castShadow = true;
    pCanopy.castShadow = true;
    pines.forEach((p, i) => {
      dummy.position.set(p.x, p.y + 0.9 * p.s, p.z);
      dummy.scale.set(p.s, p.s, p.s);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      pTrunk.setMatrixAt(i, dummy.matrix);

      dummy.position.set(p.x, p.y + 2.2 * p.s, p.z);
      dummy.scale.set(p.s, p.s, p.s);
      dummy.updateMatrix();
      pCanopy.setMatrixAt(i, dummy.matrix);

      // second canopy layer
    });
    pTrunk.instanceMatrix.needsUpdate = true;
    pCanopy.instanceMatrix.needsUpdate = true;
    group.add(pTrunk, pCanopy);
  }

  // Flower patches near parks / banks
  const flowerGeo = new THREE.SphereGeometry(0.12, 5, 4);
  const flowerColors = [0xf472b6, 0xfbbf24, 0xa78bfa, 0xf87171, 0xffffff];
  flowerColors.forEach((c, ci) => {
    const mat = new THREE.MeshStandardMaterial({
      color: c,
      roughness: 0.7,
      emissive: c,
      emissiveIntensity: 0.08,
    });
    const count = 36;
    const inst = new THREE.InstancedMesh(flowerGeo, mat, count);
    let n = 0;
    for (let i = 0; i < count * 3 && n < count; i++) {
      const x = (rand() - 0.5) * 160;
      const z = (rand() - 0.5) * 160;
      const river = riverField(x, z);
      if (river < 2 || river > 14) continue;
      const urban = Math.max(
        cityMask(x, z, WORLD.groupsCenter, WORLD.groupsRadius),
        cityMask(x, z, WORLD.itemsCenter, WORLD.itemsRadius),
      );
      if (urban > 0.7) continue;
      const y = terrainHeight(x, z);
      if (y < 0) continue;
      dummy.position.set(x, y + 0.12, z);
      dummy.scale.setScalar(0.6 + rand() * 0.8);
      dummy.updateMatrix();
      inst.setMatrixAt(n++, dummy.matrix);
    }
    inst.count = n;
    inst.instanceMatrix.needsUpdate = true;
    group.add(inst);
  });

  scene.add(group);
  return group;
}

export function createClouds(scene) {
  const group = new THREE.Group();
  group.name = 'clouds';
  const rand = mulberry32(77);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 1,
    transparent: true,
    opacity: 0.78,
    depthWrite: false,
  });
  const geo = new THREE.SphereGeometry(1, 8, 6);

  for (let i = 0; i < 14; i++) {
    const cloud = new THREE.Group();
    const cx = (rand() - 0.5) * 220;
    const cz = (rand() - 0.5) * 220;
    const cy = 28 + rand() * 18;
    const blobs = 2 + ((rand() * 2) | 0);
    for (let b = 0; b < blobs; b++) {
      const m = new THREE.Mesh(geo, mat);
      m.position.set((rand() - 0.5) * 6, (rand() - 0.5) * 1.5, (rand() - 0.5) * 4);
      m.scale.set(2 + rand() * 3, 1.2 + rand() * 1.5, 2 + rand() * 2.5);
      cloud.add(m);
    }
    cloud.position.set(cx, cy, cz);
    cloud.userData.speed = 0.3 + rand() * 0.6;
    cloud.userData.baseX = cx;
    group.add(cloud);
  }
  scene.add(group);
  return group;
}

export function updateClouds(clouds, dt) {
  if (!clouds) return;
  clouds.children.forEach((c) => {
    c.position.x += c.userData.speed * dt;
    if (c.position.x > 130) c.position.x = -130;
  });
}
