import { create } from "zustand";
import {
  PREVIEW_SEED,
  generateMaze,
  makeQaMaze,
  type DifficultyId,
  type MazeData,
} from "@/game/maze";
import { adoptMaze, unlockPointer, worldBus } from "@/game/worldBus";

const BEST_KEY = "lumenfold-best-v1";
const SENS_KEY = "lumenfold-sens";
const DIFF_KEY = "lumenfold-diff";

export type Phase = "menu" | "play" | "pause" | "win";

type State = {
  phase: Phase;
  difficulty: DifficultyId;
  maze: MazeData;
  runId: number;
  gems: number;
  elapsed: number;
  best: number | null;
  record: boolean;
  hadBest: boolean;
  plot: number;
  sens: number;
  reduced: boolean;
  hydrate: () => void;
  setDifficulty: (d: DifficultyId) => void;
  startRun: () => void;
  startQa: () => void;
  pause: () => void;
  resume: () => void;
  toMenu: () => void;
  collect: () => void;
  setElapsed: (t: number) => void;
  win: (t: number) => void;
  setSens: (n: number) => void;
};

function readJson<T>(key: string): T | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function loadBest(d: DifficultyId): number | null {
  const obj = readJson<Partial<Record<DifficultyId, number>>>(BEST_KEY);
  const n = obj?.[d];
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

function saveBest(d: DifficultyId, time: number) {
  try {
    const obj = readJson<Partial<Record<DifficultyId, number>>>(BEST_KEY) ?? {};
    obj[d] = time;
    localStorage.setItem(BEST_KEY, JSON.stringify(obj));
  } catch {
    /* private mode */
  }
}

const preview = generateMaze("roam", PREVIEW_SEED);
adoptMaze(preview);

export const useGame = create<State>((set, get) => ({
  phase: "menu",
  difficulty: "roam",
  maze: preview,
  runId: 0,
  gems: 0,
  elapsed: 0,
  best: null,
  record: false,
  hadBest: false,
  plot: preview.seed,
  sens: 0.00215,
  reduced: false,
  hydrate: () => {
    let difficulty: DifficultyId = "roam";
    try {
      const saved = localStorage.getItem(DIFF_KEY);
      if (saved === "snug" || saved === "roam" || saved === "vast") difficulty = saved;
    } catch {
      /* ignore */
    }
    let sens = 0.00215;
    try {
      const raw = Number(localStorage.getItem(SENS_KEY));
      if (Number.isFinite(raw)) sens = Math.min(0.004, Math.max(0.001, raw));
    } catch {
      /* ignore */
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    worldBus.touch = window.matchMedia("(pointer: coarse)").matches;
    const maze = get().phase === "menu" ? generateMaze(difficulty, PREVIEW_SEED) : get().maze;
    if (get().phase === "menu") adoptMaze(maze);
    set({ difficulty, maze, best: loadBest(difficulty), sens, reduced });
  },
  setDifficulty: (d) => {
    if (get().phase !== "menu") return;
    try {
      localStorage.setItem(DIFF_KEY, d);
    } catch {
      /* ignore */
    }
    const maze = generateMaze(d, PREVIEW_SEED);
    adoptMaze(maze);
    set({ difficulty: d, maze, best: loadBest(d) });
  },
  startRun: () => {
    const maze = get().maze;
    adoptMaze(maze);
    set({
      phase: "play",
      maze,
      runId: get().runId + 1,
      gems: 0,
      elapsed: 0,
      record: false,
      hadBest: false,
      plot: maze.seed,
    });
  },
  startQa: () => {
    const maze = makeQaMaze();
    adoptMaze(maze);
    set({
      phase: "play",
      maze,
      runId: get().runId + 1,
      gems: 0,
      elapsed: 0,
      record: false,
      hadBest: false,
      plot: maze.seed,
    });
  },
  pause: () => {
    if (get().phase !== "play") return;
    worldBus.moveX = 0;
    worldBus.moveZ = 0;
    unlockPointer();
    set({ phase: "pause" });
  },
  resume: () => {
    if (get().phase !== "pause") return;
    set({ phase: "play" });
  },
  toMenu: () => {
    const maze = generateMaze(get().difficulty, PREVIEW_SEED);
    adoptMaze(maze);
    unlockPointer();
    set({
      phase: "menu",
      maze,
      gems: 0,
      elapsed: 0,
      record: false,
      hadBest: false,
      plot: maze.seed,
    });
  },
  collect: () => set((s) => ({ gems: s.gems + 1 })),
  setElapsed: (t) => set({ elapsed: t }),
  win: (time) => {
    const { difficulty, best } = get();
    const hadBest = best != null;
    const record = best == null || time < best;
    if (record) saveBest(difficulty, time);
    unlockPointer();
    worldBus.moveX = 0;
    worldBus.moveZ = 0;
    set({
      phase: "win",
      plot: get().maze.seed,
      elapsed: time,
      best: record ? time : best,
      record,
      hadBest,
    });
    const nextSeed = Math.floor(Math.random() * 0x7ffffffe) + 1;
    window.setTimeout(() => {
      if (get().phase !== "win") return;
      const next = generateMaze(difficulty, nextSeed);
      adoptMaze(next);
      set({ maze: next });
    }, 400);
  },
  setSens: (n) => {
    const sens = Math.min(0.004, Math.max(0.001, n));
    try {
      localStorage.setItem(SENS_KEY, String(sens));
    } catch {
      /* ignore */
    }
    set({ sens });
  },
}));

export function formatTime(s: number) {
  if (!Number.isFinite(s) || s < 0) s = 0;
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.floor((s * 100) % 100);
  return `${m}:${String(sec).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}
