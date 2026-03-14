// Player ship - physics, controls, rendering
// Uses the exact rotation matrix from the original Lander source:
//
//   [ cos(a)*cos(b)  -sin(a)*cos(b)  sin(b) ]   [ Nose ]
//   [ sin(a)          cos(a)          0      ] = [ Roof ]
//   [-cos(a)*sin(b)   sin(a)*sin(b)  cos(b)  ]   [ Side ]
//
// where a = shipPitch (tilt amount), b = shipDirection (facing direction)
// Ship model: nose along +X, roof along +Y (down in original), side along +Z

import * as THREE from 'three';
import {
  TILE_SIZE, UNDERCARRIAGE_Y, LANDING_SPEED, HIGHEST_ALTITUDE,
  LAUNCHPAD_SIZE, LAUNCHPAD_ALTITUDE, START_X, START_Y, START_Z,
  FRICTION,
} from './constants.js';
import { objectPlayer } from './blueprints.js';
import { createMeshFromBlueprint } from './objects.js';
import { getAltitude, altToY } from './landscape.js';

export class Player {
  constructor(scene) {
    this.scene = scene;

    // Position in world coordinates (Three.js: Y-up)
    this.x = START_X;
    this.y = altToY(LAUNCHPAD_ALTITUDE) + UNDERCARRIAGE_Y;
    this.z = START_Z;

    // Velocity
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;

    // Ship orientation angles (matching original)
    // a = shipPitch: tilt amount (0 = upright, increases with mouse distance from center)
    // b = shipDirection: facing direction (polar angle of mouse)
    this.shipPitch = 0;
    this.shipDirection = 0;

    // Ship mesh
    this.mesh = createMeshFromBlueprint(objectPlayer);
    this.scene.add(this.mesh);

    // Shadow — project all ship faces flat onto the terrain as black triangles.
    // Build a mesh with the same face topology as the ship but we'll flatten
    // it onto the ground each frame.
    this._shadowFaceIndices = objectPlayer.faces.map(f => f.indices);
    this._shadowVertices = objectPlayer.vertices;

    const numFaces = this._shadowFaceIndices.length;
    const shadowPositions = new Float32Array(numFaces * 3 * 3);  // 3 verts × 3 coords per face
    const shadowIndices = [];
    for (let i = 0; i < numFaces * 3; i += 3) {
      shadowIndices.push(i, i + 1, i + 2);
    }
    const shadowGeom = new THREE.BufferGeometry();
    shadowGeom.setAttribute('position', new THREE.BufferAttribute(shadowPositions, 3));
    shadowGeom.setIndex(shadowIndices);

    this.shadow = new THREE.Mesh(shadowGeom, new THREE.MeshBasicMaterial({
      color: 0x000000,
      side: THREE.DoubleSide,
    }));
    this.shadow.frustumCulled = false;
    this.shadow.renderOrder = 1;
    this.scene.add(this.shadow);

    // State
    this.fuel = 1.0;
    this.score = 0;
    this.highScore = 0;
    this.lives = 3;
    this.alive = true;
    this.onLaunchpad = true;
    this.gravity = 0.0003;

    // Thrust state (keyboard: Z=full, X=hover, C=fire)
    this.thrustMode = 'none';
    this.firing = false;
    this.fireCooldown = 0;

    // Steering state (arrow keys)
    this.steerRotate = 0;  // left/right rotation
    this.steerPitch = 0;   // forward/backward pitch

    // Key state
    this.keys = {};

    // Vectors extracted from rotation matrix (in Three.js Y-up coords)
    this.roofX = 0;
    this.roofY = -1;  // down in Three.js = thrust pushes up
    this.roofZ = 0;
    this.noseX = 1;
    this.noseY = 0;
    this.noseZ = 0;

    // Reusable matrix
    this._matrix = new THREE.Matrix4();
  }

  handleKeyDown(key) {
    this.keys[key] = true;
    this._updateFromKeys();
  }

  handleKeyUp(key) {
    this.keys[key] = false;
    this._updateFromKeys();
  }

  _updateFromKeys() {
    // Thrust: Z=full, X=hover, C=fire
    if (this.keys['z'] || this.keys['Z']) {
      this.thrustMode = 'full';
    } else if (this.keys['x'] || this.keys['X']) {
      this.thrustMode = 'hover';
    } else {
      this.thrustMode = 'none';
    }
    this.firing = !!(this.keys['c'] || this.keys['C']);

    // Steering: Left/Right rotate, Up/Down pitch
    this.steerRotate = 0;
    this.steerPitch = 0;
    if (this.keys['ArrowLeft'])  this.steerRotate += 1;
    if (this.keys['ArrowRight']) this.steerRotate -= 1;
    if (this.keys['ArrowUp'])    this.steerPitch += 1;
    if (this.keys['ArrowDown'])  this.steerPitch -= 1;
  }

  update(particleSystem) {
    if (!this.alive) return;

    // Left/Right: rotate shipDirection continuously
    // Up/Down: increase/decrease pitch (tilt amount)
    const rotateSpeed = 0.05;
    const pitchSpeed = 0.03;
    const pitchMax = 1.2;

    this.shipDirection += this.steerRotate * rotateSpeed;

    // Pitch: Up tilts forward (increases), Down tilts back (decreases)
    // Damp toward zero when no key pressed
    if (this.steerPitch !== 0) {
      this.shipPitch += this.steerPitch * pitchSpeed;
      this.shipPitch = Math.max(-pitchMax, Math.min(pitchMax, this.shipPitch));
    } else {
      this.shipPitch *= 0.92;  // spring back toward level
    }

    const a = this.shipPitch;
    const b = this.shipDirection;
    const sinA = Math.sin(a);
    const cosA = Math.cos(a);
    const sinB = Math.sin(b);
    const cosB = Math.cos(b);

    // Original rotation matrix (transforms local coords to world coords):
    //   Column 0 (Nose): ( cos(a)*cos(b),  sin(a), -cos(a)*sin(b))
    //   Column 1 (Roof): (-sin(a)*cos(b),  cos(a),  sin(a)*sin(b))
    //   Column 2 (Side): ( sin(b),          0,       cos(b))
    //
    // In original Y-down coords. For Three.js (Y-up), negate Y components
    // AND account for Y-flipped mesh vertices.
    //
    // The Three.js matrix operating on Y-flipped vertices:
    //   Column 0: ( cos(a)*cos(b), -sin(a), -cos(a)*sin(b))  [nose maps +X]
    //   Column 1: ( sin(a)*cos(b),  cos(a), -sin(a)*sin(b))  [roof maps -Y→+Y after flip]
    //   Column 2: ( sin(b),         0,       cos(b))          [side maps +Z]

    const m = this._matrix;
    m.set(
      cosA * cosB,   sinA * cosB,  sinB,  0,
      -sinA,          cosA,         0,     0,
      -cosA * sinB,  -sinA * sinB,  cosB,  0,
      0,              0,            0,     1
    );

    // Extract roof vector in Three.js world space (column 1 = thrust direction)
    // In original: roof = (-sin(a)*cos(b), cos(a), sin(a)*sin(b)) pointing DOWN
    // In Three.js: negate Y → roof = (-sin(a)*cos(b), -cos(a), sin(a)*sin(b)) pointing DOWN
    this.roofX = -sinA * cosB;
    this.roofY = -cosA;        // negative = pointing down in Three.js
    this.roofZ = sinA * sinB;

    // Extract nose vector in Three.js world space (column 0)
    // Original: (cos(a)*cos(b), sin(a), -cos(a)*sin(b))
    // Three.js: negate Y → (cos(a)*cos(b), -sin(a), -cos(a)*sin(b))
    this.noseX = cosA * cosB;
    this.noseY = -sinA;
    this.noseZ = -cosA * sinB;

    // Apply mesh rotation
    this.mesh.position.set(this.x, this.y, this.z);
    this.mesh.rotation.setFromRotationMatrix(m);

    // Check altitude for engine cutoff
    const alt = getAltitude(this.x, this.z);
    const heightAboveGround = this.y - altToY(alt);

    // Apply thrust (subtract roof vector = push opposite to exhaust direction)
    const thrustStrength = 0.003;
    let exhaustCount = 0;

    if (this.fuel > 0 && heightAboveGround < HIGHEST_ALTITUDE) {
      if (this.thrustMode === 'full') {
        this.vx -= this.roofX * thrustStrength;
        this.vy -= this.roofY * thrustStrength;
        this.vz -= this.roofZ * thrustStrength;
        exhaustCount = 8;
        // 10x fuel: ~340s full thrust
        this.fuel -= 0.00005;
      } else if (this.thrustMode === 'hover') {
        this.vx -= this.roofX * thrustStrength * 0.25;
        this.vy -= this.roofY * thrustStrength * 0.25;
        this.vz -= this.roofZ * thrustStrength * 0.25;
        exhaustCount = 2;
        this.fuel -= 0.000025;
      }
    }
    this.fuel = Math.max(0, this.fuel);

    // Friction
    this.vx -= this.vx * FRICTION;
    this.vy -= this.vy * FRICTION;
    this.vz -= this.vz * FRICTION;

    // Gravity (pulls down = negative Y in Three.js)
    this.vy -= this.gravity;

    // Update position
    this.x += this.vx;
    this.y += this.vy;
    this.z += this.vz;

    // Height ceiling — keep landscape always visible (max ~8 tiles above ground)
    const MAX_HEIGHT = 12;
    const ceilingAlt = getAltitude(this.x, this.z);
    const ceilingY = altToY(ceilingAlt) + MAX_HEIGHT;
    if (this.y > ceilingY) {
      this.y = ceilingY;
      if (this.vy > 0) this.vy = 0;
    }

    // Ground collision
    const groundAlt = getAltitude(this.x, this.z);
    const groundY = altToY(groundAlt);
    const shipBottom = this.y - UNDERCARRIAGE_Y;

    this.onLaunchpad = false;

    if (shipBottom <= groundY) {
      const landingSpeed = Math.abs(this.vy);
      const onPad = this.x >= 0 && this.x < LAUNCHPAD_SIZE &&
                    this.z >= 0 && this.z < LAUNCHPAD_SIZE;

      if (landingSpeed < LANDING_SPEED && onPad) {
        // Safe landing
        this.y = groundY + UNDERCARRIAGE_Y;
        this.vy = 0;
        this.vx *= 0.9;
        this.vz *= 0.9;
        this.onLaunchpad = true;
        this.fuel = Math.min(1.0, this.fuel + 0.01);
      } else if (landingSpeed < LANDING_SPEED * 0.5 && !onPad) {
        // Gentle ground contact
        this.y = groundY + UNDERCARRIAGE_Y;
        this.vy = -this.vy * 0.3;
        this.vx *= 0.95;
        this.vz *= 0.95;
      } else {
        this.crash(particleSystem);
        return;
      }
    }

    // Spawn exhaust particles
    if (exhaustCount > 0) {
      particleSystem.spawnExhaust(
        this.x, this.y, this.z,
        this.vx, this.vy, this.vz,
        this.roofX, this.roofY, this.roofZ,
        exhaustCount
      );
    }

    // Fire bullets
    if (this.firing && this.fireCooldown <= 0) {
      particleSystem.spawnBullet(
        this.x, this.y, this.z,
        this.noseX, this.noseY, this.noseZ
      );
      this.score = Math.max(0, this.score - 1);
      this.fireCooldown = 5;
    }
    if (this.fireCooldown > 0) this.fireCooldown--;

    // Recompute height above ground after all position updates
    const currentGroundY = altToY(getAltitude(this.x, this.z));
    const currentHeight = this.y - currentGroundY;

    // Update shadow — rotate each ship vertex, then project straight down
    // onto the landscape. All Y coords are set to ground level → flat black shape.
    const posArr = this.shadow.geometry.getAttribute('position').array;
    let si = 0;
    for (const [i0, i1, i2] of this._shadowFaceIndices) {
      for (const idx of [i0, i1, i2]) {
        const v = this._shadowVertices[idx];
        const lx = v[0], ly = -v[1], lz = v[2];  // Y-flipped for Three.js
        // Apply rotation to get world XZ
        const wx = this.x + (cosA * cosB * lx + sinA * cosB * ly + sinB * lz);
        const wz = this.z + (-cosA * sinB * lx - sinA * sinB * ly + cosB * lz);
        // Y = ground level directly below this point
        const gy = altToY(getAltitude(wx, wz)) + 0.06;
        posArr[si]     = wx;
        posArr[si + 1] = gy;
        posArr[si + 2] = wz;
        si += 3;
      }
    }
    this.shadow.geometry.getAttribute('position').needsUpdate = true;
    this.shadow.geometry.computeBoundingSphere();
    this.shadow.visible = currentHeight < 12;
  }

  crash(particleSystem) {
    this.alive = false;
    this.lives--;
    particleSystem.spawnExplosion(this.x, this.y, this.z, 40);
    particleSystem.spawnSmoke(this.x, this.y - 0.5, this.z, 15);
    this.mesh.visible = false;
    this.shadow.visible = false;
  }

  respawn() {
    this.x = START_X;
    this.y = altToY(LAUNCHPAD_ALTITUDE) + UNDERCARRIAGE_Y;
    this.z = START_Z;
    this.vx = 0;
    this.vy = 0;
    this.vz = 0;
    this.shipPitch = 0;
    this.shipDirection = 0;
    this.fuel = 1.0;
    this.alive = true;
    this.thrustMode = 'none';
    this.mesh.visible = true;
    this.shadow.visible = true;
  }

  dispose() {
    this.scene.remove(this.mesh);
    this.scene.remove(this.shadow);
    this.mesh.geometry.dispose();
    this.shadow.geometry.dispose();
  }
}
