// Particle system - exhaust, bullets, explosions, smoke

import * as THREE from 'three';
import { MAX_PARTICLES, SEA_LEVEL, FRICTION } from './constants.js';
import { getAltitude, altToY } from './landscape.js';

const PARTICLE_SIZE = 0.02;

export class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];

    // Instanced mesh for efficient particle rendering (unit-sized, scaled per-instance)
    const boxGeom = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff });
    this.instancedMesh = new THREE.InstancedMesh(boxGeom, material, MAX_PARTICLES);
    this.instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.instancedMesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(MAX_PARTICLES * 3), 3
    );
    this.instancedMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.instancedMesh.count = 0;
    this.instancedMesh.frustumCulled = false;
    this.scene.add(this.instancedMesh);

    this._dummy = new THREE.Object3D();
    this._color = new THREE.Color();
  }

  spawn(opts) {
    if (this.particles.length >= MAX_PARTICLES) return null;
    const p = {
      x: opts.x || 0,
      y: opts.y || 0,
      z: opts.z || 0,
      vx: opts.vx || 0,
      vy: opts.vy || 0,
      vz: opts.vz || 0,
      life: opts.life || 10,
      maxLife: opts.life || 10,
      r: opts.r ?? 1,
      g: opts.g ?? 1,
      b: opts.b ?? 1,
      endR: opts.endR ?? opts.r ?? 1,
      endG: opts.endG ?? opts.g ?? 1,
      endB: opts.endB ?? opts.b ?? 1,
      gravity: opts.gravity ?? true,
      bounce: opts.bounce ?? false,
      isBullet: opts.isBullet ?? false,
      size: opts.size ?? 1,
    };
    this.particles.push(p);
    return p;
  }

  spawnExhaust(px, py, pz, vx, vy, vz, roofX, roofY, roofZ, count) {
    for (let i = 0; i < count; i++) {
      // Exhaust direction is along the roof vector (thrust direction)
      const spread = 0.005;
      const exhaust_strength = 0.18;
      this.spawn({
        x: px + roofX * 0.3 + (Math.random() - 0.5) * spread,
        y: py + roofY * 0.3 + (Math.random() - 0.5) * spread,
        z: pz + roofZ * 0.3 + (Math.random() - 0.5) * spread,
        vx: vx * 0.3 + roofX * exhaust_strength + (Math.random() - 0.5) * 0.005,
        vy: vy * 0.3 + roofY * exhaust_strength + (Math.random() - 0.5) * 0.005,
        vz: vz * 0.3 + roofZ * exhaust_strength + (Math.random() - 0.5) * 0.005,
        life: 16 + Math.floor(Math.random() * 6),
        r: 0.5, g: 0.5, b: 1.0,
        endR: 1.0, endG: 0.3, endB: 0.0,
        gravity: true,
        bounce: true,
        size: 0.8,
      });
    }
  }

  spawnBullet(px, py, pz, dirX, dirY, dirZ) {
    const speed = 0.8;
    // Spawn a bright, visible laser bolt
    return this.spawn({
      x: px + dirX * 0.5,
      y: py + dirY * 0.5,
      z: pz + dirZ * 0.5,
      vx: dirX * speed,
      vy: dirY * speed,
      vz: dirZ * speed,
      life: 80,
      r: 1, g: 1, b: 0.3,
      endR: 1, endG: 0.5, endB: 0,
      gravity: false,
      bounce: false,
      isBullet: true,
      size: 4,
    });
  }

  spawnExplosion(x, y, z, count) {
    for (let i = 0; i < count; i++) {
      const speed = 0.05 + Math.random() * 0.1;
      const angle = Math.random() * Math.PI * 2;
      const pitch = Math.random() * Math.PI - Math.PI / 2;
      this.spawn({
        x: x + (Math.random() - 0.5) * 0.2,
        y: y + (Math.random() - 0.5) * 0.2,
        z: z + (Math.random() - 0.5) * 0.2,
        vx: Math.cos(angle) * Math.cos(pitch) * speed,
        vy: -Math.abs(Math.sin(pitch) * speed) - 0.02,  // upward in Three.js
        vz: Math.sin(angle) * Math.cos(pitch) * speed,
        life: 15 + Math.floor(Math.random() * 15),
        r: 1, g: 1, b: 1,
        endR: 1, endG: 0.2, endB: 0,
        gravity: true,
        bounce: true,
        size: 1.0 + Math.random() * 0.5,
      });
    }
  }

  spawnSmoke(x, y, z, count) {
    for (let i = 0; i < count; i++) {
      this.spawn({
        x: x + (Math.random() - 0.5) * 0.1,
        y: y,
        z: z + (Math.random() - 0.5) * 0.1,
        vx: (Math.random() - 0.5) * 0.005,
        vy: -(0.01 + Math.random() * 0.02),  // upward in Three.js
        vz: (Math.random() - 0.5) * 0.005,
        life: 20 + Math.floor(Math.random() * 20),
        r: 0.3, g: 0.3, b: 0.3,
        endR: 0.1, endG: 0.1, endB: 0.1,
        gravity: false,
        bounce: false,
        size: 1.5,
      });
    }
  }

  update(gravity, dt) {
    const gravityAmount = gravity * 60;  // scale for frame timing

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= 1;

      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }

      // Friction
      p.vx -= p.vx * FRICTION;
      p.vy -= p.vy * FRICTION;
      p.vz -= p.vz * FRICTION;

      // Gravity (positive = downward in Three.js Y-up system)
      if (p.gravity) {
        p.vy += gravityAmount;
      }

      // Update position
      p.x += p.vx;
      p.y += p.vy;
      p.z += p.vz;

      // Ground collision
      if (p.bounce) {
        const alt = getAltitude(p.x, p.z);
        const groundY = altToY(alt);
        if (p.y < groundY) {
          p.y = groundY;
          p.vy = -p.vy * 0.5;
          if (Math.abs(p.vy) < 0.001) p.vy = 0;
        }
      }

      // Color interpolation
      const t = 1 - p.life / p.maxLife;
      p._r = p.r + (p.endR - p.r) * t;
      p._g = p.g + (p.endG - p.g) * t;
      p._b = p.b + (p.endB - p.b) * t;
    }

    // Update instanced mesh
    this.instancedMesh.count = this.particles.length;
    for (let i = 0; i < this.particles.length; i++) {
      const p = this.particles[i];
      this._dummy.position.set(p.x, p.y, p.z);
      const s = PARTICLE_SIZE * p.size;
      this._dummy.scale.set(s, s, s);
      this._dummy.updateMatrix();
      this.instancedMesh.setMatrixAt(i, this._dummy.matrix);

      this._color.setRGB(p._r ?? p.r, p._g ?? p.g, p._b ?? p.b);
      this.instancedMesh.setColorAt(i, this._color);
    }

    if (this.particles.length > 0) {
      this.instancedMesh.instanceMatrix.needsUpdate = true;
      this.instancedMesh.instanceColor.needsUpdate = true;
    }
  }

  // Get active bullets for collision detection
  getBullets() {
    return this.particles.filter(p => p.isBullet);
  }

  dispose() {
    this.scene.remove(this.instancedMesh);
    this.instancedMesh.geometry.dispose();
    this.instancedMesh.material.dispose();
  }
}
