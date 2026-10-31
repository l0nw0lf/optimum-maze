import { freshVisited, type MazeData } from "@/game/maze";

export type Spark = {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
};

export type ControlsProbe = {
  getYaw: () => number;
  getSpeed: () => number;
  getPos: () => { x: number; z: number };
  setKeys: (codes: string[]) => void;
};

declare global {
  interface Window {
    __controlsTest?: ControlsProbe;
  }
}

export const worldBus = {
  maze: null as MazeData | null,
  visited: [] as boolean[][],
  taken: new Set<number>(),
  sparks: [] as Spark[],
  pose: { x: 0, z: 0, yaw: 0, speed: 0 },
  moveX: 0,
  moveZ: 0,
  lookX: 0,
  lookY: 0,
  inject: null as string[] | null,
  canvas: null as HTMLCanvasElement | null,
  touch: false,
  hadLock: false,
  dragging: false,
  gateOpen: false,
  gateSwing: 0,
  nearGate: false,
  flash: 0,
};

export function isTouchPlay() {
  if (typeof window === "undefined") return false;
  const touch =
    window.matchMedia("(pointer: coarse)").matches || window.matchMedia("(max-width: 820px)").matches;
  worldBus.touch = touch;
  return touch;
}

export function adoptMaze(maze: MazeData) {
  worldBus.maze = maze;
  worldBus.visited = freshVisited(maze);
  worldBus.taken = new Set();
  worldBus.sparks.length = 0;
  worldBus.pose.x = maze.start.x;
  worldBus.pose.z = maze.start.z;
  worldBus.pose.yaw = maze.yaw;
  worldBus.pose.speed = 0;
  worldBus.moveX = 0;
  worldBus.moveZ = 0;
  worldBus.lookX = 0;
  worldBus.lookY = 0;
  worldBus.inject = null;
  worldBus.gateOpen = maze.qa || maze.gems.length === 0;
  worldBus.gateSwing = worldBus.gateOpen ? 1 : 0;
  worldBus.nearGate = false;
  worldBus.flash = 0;
}

export function emitSparks(x: number, y: number, z: number, count = 8) {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const speed = 1.35 + (i % 3) * 0.4;
    worldBus.sparks.push({
      x,
      y,
      z,
      vx: Math.cos(a) * speed,
      vy: 1.8 + (i % 4) * 0.35,
      vz: Math.sin(a) * speed,
      life: 0.48,
      max: 0.48,
    });
  }
  if (worldBus.sparks.length > 48) {
    worldBus.sparks.splice(0, worldBus.sparks.length - 48);
  }
}

export function lockPointer() {
  const canvas = worldBus.canvas;
  if (!canvas || isTouchPlay()) return;
  const el = canvas as HTMLCanvasElement & {
    requestPointerLock: (opts?: { unadjustedMovement?: boolean }) => Promise<void> | void;
  };
  try {
    const pending = el.requestPointerLock({ unadjustedMovement: true });
    if (pending && typeof (pending as Promise<void>).catch === "function") {
      void (pending as Promise<void>).catch(() => {
        try {
          canvas.requestPointerLock();
        } catch {
          /* pointer lock is optional */
        }
      });
    }
  } catch {
    try {
      canvas.requestPointerLock();
    } catch {
      /* drag-to-look still works */
    }
  }
}

export function unlockPointer() {
  if (typeof document !== "undefined" && document.pointerLockElement) {
    document.exitPointerLock();
  }
}
