// 3D object creation and scene management for landscape objects

import * as THREE from 'three';
import {
  TILE_SIZE, TILES_X, TILES_Z, SEA_LEVEL, LAUNCHPAD_ALTITUDE, LAUNCHPAD_SIZE,
} from './constants.js';
import { objectTypeMap, destroyedVersions } from './blueprints.js';
import { getAltitude, altToY } from './landscape.js';

// Create a Three.js mesh from a blueprint
export function createMeshFromBlueprint(blueprint) {
  const geometry = new THREE.BufferGeometry();
  const positions = [];
  const colorAttrib = [];
  const indices = [];

  // Each face is a separate triangle with its own color
  let vertIdx = 0;
  for (const face of blueprint.faces) {
    const [i0, i1, i2] = face.indices;
    const v0 = blueprint.vertices[i0];
    const v1 = blueprint.vertices[i1];
    const v2 = blueprint.vertices[i2];

    // In original: Y-down. In Three.js: Y-up. Negate Y.
    positions.push(v0[0], -v0[1], v0[2]);
    positions.push(v1[0], -v1[1], v1[2]);
    positions.push(v2[0], -v2[1], v2[2]);

    // Brightness modulation matching original (DrawObject Part 5, lines 5510-5533):
    // val = floor((1 - ny) * 4)  → 0-8, larger when normal points up (ny negative in original)
    // if nx < 0 (face points left): val += 1
    // brightness = clamp(val - 5, 0, 3)
    const [nx, ny, nz] = face.normal;
    let val = Math.floor((1 - ny) * 4);
    if (nx < 0) val += 1;
    const brightness = Math.max(0, Math.min(3, val - 5));
    const [br, bg, bb] = face.color;
    const fr = Math.min(1, br + brightness / 15);
    const fg = Math.min(1, bg + brightness / 15);
    const fb = Math.min(1, bb + brightness / 15);
    colorAttrib.push(fr, fg, fb, fr, fg, fb, fr, fg, fb);

    indices.push(vertIdx, vertIdx + 1, vertIdx + 2);
    vertIdx += 3;
  }

  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colorAttrib, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  // MeshBasicMaterial — the original uses fixed face colors, no real-time lighting
  const material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
  });

  return new THREE.Mesh(geometry, material);
}

// 256x256 object map, matching the original game's object placement system.
// 0xFF = empty, 1-8 = random object types, 9 = rocket.
const OBJECT_MAP_SIZE = 256;
const OBJECT_EMPTY = 0xFF;
const OBJECT_COUNT = 2048;

// Simple LCG PRNG (parameters from Numerical Recipes)
function createPRNG(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state;
  };
}

function initObjectMap() {
  const map = new Uint8Array(OBJECT_MAP_SIZE * OBJECT_MAP_SIZE);
  map.fill(OBJECT_EMPTY);

  const rng = createPRNG(12345);

  // Place 2048 random objects
  for (let i = 0; i < OBJECT_COUNT; i++) {
    const rx = rng() & 255;
    const rz = rng() & 255;
    const typeVal = (rng() & 7) + 1;  // types 1-8

    // Skip sea level tiles and launchpad tiles
    const wx = rx * TILE_SIZE;
    const wz = rz * TILE_SIZE;
    const alt = getAltitude(wx, wz);

    if (Math.abs(alt - SEA_LEVEL) < 0.01) continue;
    if (Math.abs(alt - LAUNCHPAD_ALTITUDE) < 0.01) continue;
    if (rx < LAUNCHPAD_SIZE && rz < LAUNCHPAD_SIZE) continue;

    map[rz * OBJECT_MAP_SIZE + rx] = typeVal;
  }

  // Place 3 rockets at fixed positions: (7,1), (7,3), (7,5)
  map[1 * OBJECT_MAP_SIZE + 7] = 9;
  map[3 * OBJECT_MAP_SIZE + 7] = 9;
  map[5 * OBJECT_MAP_SIZE + 7] = 9;

  return map;
}

// Module-level object map, initialized once
const objectMap = initObjectMap();

export class ObjectManager {
  constructor(scene) {
    this.scene = scene;
    this.objects = new Map();  // key: "tx,tz" -> { mesh, blueprint, destroyed }
    this.meshPool = [];
  }

  update(playerX, playerZ) {
    const RENDER_X = 25;
    const RENDER_Z = 20;
    const startTX = Math.floor(playerX) - Math.floor(RENDER_X / 2);
    const startTZ = Math.floor(playerZ) - Math.floor(RENDER_Z / 2) - 2;

    // Track which tiles should have objects
    const activeTiles = new Set();

    for (let iz = 0; iz < RENDER_Z - 1; iz++) {
      for (let ix = 0; ix < RENDER_X - 1; ix++) {
        const tx = startTX + ix;
        const tz = startTZ + iz;
        const key = `${tx},${tz}`;
        activeTiles.add(key);

        if (this.objects.has(key)) continue;

        // Look up the object map using wrapping coordinates
        const mapX = tx & 255;
        const mapZ = tz & 255;
        const typeIdx = objectMap[mapZ * OBJECT_MAP_SIZE + mapX];

        if (typeIdx === OBJECT_EMPTY) continue;

        const blueprint = objectTypeMap[typeIdx];
        if (!blueprint) continue;

        // Objects sit at tile corner coordinates (matching original)
        const wx = tx * TILE_SIZE;
        const wz = tz * TILE_SIZE;
        const alt = getAltitude(wx, wz);

        const mesh = createMeshFromBlueprint(blueprint);
        const y = altToY(alt);
        mesh.position.set(wx, y, wz);

        // Deterministic rotation based on tile position
        if (blueprint.rotates) {
          const rotHash = ((mapX * 2654435761 + mapZ * 40503) >>> 0) & 0xFF;
          mesh.rotation.y = (rotHash / 255) * Math.PI * 2;
        }

        this.scene.add(mesh);
        this.objects.set(key, { mesh, blueprint, destroyed: false, wx, wz, alt });
      }
    }

    // Remove objects that are no longer in visible range
    for (const [key, obj] of this.objects) {
      if (!activeTiles.has(key)) {
        this.scene.remove(obj.mesh);
        obj.mesh.geometry.dispose();
        this.objects.delete(key);
      }
    }
  }

  // Check if player bullet hits any object, returns score delta
  checkBulletCollision(bx, by, bz, radius) {
    for (const [key, obj] of this.objects) {
      if (obj.destroyed) continue;
      const dx = bx - obj.wx;
      const dz = bz - obj.wz;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < radius) {
        this.destroyObject(key);
        return 20;
      }
    }
    return 0;
  }

  destroyObject(key) {
    const obj = this.objects.get(key);
    if (!obj || obj.destroyed) return;

    obj.destroyed = true;
    this.scene.remove(obj.mesh);
    obj.mesh.geometry.dispose();

    // Replace with smoking remains
    const destroyedBP = destroyedVersions[obj.blueprint.name];
    if (destroyedBP) {
      const newMesh = createMeshFromBlueprint(destroyedBP);
      newMesh.position.set(obj.wx, altToY(obj.alt), obj.wz);
      this.scene.add(newMesh);
      obj.mesh = newMesh;
    }
  }

  // Get objects near a position for collision checks
  getObjectsNear(x, z, radius) {
    const results = [];
    for (const [key, obj] of this.objects) {
      if (obj.destroyed) continue;
      const dx = x - obj.wx;
      const dz = z - obj.wz;
      if (Math.abs(dx) < radius && Math.abs(dz) < radius) {
        results.push(obj);
      }
    }
    return results;
  }

  dispose() {
    for (const [, obj] of this.objects) {
      this.scene.remove(obj.mesh);
      obj.mesh.geometry.dispose();
    }
    this.objects.clear();
  }
}
