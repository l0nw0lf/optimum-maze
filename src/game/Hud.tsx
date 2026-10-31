import { useEffect, useRef, useState } from "react";
import { Ghost, Pause, Play, Share2 } from "lucide-react";
import { CELL, LEVELS, type DifficultyId } from "@/game/maze";
import { COLORS } from "@/game/palette";
import { formatTime, useGame } from "@/game/store";
import { unlockAudio, sfx } from "@/game/audio";
import { isTouchPlay, lockPointer, worldBus } from "@/game/worldBus";

const DIFFS: DifficultyId[] = ["snug", "roam", "vast"];

function Minimap() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const maze = worldBus.maze;
      if (!maze) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const size = canvas.clientWidth || 136;
      const px = Math.max(1, Math.floor(size * dpr));
      if (canvas.width !== px) {
        canvas.width = px;
        canvas.height = px;
      }
      const w = canvas.width;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = COLORS.ink;
      ctx.fillRect(0, 0, w, w);
      const s = (w * 0.84) / Math.max(maze.cols, maze.rows);
      const ox = (w - s * maze.cols) / 2;
      const oy = (w - s * maze.rows) / 2;
      const vis = worldBus.visited;
      ctx.fillStyle = COLORS.floor;
      for (let r = 0; r < maze.rows; r++) {
        for (let c = 0; c < maze.cols; c++) {
          if (!vis[r]?.[c]) continue;
          ctx.fillRect(ox + c * s, oy + r * s, s + 0.75, s + 0.75);
        }
      }
      ctx.strokeStyle = COLORS.ink;
      ctx.lineWidth = Math.max(2, s * 0.14);
      ctx.lineCap = "square";
      ctx.beginPath();
      for (let r = 0; r < maze.rows; r++) {
        for (let c = 0; c < maze.cols; c++) {
          if (!vis[r]?.[c]) continue;
          const x0 = ox + c * s;
          const y0 = oy + r * s;
          const x1 = x0 + s;
          const y1 = y0 + s;
          if (r === 0 || !maze.openS[r - 1]?.[c]) {
            ctx.moveTo(x0, y0);
            ctx.lineTo(x1, y0);
          }
          if (r === maze.rows - 1 || !maze.openS[r]?.[c]) {
            ctx.moveTo(x0, y1);
            ctx.lineTo(x1, y1);
          }
          if (c === 0 || !maze.openE[r]?.[c - 1]) {
            ctx.moveTo(x0, y0);
            ctx.lineTo(x0, y1);
          }
          if (c === maze.cols - 1 || !maze.openE[r]?.[c]) {
            ctx.moveTo(x1, y0);
            ctx.lineTo(x1, y1);
          }
        }
      }
      ctx.stroke();
      ctx.fillStyle = "#f4f4f6";
      for (const g of maze.gems) {
        if (worldBus.taken.has(g.id) || !vis[g.r]?.[g.c]) continue;
        ctx.beginPath();
        ctx.arc(ox + (g.c + 0.5) * s, oy + (g.r + 0.5) * s, Math.max(2.5, s * 0.13), 0, Math.PI * 2);
        ctx.fill();
      }
      if (vis[maze.exit.r]?.[maze.exit.c]) {
        ctx.strokeStyle = COLORS.honey;
        ctx.lineWidth = Math.max(2, s * 0.1);
        ctx.strokeRect(ox + maze.exit.c * s + s * 0.22, oy + maze.exit.r * s + s * 0.22, s * 0.56, s * 0.56);
      }
      const pose = worldBus.pose;
      ctx.save();
      ctx.translate(ox + (pose.x / CELL) * s, oy + (pose.z / CELL) * s);
      ctx.rotate(-pose.yaw);
      ctx.fillStyle = COLORS.sage;
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.28);
      ctx.lineTo(s * 0.16, s * 0.18);
      ctx.lineTo(-s * 0.16, s * 0.18);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} className="minimap" aria-label="Explored paths" />;
}

function Stick() {
  const origin = useRef({ x: 0, y: 0, id: -1 });
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const max = 42;
  const end = (id: number) => {
    if (origin.current.id !== id) return;
    origin.current.id = -1;
    worldBus.moveX = 0;
    worldBus.moveZ = 0;
    setKnob({ x: 0, y: 0 });
  };
  return (
    <div
      data-ui
      className="stick"
      aria-label="Move"
      onPointerDown={(e) => {
        e.stopPropagation();
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          /* some phones refuse capture; the stick still tracks the pointer */
        }
        origin.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
      }}
      onPointerMove={(e) => {
        if (origin.current.id !== e.pointerId) return;
        e.stopPropagation();
        let dx = e.clientX - origin.current.x;
        let dy = e.clientY - origin.current.y;
        const mag = Math.hypot(dx, dy) || 1;
        const scale = mag > max ? max / mag : 1;
        dx *= scale;
        dy *= scale;
        setKnob({ x: dx, y: dy });
        worldBus.moveX = dx / max;
        worldBus.moveZ = -dy / max;
      }}
      onPointerUp={(e) => end(e.pointerId)}
      onPointerCancel={(e) => end(e.pointerId)}
    >
      <span className="knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}

function GateHint() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const on = worldBus.nearGate && useGame.getState().phase === "play";
      setShow((prev) => (prev === on ? prev : on));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  if (!show) return null;
  return (
    <p className="pointer-events-none absolute bottom-28 left-1/2 w-[min(18rem,calc(100%-2rem))] -translate-x-1/2 rounded-full bg-ink/85 px-4 py-2 text-center text-sm font-extrabold text-paper shadow-lg">
      Collect more loops to open the gate
    </p>
  );
}

function Flash() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (ref.current) ref.current.style.opacity = String(Math.min(0.72, worldBus.flash * 0.7));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <div ref={ref} className="pointer-events-none absolute inset-0 bg-[#ffd78a]" style={{ opacity: 0 }} />;
}

function LockHint() {
  const [locked, setLocked] = useState(false);
  useEffect(() => {
    const sync = () => setLocked(document.pointerLockElement != null);
    document.addEventListener("pointerlockchange", sync);
    return () => document.removeEventListener("pointerlockchange", sync);
  }, []);
  if (locked) return null;
  return (
    <button
      type="button"
      data-ui
      className="keys-only pointer-events-auto absolute bottom-6 left-1/2 -translate-x-1/2 rounded-full bg-ink/80 px-4 py-2 text-sm font-extrabold text-paper"
      onClick={() => {
        unlockAudio();
        sfx.ui();
        lockPointer();
      }}
    >
      Click to look
    </button>
  );
}

export function Hud() {
  const phase = useGame((s) => s.phase);
  const difficulty = useGame((s) => s.difficulty);
  const gems = useGame((s) => s.gems);
  const elapsed = useGame((s) => s.elapsed);
  const best = useGame((s) => s.best);
  const sens = useGame((s) => s.sens);
  const total = useGame((s) => s.maze.gems.length);
  const setDifficulty = useGame((s) => s.setDifficulty);
  const setSens = useGame((s) => s.setSens);
  const startRun = useGame((s) => s.startRun);
  const pause = useGame((s) => s.pause);
  const resume = useGame((s) => s.resume);
  const toMenu = useGame((s) => s.toMenu);
  const [shared, setShared] = useState("");

  const shareResult = async () => {
    const line = `gMum. You found the gate. ${formatTime(elapsed)}${best != null ? ` · best ${formatTime(best)}` : ""}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Optimum Maze", text: line });
        return;
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
    }
    try {
      await navigator.clipboard.writeText(line);
      setShared("Copied");
    } catch {
      setShared("Couldn't share");
    }
  };

  const enter = () => {
    unlockAudio();
    sfx.ui();
    startRun();
    if (!isTouchPlay()) lockPointer();
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <Flash />
      {phase !== "menu" && (
        <div className="hud-safe pointer-events-none absolute inset-0 flex items-start justify-between gap-3">
          <div className="flex flex-col items-start gap-2">
            <div className="rounded-2xl bg-ink/85 px-3 py-2 text-paper shadow-lg">
              <p className="text-xs font-extrabold uppercase tracking-widest text-paper/70">Time</p>
              <p className="font-display text-2xl leading-none tabular-nums sm:text-3xl">{formatTime(elapsed)}</p>
            </div>
            <div key={gems} className="pop flex items-center gap-2 rounded-full bg-paper/95 px-3 py-2 text-ink shadow-lg">
              <img src="/loop.png" alt="" className="h-4 w-7 object-contain" />
              <span className="font-extrabold tabular-nums">
                Loops {gems} of {total}
              </span>
            </div>
            {phase === "play" && (
              <button
                type="button"
                data-ui
                className="pointer-events-auto grid h-11 w-11 place-items-center rounded-full bg-ink/85 text-paper shadow-lg"
                aria-label="Pause"
                onClick={() => pause()}
              >
                <Pause className="h-5 w-5" />
              </button>
            )}
          </div>
          {(phase === "play" || phase === "pause" || phase === "win") && <Minimap />}
        </div>
      )}

      {phase === "play" && (
        <>
          <div className="pointer-events-none absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-paper bg-ink/70" />
          <LockHint />
          <GateHint />
          <div className="touch-only hud-safe">
            <Stick />
            <p className="look-hint">Drag to look</p>
          </div>
        </>
      )}

      {phase === "menu" && (
        <div className="absolute inset-0 flex items-start justify-center p-4 pt-5 sm:justify-start sm:p-8">
          <section data-ui className="panel-rise pointer-events-auto w-full max-w-md rounded-3xl border border-ink/10 bg-paper/90 p-5 text-ink shadow-xl backdrop-blur-md sm:p-7">
            <p className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-widest text-sage">
              <Ghost className="h-4 w-4" aria-hidden />
              Optimum Halloween
            </p>
            <h1 className="font-display mt-1 text-4xl italic leading-none sm:text-5xl">Optimum Maze</h1>
            <p className="mt-3 max-w-sm text-base leading-snug text-ink/75">
              A moonlit maze with no time to lose. Collect the Optimum loops to unlock the gate, then reach the golden loop.
            </p>
            <div className="mt-4 grid grid-cols-3 gap-2" role="group" aria-label="Maze size">
              {DIFFS.map((id) => {
                const level = LEVELS[id];
                const on = id === difficulty;
                return (
                  <button
                    key={id}
                    type="button"
                    aria-pressed={on}
                    className={`min-h-11 rounded-2xl px-2 py-2 text-left ${on ? "bg-ink text-paper" : "bg-ink/5 text-ink"}`}
                    onClick={() => setDifficulty(id)}
                  >
                    <span className="block font-extrabold">{level.label}</span>
                    <span className={`block text-xs font-bold ${on ? "text-paper/70" : "text-ink/60"}`}>{level.note}</span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className="mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-sage px-5 font-extrabold text-paper"
              onClick={(e) => {
                e.currentTarget.blur();
                enter();
              }}
            >
              <Play className="h-5 w-5" aria-hidden />
              Enter the mesh
            </button>
            <p className="keys-only mt-3 text-sm font-bold leading-relaxed text-ink/70">
              WASD moves. Mouse to look. Spread the loops.
            </p>
            <p className="touch-copy mt-3 text-sm font-bold leading-relaxed text-ink/70">
              Left pad moves. Drag to look. Spread the loops.
            </p>
            <p className="mt-2 text-sm font-extrabold text-ink/80">
              {best == null ? "No best time yet. Be the first to propagate." : `Best ${formatTime(best)}. Propagate faster.`}
            </p>
          </section>
        </div>
      )}

      {phase === "pause" && (
        <div className="absolute inset-0 flex items-center justify-center p-4">
          <section data-ui className="panel-rise pointer-events-auto w-full max-w-sm rounded-3xl border border-ink/10 bg-paper/95 p-6 text-ink shadow-xl">
            <h2 className="font-display text-4xl italic leading-none">Paused</h2>
            <p className="mt-2 text-sm font-bold text-ink/70">The hedges are listening.</p>
            <label className="mt-5 block text-sm font-extrabold" htmlFor="sens">
              Look sensitivity
            </label>
            <input
              id="sens"
              data-ui
              className="mt-2 w-full accent-sage"
              type="range"
              min={0.001}
              max={0.004}
              step={0.0001}
              value={sens}
              onChange={(e) => setSens(Number(e.target.value))}
            />
            <button
              type="button"
              className="mt-5 flex min-h-12 w-full items-center justify-center rounded-full bg-sage font-extrabold text-paper"
              onClick={() => {
                unlockAudio();
                sfx.ui();
                resume();
                if (!isTouchPlay()) lockPointer();
              }}
            >
              Resume
            </button>
            <button
              type="button"
              className="mt-2 min-h-11 w-full rounded-full font-extrabold text-ink"
              onClick={() => toMenu()}
            >
              Leave the maze
            </button>
          </section>
        </div>
      )}

      {phase === "win" && (
        <div className="absolute inset-0 flex items-end justify-center p-4 pb-8 sm:items-center">
          <section data-ui className="panel-rise pointer-events-auto w-full max-w-sm rounded-3xl border border-ink/10 bg-paper/95 p-6 text-ink shadow-xl">
            <img src="/loop.png" alt="" className="gold-loop mx-auto" />
            <h2 className="font-display mt-3 text-3xl italic leading-tight sm:text-4xl">gMum. You found the gate.</h2>
            <p className="font-display mt-4 text-4xl tabular-nums leading-none">{formatTime(elapsed)}</p>
            <p className="mt-2 text-sm font-extrabold text-ink/75">
              {best != null ? `Best ${formatTime(best)}` : "No best time yet"}
            </p>
            <button
              type="button"
              className="mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-full bg-sage font-extrabold text-paper"
              onClick={() => void shareResult()}
            >
              <Share2 className="h-5 w-5" aria-hidden />
              {shared || "Share the result"}
            </button>
            <button
              type="button"
              className="mt-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-full font-extrabold text-ink"
              onClick={(e) => {
                e.currentTarget.blur();
                enter();
              }}
            >
              <Play className="h-5 w-5" aria-hidden />
              Another night
            </button>
            <button type="button" className="mt-2 min-h-11 w-full rounded-full font-extrabold text-ink" onClick={() => toMenu()}>
              Back to the gatehouse
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
