import * as THREE from 'three';
import { WORLD } from '../world/terrain.js';
import { clamp, lerp } from '../utils.js';

/**
 * Minecraft-lite camera:
 * - Orbit with mouse drag
 * - WASD move, Space up, Ctrl down, Shift run
 * - Zoom out generous
 */
export class GameCamera {
  constructor(camera, domElement) {
    this.camera = camera;
    this.dom = domElement;

    this.position = new THREE.Vector3(0, 28, 70);
    this.yaw = 0;
    this.pitch = -0.35;
    this.distance = 55; // orbit distance from look target when orbiting
    this.target = new THREE.Vector3(0, 4, 0);

    // free-fly mode blended with orbit
    this.mode = 'orbit'; // orbit | fly
    this.velocity = new THREE.Vector3();

    this.keys = {};
    this.dragging = false;
    this.lastX = 0;
    this.lastY = 0;
    this.sensitivity = 0.005;
    this.baseSpeed = 22;
    this.minDist = 8;
    this.maxDist = 220;
    this.minPitch = -1.45;
    this.maxPitch = 0.35;

    this._onKeyDown = (e) => {
      this.keys[e.code] = true;
      // prevent page scroll on space
      if (e.code === 'Space') e.preventDefault();
    };
    this._onKeyUp = (e) => {
      this.keys[e.code] = false;
    };
    this._onPointerDown = (e) => {
      if (e.button !== 0) return;
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.dom.setPointerCapture?.(e.pointerId);
    };
    this._onPointerUp = (e) => {
      this.dragging = false;
    };
    this._onPointerMove = (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.yaw -= dx * this.sensitivity;
      this.pitch -= dy * this.sensitivity;
      this.pitch = clamp(this.pitch, this.minPitch, this.maxPitch);
    };
    this._onWheel = (e) => {
      e.preventDefault();
      const factor = Math.exp(e.deltaY * 0.0012);
      this.distance = clamp(this.distance * factor, this.minDist, this.maxDist);
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    domElement.addEventListener('pointerdown', this._onPointerDown);
    window.addEventListener('pointerup', this._onPointerUp);
    window.addEventListener('pointermove', this._onPointerMove);
    domElement.addEventListener('wheel', this._onWheel, { passive: false });

    this.reset('overview');
  }

  dispose() {
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    this.dom.removeEventListener('pointerdown', this._onPointerDown);
    window.removeEventListener('pointerup', this._onPointerUp);
    window.removeEventListener('pointermove', this._onPointerMove);
    this.dom.removeEventListener('wheel', this._onWheel);
  }

  reset(which = 'overview') {
    if (which === 'groups') {
      this.target.copy(WORLD.groupsCenter).setY(6);
      this.distance = 48;
      this.yaw = 0.4;
      this.pitch = -0.4;
    } else if (which === 'items') {
      this.target.copy(WORLD.itemsCenter).setY(6);
      this.distance = 58;
      this.yaw = -0.35;
      this.pitch = -0.42;
    } else {
      this.target.set(0, 5, 0);
      this.distance = 95;
      this.yaw = 0.15;
      this.pitch = -0.48;
    }
    this.velocity.set(0, 0, 0);
  }

  teleportTo(city) {
    this.reset(city === 'items' ? 'items' : 'groups');
  }

  update(dt) {
    const speed =
      this.baseSpeed *
      (this.keys['ShiftLeft'] || this.keys['ShiftRight'] ? 2.6 : 1) *
      (this.keys['AltLeft'] ? 0.4 : 1);

    // Local axes from yaw
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const move = new THREE.Vector3();
    if (this.keys['KeyW'] || this.keys['ArrowUp']) move.add(forward);
    if (this.keys['KeyS'] || this.keys['ArrowDown']) move.sub(forward);
    if (this.keys['KeyA'] || this.keys['ArrowLeft']) move.sub(right);
    if (this.keys['KeyD'] || this.keys['ArrowRight']) move.add(right);
    if (this.keys['Space']) move.y += 1;
    if (this.keys['ControlLeft'] || this.keys['ControlRight'] || this.keys['KeyQ']) move.y -= 1;

    if (move.lengthSq() > 0) {
      move.normalize().multiplyScalar(speed * dt);
      this.target.add(move);
      // keep target roughly in world
      this.target.x = clamp(this.target.x, -WORLD.half + 10, WORLD.half - 10);
      this.target.z = clamp(this.target.z, -WORLD.half + 10, WORLD.half - 10);
      this.target.y = clamp(this.target.y, 1, 80);
    }

    // Orbit camera around target
    const cp = Math.cos(this.pitch);
    const sp = Math.sin(this.pitch);
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);

    const desired = new THREE.Vector3(
      this.target.x + this.distance * cp * sy,
      this.target.y + this.distance * -sp,
      this.target.z + this.distance * cp * cy,
    );

    this.camera.position.lerp(desired, 1 - Math.exp(-dt * 10));
    this.camera.lookAt(this.target);
  }
}
