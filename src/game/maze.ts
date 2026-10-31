export const CELL = 3.55;
export const WALL_T = 0.46;
export const WALL_H = 2.42;
export const PLAYER_R = 0.36;
export const EYE = 1.55;

export type DifficultyId = "snug" | "roam" | "vast";

export const LEVELS: Record<
  DifficultyId,
  { cols: number; rows: number; gems: number; label: string; note: string }
> = {
  snug: { cols: 9, rows: 9, gems: 6, label: "Node", note: "A quick hop" },
  roam: { cols: 13, rows: 13, gems: 10, label: "Mesh", note: "The pumpkin path" },
  vast: { cols: 17, rows: 17, gems: 14, label: "Network", note: "Don't look back" },
};

export const PREVIEW_SEED = 11;

export function loopsNeeded(total: number) {
  if (total <= 0) return 0;
  return Math.max(1, Math.ceil(total * 0.6));
}

export type WallBox = {
  x: number;
  y: number;
  z: number;
  sx: number;
  sy: number;
  sz: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  tint: 0 | 1 | 2;
};

export type Gem = { id: number; c: number; r: number; x: number; z: number };
export type CellPos = { c: number; r: number; x: number; z: number };
export type Prop = { x: number; z: number; s: number; kind: 0 | 1; rot: number };

export type MazeData = {
  cols: number;
  rows: number;
  seed: number;
  openE: boolean[][];
  openS: boolean[][];
  walls: WallBox[];
  start: CellPos;
  exit: CellPos;
  gems: Gem[];
  props: Prop[];
  yaw: number;
  qa: boolean;
};

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rng: () => number) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j] as T;
    arr[j] = tmp as T;
  }
  return arr;
}

export function cellCenter(c: number, r: number) {
  return { x: (c + 0.5) * CELL, z: (r + 0.5) * CELL };
}

/** yaw 0 faces world −Z. A/D are strafe, not steer. */
export function fpsBasis(yaw: number) {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  return {
    forwardX: -sin,
    forwardZ: -cos,
    rightX: cos,
    rightZ: -sin,
  };
}

export function wishFromInput(yaw: number, ix: number, iz: number) {
  const b = fpsBasis(yaw);
  let x = ix;
  let z = iz;
  const mag = Math.hypot(x, z);
  if (mag > 1) {
    x /= mag;
    z /= mag;
  }
  return {
    wishX: b.forwardX * z + b.rightX * x,
    wishZ: b.forwardZ * z + b.rightZ * x,
    mag: Math.min(1, mag),
  };
}

function neighbors(
  openE: boolean[][],
  openS: boolean[][],
  cols: number,
  rows: number,
  c: number,
  r: number,
) {
  const out: [number, number][] = [];
  if (c > 0 && openE[r]?.[c - 1]) out.push([c - 1, r]);
  if (c < cols - 1 && openE[r]?.[c]) out.push([c + 1, r]);
  if (r > 0 && openS[r - 1]?.[c]) out.push([c, r - 1]);
  if (r < rows - 1 && openS[r]?.[c]) out.push([c, r + 1]);
  return out;
}

function buildWalls(cols: number, rows: number, openE: boolean[][], openS: boolean[][]) {
  const walls: WallBox[] = [];
  const push = (x: number, z: number, sx: number, sz: number, tint: 0 | 1 | 2) => {
    walls.push({
      x,
      y: WALL_H / 2,
      z,
      sx,
      sy: WALL_H,
      sz,
      minX: x - sx / 2,
      maxX: x + sx / 2,
      minZ: z - sz / 2,
      maxZ: z + sz / 2,
      tint,
    });
  };

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c <= cols; c++) {
      const blocked = c === 0 || c === cols || !openE[r]?.[c - 1];
      if (!blocked) continue;
      const tint = ((r + c) % 3) as 0 | 1 | 2;
      push(c * CELL, (r + 0.5) * CELL, WALL_T, CELL + WALL_T, tint);
    }
  }
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c < cols; c++) {
      const blocked = r === 0 || r === rows || !openS[r - 1]?.[c];
      if (!blocked) continue;
      const tint = ((r + c * 2) % 3) as 0 | 1 | 2;
      push((c + 0.5) * CELL, r * CELL, CELL - WALL_T, WALL_T, tint);
    }
  }
  return walls;
}

function openingYaw(
  openE: boolean[][],
  openS: boolean[][],
  c: number,
  r: number,
  cols: number,
  rows: number,
) {
  if (c < cols - 1 && openE[r]?.[c]) return -Math.PI / 2;
  if (r < rows - 1 && openS[r]?.[c]) return Math.PI;
  if (c > 0 && openE[r]?.[c - 1]) return Math.PI / 2;
  return 0;
}

function scatterProps(cols: number, rows: number, rng: () => number): Prop[] {
  const props: Prop[] = [];
  const spanX = cols * CELL;
  const spanZ = rows * CELL;
  for (let i = 0; i < 26; i++) {
    const edge = Math.floor(rng() * 4);
    const along = rng();
    const out = 1.5 + rng() * 3.4;
    let x = 0;
    let z = 0;
    if (edge === 0) {
      x = along * spanX;
      z = -out;
    } else if (edge === 1) {
      x = spanX + out;
      z = along * spanZ;
    } else if (edge === 2) {
      x = along * spanX;
      z = spanZ + out;
    } else {
      x = -out;
      z = along * spanZ;
    }
    props.push({
      x,
      z,
      s: 0.75 + rng() * 0.95,
      kind: rng() > 0.45 ? 1 : 0,
      rot: rng() * Math.PI,
    });
  }
  return props;
}

export function generateMaze(difficulty: DifficultyId, seed: number): MazeData {
  const { cols, rows, gems: gemCount } = LEVELS[difficulty];
  const rng = mulberry32(seed || 1);
  const openE = Array.from({ length: rows }, () => Array<boolean>(cols - 1).fill(false));
  const openS = Array.from({ length: rows - 1 }, () => Array<boolean>(cols).fill(false));
  const seen = Array.from({ length: rows }, () => Array<boolean>(cols).fill(false));

  const carve = (c: number, r: number) => {
    seen[r]![c] = true;
    const dirs = shuffle(
      [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ],
      rng,
    );
    for (const [dc, dr] of dirs) {
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows || seen[nr]?.[nc]) continue;
      if (dc === 1) openE[r]![c] = true;
      if (dc === -1) openE[r]![nc] = true;
      if (dr === 1) openS[r]![c] = true;
      if (dr === -1) openS[nr]![c] = true;
      carve(nc, nr);
    }
  };
  carve(0, 0);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols - 1; c++) {
      if (!openE[r]?.[c] && rng() < 0.13) openE[r]![c] = true;
    }
  }
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols; c++) {
      if (!openS[r]?.[c] && rng() < 0.13) openS[r]![c] = true;
    }
  }

  const dist = Array.from({ length: rows }, () => Array<number>(cols).fill(-1));
  const queue: [number, number][] = [[0, 0]];
  dist[0]![0] = 0;
  for (let i = 0; i < queue.length; i++) {
    const [c, r] = queue[i]!;
    for (const [nc, nr] of neighbors(openE, openS, cols, rows, c, r)) {
      if (dist[nr]![nc] !== -1) continue;
      dist[nr]![nc] = dist[r]![c]! + 1;
      queue.push([nc, nr]);
    }
  }

  let farC = 0;
  let farR = 0;
  let best = -1;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const d = dist[r]![c]!;
      if (d > best) {
        best = d;
        farC = c;
        farR = r;
      }
    }
  }

  const pool: { c: number; r: number; d: number; deg: number }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if ((c === 0 && r === 0) || (c === farC && r === farR)) continue;
      const d = dist[r]![c]!;
      if (d < 2) continue;
      pool.push({
        c,
        r,
        d,
        deg: neighbors(openE, openS, cols, rows, c, r).length,
      });
    }
  }
  const dead = shuffle(
    pool.filter((p) => p.deg <= 1),
    rng,
  );
  const rest = shuffle(
    pool.filter((p) => p.deg > 1),
    rng,
  );
  const gems: Gem[] = [...dead, ...rest].slice(0, gemCount).map((p, id) => ({
    id,
    c: p.c,
    r: p.r,
    ...cellCenter(p.c, p.r),
  }));

  const start = { c: 0, r: 0, ...cellCenter(0, 0) };
  const exit = { c: farC, r: farR, ...cellCenter(farC, farR) };
  return {
    cols,
    rows,
    seed,
    openE,
    openS,
    walls: buildWalls(cols, rows, openE, openS),
    start,
    exit,
    gems,
    props: scatterProps(cols, rows, rng),
    yaw: openingYaw(openE, openS, 0, 0, cols, rows),
    qa: false,
  };
}

export function makeQaMaze(): MazeData {
  const cols = 7;
  const rows = 7;
  const openE = Array.from({ length: rows }, () => Array<boolean>(cols - 1).fill(true));
  const openS = Array.from({ length: rows - 1 }, () => Array<boolean>(cols).fill(true));
  const start = { c: 3, r: 3, ...cellCenter(3, 3) };
  const exit = { c: 6, r: 6, ...cellCenter(6, 6) };
  return {
    cols,
    rows,
    seed: 1,
    openE,
    openS,
    walls: buildWalls(cols, rows, openE, openS),
    start,
    exit,
    gems: [],
    props: [],
    yaw: 0,
    qa: true,
  };
}

export function freshVisited(maze: MazeData) {
  const visited = Array.from({ length: maze.rows }, () => Array<boolean>(maze.cols).fill(false));
  visited[maze.start.r]![maze.start.c] = true;
  return visited;
}

export function circleBlocked(
  x: number,
  z: number,
  radius: number,
  walls: readonly WallBox[],
) {
  const r2 = radius * radius - 1e-6;
  for (let i = 0; i < walls.length; i++) {
    const w = walls[i]!;
    if (x + radius <= w.minX || x - radius >= w.maxX || z + radius <= w.minZ || z - radius >= w.maxZ) {
      continue;
    }
    const nx = x < w.minX ? w.minX : x > w.maxX ? w.maxX : x;
    const nz = z < w.minZ ? w.minZ : z > w.maxZ ? w.maxZ : z;
    const dx = x - nx;
    const dz = z - nz;
    if (dx * dx + dz * dz < r2) return true;
  }
  return false;
}

export function unstick(x: number, z: number, radius: number, walls: readonly WallBox[]) {
  if (!circleBlocked(x, z, radius, walls)) return { x, z };
  for (let ring = 1; ring <= 10; ring++) {
    const d = ring * 0.07;
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      const nx = x + Math.cos(ang) * d;
      const nz = z + Math.sin(ang) * d;
      if (!circleBlocked(nx, nz, radius, walls)) return { x: nx, z: nz };
    }
  }
  return { x, z };
}

export function moveWithWalls(
  x: number,
  z: number,
  vx: number,
  vz: number,
  dt: number,
  walls: readonly WallBox[],
  radius = PLAYER_R,
) {
  const dist = Math.hypot(vx, vz) * dt;
  const steps = Math.max(1, Math.min(16, Math.ceil(dist / (radius * 0.4))));
  const sdt = dt / steps;
  let hitX = false;
  let hitZ = false;
  for (let s = 0; s < steps; s++) {
    const nx = x + vx * sdt;
    if (circleBlocked(nx, z, radius, walls)) {
      hitX = true;
      vx = 0;
    } else {
      x = nx;
    }
    const nz = z + vz * sdt;
    if (circleBlocked(x, nz, radius, walls)) {
      hitZ = true;
      vz = 0;
    } else {
      z = nz;
    }
  }
  return { x, z, vx, vz, hitX, hitZ };
}
