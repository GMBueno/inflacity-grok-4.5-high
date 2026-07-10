import * as THREE from 'three';
import { lerp, clamp } from '../utils.js';

/**
 * Day periods with smooth transitions:
 * morning | afternoon | night
 */
const PRESETS = {
  morning: {
    sunDir: new THREE.Vector3(0.65, 0.55, 0.35).normalize(),
    sunColor: new THREE.Color(0xffe0b0),
    sunIntensity: 1.55,
    ambientColor: new THREE.Color(0xb0c4de),
    ambientIntensity: 0.45,
    hemiSky: new THREE.Color(0x87b8e8),
    hemiGround: new THREE.Color(0x6b8f5a),
    hemiIntensity: 0.55,
    fogColor: new THREE.Color(0xc8dce8),
    fogDensity: 0.0018,
    skyTop: new THREE.Color(0x4a90d9),
    skyHorizon: new THREE.Color(0xffd4a8),
    skyBottom: new THREE.Color(0xf0e0c8),
    stars: 0,
    streetLights: 0.15,
  },
  afternoon: {
    sunDir: new THREE.Vector3(-0.35, 0.85, 0.25).normalize(),
    sunColor: new THREE.Color(0xfff4e0),
    sunIntensity: 1.85,
    ambientColor: new THREE.Color(0xd0d8e8),
    ambientIntensity: 0.5,
    hemiSky: new THREE.Color(0x6eb6ff),
    hemiGround: new THREE.Color(0x7a9a5c),
    hemiIntensity: 0.6,
    fogColor: new THREE.Color(0xb8d0e8),
    fogDensity: 0.0014,
    skyTop: new THREE.Color(0x3b82f6),
    skyHorizon: new THREE.Color(0xa5d0f0),
    skyBottom: new THREE.Color(0xdce9f5),
    stars: 0,
    streetLights: 0,
  },
  night: {
    sunDir: new THREE.Vector3(-0.4, 0.25, -0.55).normalize(),
    sunColor: new THREE.Color(0xa0b4e0),
    sunIntensity: 0.18,
    ambientColor: new THREE.Color(0x1a2240),
    ambientIntensity: 0.28,
    hemiSky: new THREE.Color(0x0a1028),
    hemiGround: new THREE.Color(0x0c1810),
    hemiIntensity: 0.22,
    fogColor: new THREE.Color(0x0a1220),
    fogDensity: 0.0024,
    skyTop: new THREE.Color(0x020617),
    skyHorizon: new THREE.Color(0x0f1c3a),
    skyBottom: new THREE.Color(0x0a1628),
    stars: 1,
    streetLights: 1.4,
  },
};

export class LightingSystem {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.period = 'afternoon';
    this.blend = 1;
    this.from = { ...PRESETS.afternoon };
    this.to = PRESETS.afternoon;
    this.t = 1;

    // Lights
    this.ambient = new THREE.AmbientLight(0xffffff, 0.5);
    scene.add(this.ambient);

    this.hemi = new THREE.HemisphereLight(0x87b8e8, 0x6b8f5a, 0.55);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff4e0, 1.8);
    this.sun.position.set(-40, 80, 30);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 280;
    this.sun.shadow.camera.left = -120;
    this.sun.shadow.camera.right = 120;
    this.sun.shadow.camera.top = 120;
    this.sun.shadow.camera.bottom = -120;
    this.sun.shadow.bias = -0.00025;
    this.sun.shadow.normalBias = 0.03;
    scene.add(this.sun);
    scene.add(this.sun.target);

    // Fill rim light
    this.fill = new THREE.DirectionalLight(0x88aadd, 0.25);
    this.fill.position.set(50, 30, -40);
    scene.add(this.fill);

    // Moon (night)
    this.moon = new THREE.DirectionalLight(0x8899cc, 0);
    this.moon.position.set(40, 50, -60);
    scene.add(this.moon);

    // Fog
    scene.fog = new THREE.FogExp2(0xb8d0e8, 0.0014);

    // Sky dome
    this.sky = this._createSky();
    scene.add(this.sky);

    // Stars
    this.stars = this._createStars();
    scene.add(this.stars);

    this.current = this._clonePreset(PRESETS.afternoon);
    this._apply(this.current);
  }

  _clonePreset(p) {
    return {
      sunDir: p.sunDir.clone(),
      sunColor: p.sunColor.clone(),
      sunIntensity: p.sunIntensity,
      ambientColor: p.ambientColor.clone(),
      ambientIntensity: p.ambientIntensity,
      hemiSky: p.hemiSky.clone(),
      hemiGround: p.hemiGround.clone(),
      hemiIntensity: p.hemiIntensity,
      fogColor: p.fogColor.clone(),
      fogDensity: p.fogDensity,
      skyTop: p.skyTop.clone(),
      skyHorizon: p.skyHorizon.clone(),
      skyBottom: p.skyBottom.clone(),
      stars: p.stars,
      streetLights: p.streetLights,
    };
  }

  _createSky() {
    const geo = new THREE.SphereGeometry(400, 32, 16);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x3b82f6) },
        horizonColor: { value: new THREE.Color(0xa5d0f0) },
        bottomColor: { value: new THREE.Color(0xdce9f5) },
        offset: { value: 0.0 },
        exponent: { value: 0.7 },
      },
      vertexShader: `
        varying vec3 vWorldPosition;
        void main() {
          vec4 worldPosition = modelMatrix * vec4(position, 1.0);
          vWorldPosition = worldPosition.xyz;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        uniform vec3 bottomColor;
        uniform float offset;
        uniform float exponent;
        varying vec3 vWorldPosition;
        void main() {
          float h = normalize(vWorldPosition + offset).y;
          float t = max(h, 0.0);
          t = pow(t, exponent);
          vec3 col = mix(horizonColor, topColor, t);
          if (h < 0.0) {
            col = mix(horizonColor, bottomColor, clamp(-h * 1.5, 0.0, 1.0));
          }
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'sky';
    mesh.frustumCulled = false;
    this.skyMat = mat;
    return mesh;
  }

  _createStars() {
    const count = 1800;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      // hemisphere
      const u = Math.random();
      const v = Math.random();
      const theta = u * Math.PI * 2;
      const phi = Math.acos(0.05 + 0.95 * v);
      const r = 380;
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.cos(phi);
      positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 1.2,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    points.name = 'stars';
    this.starsMat = mat;
    return points;
  }

  setPeriod(period) {
    if (!PRESETS[period] || period === this.period && this.t >= 1) {
      this.period = period;
      return;
    }
    this.from = this._clonePreset(this.current);
    this.to = PRESETS[period];
    this.period = period;
    this.t = 0;
  }

  update(dt) {
    if (this.t < 1) {
      this.t = clamp(this.t + dt * 0.55, 0, 1);
      const e = this.t * this.t * (3 - 2 * this.t); // smoothstep
      this._blendInto(this.current, this.from, this.to, e);
      this._apply(this.current);
    }
  }

  _blendInto(out, a, b, t) {
    out.sunDir.lerpVectors(a.sunDir, b.sunDir, t).normalize();
    out.sunColor.lerpColors(a.sunColor, b.sunColor, t);
    out.sunIntensity = lerp(a.sunIntensity, b.sunIntensity, t);
    out.ambientColor.lerpColors(a.ambientColor, b.ambientColor, t);
    out.ambientIntensity = lerp(a.ambientIntensity, b.ambientIntensity, t);
    out.hemiSky.lerpColors(a.hemiSky, b.hemiSky, t);
    out.hemiGround.lerpColors(a.hemiGround, b.hemiGround, t);
    out.hemiIntensity = lerp(a.hemiIntensity, b.hemiIntensity, t);
    out.fogColor.lerpColors(a.fogColor, b.fogColor, t);
    out.fogDensity = lerp(a.fogDensity, b.fogDensity, t);
    out.skyTop.lerpColors(a.skyTop, b.skyTop, t);
    out.skyHorizon.lerpColors(a.skyHorizon, b.skyHorizon, t);
    out.skyBottom.lerpColors(a.skyBottom, b.skyBottom, t);
    out.stars = lerp(a.stars, b.stars, t);
    out.streetLights = lerp(a.streetLights, b.streetLights, t);
  }

  _apply(p) {
    this.ambient.color.copy(p.ambientColor);
    this.ambient.intensity = p.ambientIntensity;
    this.hemi.color.copy(p.hemiSky);
    this.hemi.groundColor.copy(p.hemiGround);
    this.hemi.intensity = p.hemiIntensity;

    this.sun.color.copy(p.sunColor);
    this.sun.intensity = p.sunIntensity;
    this.sun.position.copy(p.sunDir).multiplyScalar(120);
    this.sun.target.position.set(0, 0, 0);
    this.sun.target.updateMatrixWorld();

    this.moon.intensity = p.stars * 0.35;
    this.fill.intensity = lerp(0.35, 0.05, p.stars);

    if (this.scene.fog) {
      this.scene.fog.color.copy(p.fogColor);
      this.scene.fog.density = p.fogDensity;
    }

    this.skyMat.uniforms.topColor.value.copy(p.skyTop);
    this.skyMat.uniforms.horizonColor.value.copy(p.skyHorizon);
    this.skyMat.uniforms.bottomColor.value.copy(p.skyBottom);

    this.starsMat.opacity = p.stars * 0.9;

    this.renderer.toneMappingExposure = lerp(1.05, 0.72, p.stars);

    this.streetLightIntensity = p.streetLights;
    this.isNight = p.stars > 0.5;
  }
}

export function updateStreetLights(scene, intensity) {
  scene.traverse((obj) => {
    if (obj.userData?.isStreetLight) {
      obj.intensity = intensity * 1.2;
    }
    if (obj.userData?.isLamp && obj.material) {
      obj.material.emissiveIntensity = 0.2 + intensity * 1.5;
    }
  });
}
