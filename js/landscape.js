// Landscape generation using Fourier synthesis, matching the original Lander formula
// Original Y-axis points down; in Three.js Y points up, so we negate altitude

import * as THREE from 'three';
import {
  TILE_SIZE, TILES_X, TILES_Z,
  LAUNCHPAD_ALTITUDE, SEA_LEVEL, LAND_MID_HEIGHT, LAUNCHPAD_SIZE,
} from './constants.js';

// Generate altitude at world coordinate (x, z)
// Returns altitude in original coordinate system (higher value = lower in world)
export function getAltitude(x, z) {
  // Sine table: 1024 entries covering full 2*PI cycle.
  // Arguments use top 10 bits of 32-bit fixed-point, so one full cycle = 256 tiles.
  // After lookup, first 4 terms are ASR #7 (peak = TILE_SIZE), last 2 ASR #8 (peak = 0.5).
  const s = (angle) => Math.sin(angle * 2 * Math.PI / 256);

  // The 4th term is sin(7x+5z), NOT sin(3x+3z) as the comments say.
  // The source has LSL #2 (×4) but the comment incorrectly computes it as ×2.
  // Tracing: R1=z+2x → R1=z+(z+2x)*4=8x+5z → R1=8x+5z-x=7x+5z
  let alt = s(x - 2*z) + s(4*x + 3*z) + s(3*z - 5*x) + s(7*x + 5*z)
          + 0.5 * s(5*x + 11*z) + 0.5 * s(10*x + 7*z);
  alt = LAND_MID_HEIGHT - alt;

  // Clamp to sea level (max altitude value = deepest terrain = sea)
  if (alt > SEA_LEVEL) alt = SEA_LEVEL;

  // Launchpad region: flat area at known altitude
  if (x >= 0 && x < LAUNCHPAD_SIZE && z >= 0 && z < LAUNCHPAD_SIZE) {
    alt = LAUNCHPAD_ALTITUDE;
  }

  return alt;
}

// Convert original altitude to Three.js Y (negate because original Y-down)
export function altToY(alt) {
  return -alt;
}

// Get Three.js Y height at world (x, z)
export function getHeight(x, z) {
  return altToY(getAltitude(x, z));
}

// Calculate tile color exactly matching the original ARM source GetLandscapeTileColour.
// The original uses 4-bit R, G, B channels (0-15 each).
function getTileColor(altitude, prevAltitude, tileRow, totalRows) {
  const alt = altitude;
  const prev = prevAltitude;

  // Slope: max(0, prevAltitude - altitude). Positive when terrain faces left.
  // In original fixed-point; here we convert to the equivalent integer bits.
  const slopeFloat = Math.max(0, prev - alt);

  // Convert altitude to the original fixed-point integer for bit extraction
  // Original altitude is in fixed-point where TILE_SIZE = 0x01000000
  const altInt = Math.round(alt * 0x01000000);

  // Base channels from altitude bits (original lines 1600-1609)
  // Green: bit 3 of altitude → 4 if clear, 8 if set
  let g = (altInt & 0x00000008) ? 8 : 4;
  // Red: bit 2 of altitude
  let r = (altInt & 0x00000004) ? 4 : 0;
  let b = 0;

  // Launchpad: grey (R=4, G=4, B=4)
  if (Math.abs(alt - LAUNCHPAD_ALTITUDE) < 0.001) {
    r = 4; g = 4; b = 4;
  }

  // Sea: blue (R=0, G=0, B=4)
  if (Math.abs(alt - SEA_LEVEL) < 0.001 && Math.abs(prev - SEA_LEVEL) < 0.001) {
    r = 0; g = 0; b = 4;
  }

  // Brightness = tileCornerRow + (slope >> 22)
  // Remap our extended row range into the original 1–10.
  const slopeContrib = Math.floor(slopeFloat * 4);
  const remappedRow = Math.min(10, Math.max(1, Math.round(tileRow / totalRows * 10)));
  const brightness = remappedRow + slopeContrib;

  r = Math.min(15, r + brightness);
  g = Math.min(15, g + brightness);
  b = Math.min(15, b + brightness);

  // The original VIDC palette is non-linear — raw 4-bit values map to dimmer
  // colours than a linear 0–1 scale. Apply a gamma-like curve to match.
  const gamma = (v) => Math.pow(v / 15, 1.4);
  return new THREE.Color(gamma(r), gamma(g), gamma(b));
}

export function createLandscape(scene, playerX, playerZ) {
  // The visible landscape is centered on the player
  // We create a grid of TILES_X x TILES_Z corners
  const startX = Math.floor(playerX / TILE_SIZE) * TILE_SIZE - Math.floor(TILES_X / 2) * TILE_SIZE;
  const startZ = playerZ - CAMERA_OFFSET_Z_INTERNAL;

  return buildLandscapeMesh(scene, startX, startZ);
}

const CAMERA_OFFSET_Z_INTERNAL = 5 * TILE_SIZE;

export class LandscapeRenderer {
  constructor(scene) {
    this.scene = scene;
    this.mesh = null;
    this.seaMesh = null;
  }

  update(playerX, playerZ) {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
    }
    if (this.seaMesh) {
      this.scene.remove(this.seaMesh);
      this.seaMesh.geometry.dispose();
    }

    // Render a larger area than the original for better visibility
    const RENDER_X = 25;  // corners (24 tiles wide)
    const RENDER_Z = 20;  // corners (19 tiles deep)

    const startX = Math.floor(playerX) - Math.floor(RENDER_X / 2);
    const startZ = Math.floor(playerZ) - Math.floor(RENDER_Z / 2) - 2;

    const positions = [];
    const colors = [];
    const indices = [];

    // Generate corner altitudes
    const altitudes = [];
    for (let iz = 0; iz < RENDER_Z; iz++) {
      altitudes[iz] = [];
      for (let ix = 0; ix < RENDER_X; ix++) {
        const wx = startX + ix * TILE_SIZE;
        const wz = startZ + iz * TILE_SIZE;
        altitudes[iz][ix] = getAltitude(wx, wz);
      }
    }

    // Build triangles for each tile
    let vertIdx = 0;
    for (let iz = 0; iz < RENDER_Z - 1; iz++) {
      for (let ix = 0; ix < RENDER_X - 1; ix++) {
        const wx = startX + ix * TILE_SIZE;
        const wz = startZ + iz * TILE_SIZE;

        const a00 = altitudes[iz][ix];
        const a10 = altitudes[iz][ix + 1];
        const a01 = altitudes[iz + 1][ix];
        const a11 = altitudes[iz + 1][ix + 1];

        // Tile color based on slope (left-to-right altitude change)
        const tileRow = iz + 1;
        const color = getTileColor(a10, a00, tileRow, RENDER_Z - 1);

        // Four corners in Three.js coordinates
        const x0 = wx, x1 = wx + TILE_SIZE;
        const z0 = wz, z1 = wz + TILE_SIZE;
        const y00 = altToY(a00), y10 = altToY(a10);
        const y01 = altToY(a01), y11 = altToY(a11);

        // Two triangles per quad
        positions.push(x0, y00, z0, x1, y10, z0, x1, y11, z1);
        positions.push(x0, y00, z0, x1, y11, z1, x0, y01, z1);

        for (let t = 0; t < 6; t++) {
          colors.push(color.r, color.g, color.b);
        }

        indices.push(vertIdx, vertIdx + 1, vertIdx + 2);
        indices.push(vertIdx + 3, vertIdx + 4, vertIdx + 5);
        vertIdx += 6;
      }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    // Use MeshBasicMaterial — the original bakes brightness into tile colors
    // (no real-time lighting on terrain)
    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(geometry, material);
    this.scene.add(this.mesh);

    // Sea plane
    const seaY = altToY(SEA_LEVEL);
    const seaGeom = new THREE.PlaneGeometry(
      (RENDER_X + 30) * TILE_SIZE,
      (RENDER_Z + 30) * TILE_SIZE
    );
    seaGeom.rotateX(-Math.PI / 2);

    const seaMat = new THREE.MeshLambertMaterial({
      color: 0x112244,
      transparent: true,
      opacity: 0.6,
      side: THREE.DoubleSide,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: 1,
      polygonOffsetUnits: 1,
    });
    this.seaMesh = new THREE.Mesh(seaGeom, seaMat);
    this.seaMesh.renderOrder = -1;
    this.seaMesh.position.set(
      startX + (RENDER_X / 2) * TILE_SIZE,
      seaY - 0.02,  // slightly below sea level to avoid z-fighting
      startZ + (RENDER_Z / 2) * TILE_SIZE
    );
    this.scene.add(this.seaMesh);
  }

  dispose() {
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
    }
    if (this.seaMesh) {
      this.scene.remove(this.seaMesh);
      this.seaMesh.geometry.dispose();
    }
  }
}
