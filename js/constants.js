// Lander constants - converted from ARM assembly fixed-point to float
// Original TILE_SIZE = 0x01000000, so we divide hex values by 0x01000000

export const TILE_SIZE = 1.0;
export const TILES_X = 13;       // 13 corners = 12 tiles wide
export const TILES_Z = 11;       // 11 corners = 10 tiles deep

export const LAUNCHPAD_ALTITUDE = 0x03500000 / 0x01000000;  // 3.3125
export const SEA_LEVEL = 0x05500000 / 0x01000000;           // 5.3125
export const LAND_MID_HEIGHT = 5.0;

export const LAUNCHPAD_SIZE = 8.0;  // 8 tile sizes

export const UNDERCARRIAGE_Y = 0x00640000 / 0x01000000;  // ~0.390625
export const LANDING_SPEED = 0x00200000 / 0x01000000;     // ~0.125

export const HIGHEST_ALTITUDE = 52.0;  // Engines cut above this

export const CAMERA_OFFSET_Z = (TILES_Z - 6) * TILE_SIZE;  // 5 tiles behind player

export const GRAVITY_INITIAL = 0x00000004 / 0x01000000;  // Very small per frame
export const FRICTION = 1 / 64;

export const MAX_PARTICLES = 484;

// Player starting position
export const START_X = LAUNCHPAD_SIZE / 2;
export const START_Z = LAUNCHPAD_SIZE / 2;
export const START_Y = LAUNCHPAD_ALTITUDE - UNDERCARRIAGE_Y;

// Convert 32-bit signed hex to float, divided by TILE_SIZE (0x01000000)
export function hex2float(hex) {
  if (hex >= 0x80000000) hex -= 0x100000000;
  return hex / 0x01000000;
}

// Convert 12-bit color (0xRGB, 4 bits each) to Three.js color
export function colorFromRGB4(c) {
  const r = ((c >> 8) & 0xF) / 15;
  const g = ((c >> 4) & 0xF) / 15;
  const b = (c & 0xF) / 15;
  return [r, g, b];
}
