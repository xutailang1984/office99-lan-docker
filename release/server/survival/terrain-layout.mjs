// Shared authority/renderer contract. Y up, north -Z, meters. No I/O or services.
export const TERRAIN_GRID = 2;
// Piecewise-linear terrain is bounded below by its cell vertices. Cover the
// complete footprint cells, including negative coordinates and rotated AABBs.
export function footprintBase(x,y,z,width,depth,ground) {
  let minimum=y;
  for(let gx=Math.floor((x-width/2)/TERRAIN_GRID);gx<=Math.ceil((x+width/2)/TERRAIN_GRID);gx++)
    for(let gz=Math.floor((z-depth/2)/TERRAIN_GRID);gz<=Math.ceil((z+depth/2)/TERRAIN_GRID);gz++)minimum=Math.min(minimum,ground(gx*TERRAIN_GRID,gz*TERRAIN_GRID));
  return y-minimum>.08?minimum-.025:y;
}
export const PONDS = Object.freeze([{ id: 'near', x: -43, z: 0, radius: 6 }, { id: 'outer', x: 10, z: 74, radius: 6 }]);
// The practice inlet is temporary room geometry. Adventure terrain never uses it.
export const TRAINING_POND = Object.freeze({ id: 'training', x: 0, z: 29, radius: 6 });
export const BUILDING_SLOTS = Object.freeze([
  ...[-4.5, -1.5, 1.5, 4.5].map((x, i) => ({ id: `W${String(i + 1).padStart(2, '0')}`, kind: 'wall', x, z: -6, yaw: 0 })),
  ...[-4.5, -1.5, 1.5, 4.5].map((z, i) => ({ id: `W${String(i + 5).padStart(2, '0')}`, kind: 'wall', x: 6, z, yaw: -Math.PI / 2 })),
  { id: 'W09', kind: 'wall', x: -4.5, z: 6, yaw: Math.PI },
  { id: 'W10', kind: 'wall', x: -1.5, z: 6, yaw: Math.PI },
  { id: 'G01', kind: 'gate', x: 1.5, z: 6, yaw: Math.PI },
  { id: 'W11', kind: 'wall', x: 4.5, z: 6, yaw: Math.PI },
  ...[-4.5, -1.5, 1.5, 4.5].map((z, i) => ({ id: `W${String(i + 12).padStart(2, '0')}`, kind: 'wall', x: -6, z, yaw: Math.PI / 2 })),
]);
export const ROCKS = Object.freeze([
  { id: 'rock_hunt_01', x: 56, z: -55, width: 3, depth: 3, height: 2.8 },
  { id: 'rock_hunt_02', x: 67, z: -61, width: 4, depth: 3, height: 2.8 },
  { id: 'rock_hunt_03', x: 79, z: -53, width: 3, depth: 4, height: 2.5 },
  { id: 'rock_hunt_04', x: 79, z: -40, width: 4, depth: 3, height: 2.7 },
  { id: 'rock_hunt_05', x: 64, z: -35, width: 3, depth: 3, height: 2.8 },
  { id: 'rock_hunt_06', x: 54, z: -43, width: 3, depth: 4, height: 2.4 },
  { id: 'rock_salvage_01', x: 71, z: 31, width: 3, depth: 3, height: 2.0 },
  { id: 'rock_salvage_02', x: 52, z: 45, width: 3, depth: 3, height: 1.7 },
  { id: 'rock_supply_01', x: -65, z: -40, width: 3, depth: 3, height: 1.8 },
]);

export function rawTerrainHeight(x, z, config = {}) {
  const level = config.level ?? config;
  const radius = level.mainland_radius ?? 42;
  const mainY = level.mainland_height ?? 5;
  const lowY = level.outer_height ?? 1;
  const r = Math.hypot(x, z);
  let h = r <= radius ? mainY : r < radius + 12 ? mainY + (lowY - mainY) * ((r - radius) / 12) : r <= 100 ? lowY : -2;
  const emergency = level.locations?.find(p => p.id === 'emergency') ?? { x: -28, y: 8, z: 20 };
  const outsideSquare = Math.max(0, Math.abs(x - emergency.x) - 4, Math.abs(z - emergency.z) - 4);
  h = Math.max(h, emergency.y - outsideSquare * 0.3);
  const inPond = PONDS.some(p => Math.hypot(x - p.x, z - p.z) <= p.radius)
    || (level.training_pond === true && Math.hypot(x - TRAINING_POND.x, z - TRAINING_POND.z) <= TRAINING_POND.radius);
  const inWestChannel = x <= -43 && x >= -104 && Math.abs(z) <= 1.5;
  const inOuterChannel = x >= 10 && x <= 104 && Math.abs(z - 74) <= 1.5;
  if (inPond || inWestChannel || inOuterChannel) h = -2;
  return h;
}

// Identical to the two triangles generated for each rendered/collidable 2m cell.
// Do not substitute the analytic raw height: interpolation is part of the contract.
export function terrainHeight(x, z, config = {}) {
  const x0 = Math.floor(x / TERRAIN_GRID) * TERRAIN_GRID;
  const z0 = Math.floor(z / TERRAIN_GRID) * TERRAIN_GRID;
  const fx = (x - x0) / TERRAIN_GRID, fz = (z - z0) / TERRAIN_GRID;
  const a = rawTerrainHeight(x0, z0, config), b = rawTerrainHeight(x0 + TERRAIN_GRID, z0, config);
  const c = rawTerrainHeight(x0, z0 + TERRAIN_GRID, config), d = rawTerrainHeight(x0 + TERRAIN_GRID, z0 + TERRAIN_GRID, config);
  return fx + fz <= 1 ? a + (b - a) * fx + (c - a) * fz : d + (c - d) * (1 - fx) + (b - d) * (1 - fz);
}
