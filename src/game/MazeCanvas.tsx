import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { COLORS } from "@/game/palette";
import {
  CELL,
  EYE,
  PLAYER_R,
  WALL_H,
  loopsNeeded,
  moveWithWalls,
  unstick,
  wishFromInput,
  type MazeData,
  type WallBox,
} from "@/game/maze";
import { sfx, unlockAudio } from "@/game/audio";
import { useGame } from "@/game/store";
import { emitSparks, isTouchPlay, lockPointer, worldBus } from "@/game/worldBus";

const TINTS = [COLORS.sageDeep, COLORS.hedgeMid, COLORS.sageLeaf] as const;

function WallLayer({ walls, color, lip = false }: { walls: WallBox[]; color: string; lip?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < walls.length; i++) {
      const w = walls[i]!;
      dummy.position.set(w.x, lip ? WALL_H + 0.09 : w.y, w.z);
      dummy.scale.set(w.sx, lip ? 0.16 : w.sy, w.sz);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [walls, lip]);
  if (walls.length === 0) return null;
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, walls.length]} frustumCulled={false}>
      <boxGeometry args={[1, 1, 1]} />
      <meshLambertMaterial color={color} />
    </instancedMesh>
  );
}

function Hedges({ walls }: { walls: WallBox[] }) {
  const layers = useMemo(() => {
    const groups: WallBox[][] = [[], [], []];
    for (const w of walls) groups[w.tint].push(w);
    return groups;
  }, [walls]);
  return (
    <group>
      {layers.map((group, i) => (
        <WallLayer key={i} walls={group} color={TINTS[i]!} />
      ))}
      <WallLayer walls={walls} color={COLORS.hedgeTop} lip />
    </group>
  );
}

function Floor({ cols, rows }: { cols: number; rows: number }) {
  const tex = useMemo(() => {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const g = canvas.getContext("2d");
    if (!g) return null;
    g.fillStyle = COLORS.floor;
    g.fillRect(0, 0, 128, 128);
    g.strokeStyle = "rgba(26,16,34,0.14)";
    g.lineWidth = 4;
    g.strokeRect(3, 3, 122, 122);
    g.fillStyle = "rgba(227,107,34,0.28)";
    g.beginPath();
    g.arc(64, 64, 7, 0, Math.PI * 2);
    g.fill();
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(cols, rows);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  }, [cols, rows]);
  useEffect(() => () => tex?.dispose(), [tex]);
  const w = cols * CELL;
  const h = rows * CELL;
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[w / 2, 0, h / 2]}>
        <planeGeometry args={[w + 36, h + 36]} />
        <meshLambertMaterial color={COLORS.lawn} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[w / 2, 0.02, h / 2]}>
        <planeGeometry args={[w, h]} />
        <meshLambertMaterial color={COLORS.floor} map={tex ?? undefined} />
      </mesh>
    </group>
  );
}

function Shrubs({ maze }: { maze: MazeData }) {
  const a = useRef<THREE.InstancedMesh>(null);
  const b = useRef<THREE.InstancedMesh>(null);
  const split = useMemo(() => {
    const deep = maze.props.filter((p) => p.kind === 0);
    const leaf = maze.props.filter((p) => p.kind === 1);
    return { deep, leaf };
  }, [maze]);
  useLayoutEffect(() => {
    const place = (mesh: THREE.InstancedMesh | null, list: typeof split.deep) => {
      if (!mesh) return;
      const dummy = new THREE.Object3D();
      list.forEach((p, i) => {
        dummy.position.set(p.x, p.kind ? p.s * 0.32 : p.s * 0.5, p.z);
        dummy.scale.set(p.s, p.s * (p.kind ? 0.78 : 0.95), p.s);
        dummy.rotation.set(0, p.rot, 0);
        dummy.updateMatrix();
        mesh.setMatrixAt(i, dummy.matrix);
      });
      mesh.instanceMatrix.needsUpdate = true;
    };
    place(a.current, split.deep);
    place(b.current, split.leaf);
  }, [split]);
  return (
    <group>
      {split.deep.length > 0 && (
        <instancedMesh ref={a} args={[undefined, undefined, split.deep.length]} frustumCulled={false}>
          <coneGeometry args={[0.5, 1.15, 5]} />
          <meshLambertMaterial color={COLORS.sageDeep} flatShading />
        </instancedMesh>
      )}
      {split.leaf.length > 0 && (
        <instancedMesh ref={b} args={[undefined, undefined, split.leaf.length]} frustumCulled={false}>
          <sphereGeometry args={[0.42, 7, 5]} />
          <meshStandardMaterial color={COLORS.honey} emissive={COLORS.honey} emissiveIntensity={0.25} flatShading />
        </instancedMesh>
      )}
    </group>
  );
}

const LOOP_W = 1.22;
const LOOP_H = 1.22 * (577 / 1030);

function useLoopTexture() {
  const tex = useMemo(() => {
    if (typeof document === "undefined") return null;
    const texture = new THREE.TextureLoader().load("/loop.png");
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
  }, []);
  useEffect(() => () => tex?.dispose(), [tex]);
  return tex;
}

const GATE_LOCK: WallBox = {
  x: 0,
  y: 1.15,
  z: 0,
  sx: 0.96,
  sy: 2.1,
  sz: 0.34,
  minX: 0,
  maxX: 0,
  minZ: 0,
  maxZ: 0,
  tint: 0,
};
const wallBuf: WallBox[] = [];

function wallsForMove(maze: MazeData) {
  const blocked = !maze.qa && !(worldBus.gateOpen && worldBus.gateSwing > 0.72);
  if (!blocked) return maze.walls;
  const x = maze.exit.x;
  const z = maze.exit.z;
  GATE_LOCK.x = x;
  GATE_LOCK.z = z;
  GATE_LOCK.minX = x - 0.48;
  GATE_LOCK.maxX = x + 0.48;
  GATE_LOCK.minZ = z - 0.17;
  GATE_LOCK.maxZ = z + 0.17;
  if (wallBuf.length !== maze.walls.length + 1 || wallBuf[0] !== maze.walls[0]) {
    wallBuf.length = 0;
    for (const w of maze.walls) wallBuf.push(w);
    wallBuf.push(GATE_LOCK);
  }
  return wallBuf;
}

function Lanterns({ maze }: { maze: MazeData }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const tex = useLoopTexture();
  useFrame(({ camera, clock }) => {
    const body = mesh.current;
    if (!body) return;
    const gems = maze.gems;
    const t = clock.elapsedTime;
    for (let i = 0; i < gems.length; i++) {
      const g = gems[i]!;
      const alive = !worldBus.taken.has(g.id);
      const bob = alive ? 1.22 + Math.sin(t * 2.1 + i) * 0.07 : -8;
      dummy.position.set(g.x, bob, g.z);
      dummy.quaternion.copy(camera.quaternion);
      dummy.scale.set(alive ? 1 : 0.001, alive ? 1 : 0.001, alive ? 1 : 0.001);
      dummy.updateMatrix();
      body.setMatrixAt(i, dummy.matrix);
    }
    body.instanceMatrix.needsUpdate = true;
  });
  if (maze.gems.length === 0 || !tex) return null;
  return (
    <instancedMesh ref={mesh} args={[undefined, undefined, maze.gems.length]} frustumCulled={false}>
      <planeGeometry args={[LOOP_W, LOOP_H]} />
      <meshBasicMaterial map={tex} transparent alphaTest={0.15} depthWrite={false} toneMapped={false} />
    </instancedMesh>
  );
}

function Gate({ maze }: { maze: MazeData }) {
  const bar = useRef<THREE.Group>(null);
  const crown = useRef<THREE.Mesh>(null);
  const halo = useRef<THREE.Mesh>(null);
  const beam = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.PointLight>(null);
  const tex = useLoopTexture();
  const { x, z } = maze.exit;
  useFrame(({ camera, clock }, delta) => {
    const dt = Math.min(delta, 0.05);
    const reduced = useGame.getState().reduced;
    const target = worldBus.gateOpen ? 1 : 0;
    if (reduced) worldBus.gateSwing = target;
    else worldBus.gateSwing += (target - worldBus.gateSwing) * (1 - Math.exp(-3.4 * dt));
    worldBus.flash = Math.max(0, worldBus.flash - dt * 1.35);
    const open = worldBus.gateSwing;
    const t = clock.elapsedTime;
    const pulse = reduced ? 1 : 1 + Math.sin(t * 2.2) * (0.025 + open * 0.03);
    if (bar.current) {
      bar.current.rotation.z = -open * 1.45;
      bar.current.visible = open < 0.98;
    }
    const lit = 0.28 + open * 0.72;
    const crownScale = (1.55 + open * 0.45) * pulse;
    if (crown.current) {
      crown.current.quaternion.copy(camera.quaternion);
      crown.current.scale.set(crownScale, crownScale, 1);
      const mat = crown.current.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.32 + open * 0.68;
      mat.color.set(open > 0.55 ? "#ffc14d" : "#8a6a32");
    }
    if (halo.current) {
      halo.current.quaternion.copy(camera.quaternion);
      halo.current.scale.set(crownScale * 1.18, crownScale * 1.18, 1);
      const mat = halo.current.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.08 + open * 0.28 + worldBus.flash * 0.45;
    }
    if (beam.current) {
      const mat = beam.current.material as THREE.MeshBasicMaterial;
      mat.opacity = 0.08 + open * 0.28 + worldBus.flash * 0.35;
      mat.color.set(open > 0.4 ? "#ffc14d" : "#c48a3a");
    }
    if (glow.current) {
      glow.current.intensity = 0.35 + open * 2.4 + worldBus.flash * 8;
      glow.current.color.set(open > 0.4 ? "#ffc14d" : "#a07830");
    }
  });
  return (
    <group position={[x, 0, z]}>
      <mesh position={[-0.58, 1.05, 0]}>
        <boxGeometry args={[0.22, 2.1, 0.22]} />
        <meshLambertMaterial color={COLORS.wood} />
      </mesh>
      <mesh position={[0.58, 1.05, 0]}>
        <boxGeometry args={[0.22, 2.1, 0.22]} />
        <meshLambertMaterial color={COLORS.wood} />
      </mesh>
      <mesh position={[0, 2.16, 0]}>
        <boxGeometry args={[1.4, 0.18, 0.24]} />
        <meshLambertMaterial color={COLORS.bone} />
      </mesh>
      <group ref={bar} position={[-0.46, 1.22, 0]}>
        <mesh position={[0.46, 0, 0]}>
          <boxGeometry args={[0.92, 0.14, 0.14]} />
          <meshLambertMaterial color={COLORS.bone} />
        </mesh>
        <mesh position={[0.46, -0.02, 0.1]}>
          <boxGeometry args={[0.18, 0.22, 0.08]} />
          <meshStandardMaterial color="#e2b340" emissive="#c48a20" emissiveIntensity={0.55} />
        </mesh>
      </group>
      {tex && (
        <mesh ref={halo} position={[0, 3.15, 0]}>
          <planeGeometry args={[LOOP_W, LOOP_H]} />
          <meshBasicMaterial
            map={tex}
            color="#ffc14d"
            transparent
            opacity={0.2}
            depthWrite={false}
            toneMapped={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      )}
      {tex && (
        <mesh ref={crown} position={[0, 3.15, 0]}>
          <planeGeometry args={[LOOP_W, LOOP_H]} />
          <meshBasicMaterial map={tex} color="#8a6a32" transparent opacity={0.32} depthWrite={false} toneMapped={false} />
        </mesh>
      )}
      <mesh ref={beam} position={[0, 6.2, 0]}>
        <cylinderGeometry args={[0.06, 0.42, 8, 5, 1, true]} />
        <meshBasicMaterial color="#c48a3a" transparent opacity={0.12} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.035, 0]}>
        <ringGeometry args={[0.5, 0.82, 6]} />
        <meshBasicMaterial color={COLORS.honey} />
      </mesh>
      <pointLight ref={glow} position={[0, 3.1, 0]} color="#a07830" intensity={0.35} distance={14} decay={2} />
    </group>
  );
}

function Clouds({ maze }: { maze: MazeData }) {
  const ref = useRef<THREE.Group>(null);
  const span = Math.max(maze.cols, maze.rows) * CELL;
  const puffs = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => ({
        x: Math.sin(i * 1.7) * span * 0.72,
        y: span * 0.42 + (i % 3) * 1.4,
        z: Math.cos(i * 1.3) * span * 0.62,
        s: 1.5 + (i % 4) * 0.45,
      })),
    [span],
  );
  useFrame(({ clock }) => {
    const group = ref.current;
    if (!group || useGame.getState().reduced) return;
    const t = clock.elapsedTime;
    group.children.forEach((child, i) => {
      const puff = puffs[i];
      if (!puff) return;
      child.position.x = puff.x + Math.sin(t * 0.07 + i) * 1.8;
    });
  });
  return (
    <group ref={ref}>
      {puffs.map((p, i) => (
        <mesh key={i} position={[p.x, p.y, p.z]}>
          <sphereGeometry args={[p.s, 6, 5]} />
          <meshLambertMaterial color={COLORS.cloud} flatShading />
        </mesh>
      ))}
    </group>
  );
}

function Atmosphere({ maze }: { maze: MazeData }) {
  const span = Math.max(maze.cols, maze.rows) * CELL;
  return (
    <>
      <color attach="background" args={[COLORS.sky]} />
      <fog attach="fog" args={[COLORS.sky, span * 0.42, span * 1.05]} />
      <hemisphereLight args={[COLORS.sun, COLORS.sageDeep, 0.42]} />
      <ambientLight intensity={0.28} color={COLORS.paperWarm} />
      <directionalLight position={[span * 0.2, span * 0.9, -span * 0.15]} intensity={0.85} color={COLORS.sun} />
      <mesh position={[span * 0.22, span * 0.78, -span * 0.08]}>
        <sphereGeometry args={[Math.max(1.6, span * 0.07), 10, 8]} />
        <meshBasicMaterial color={COLORS.sun} fog={false} />
      </mesh>
    </>
  );
}

function Stars({ maze }: { maze: MazeData }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const span = Math.max(maze.cols, maze.rows) * CELL;
  const spots = useMemo(() => {
    const list: { x: number; y: number; z: number; s: number }[] = [];
    for (let i = 0; i < 40; i++) {
      const a = i * 2.399;
      const r = span * (0.55 + (i % 6) * 0.09);
      list.push({
        x: Math.cos(a) * r,
        y: span * 0.62 + (i % 5) * 1.1,
        z: Math.sin(a * 1.17) * r,
        s: 0.05 + (i % 3) * 0.03,
      });
    }
    return list;
  }, [span]);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const dummy = new THREE.Object3D();
    spots.forEach((p, i) => {
      dummy.position.set(p.x, p.y, p.z);
      dummy.scale.setScalar(p.s);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  }, [spots]);
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, spots.length]} frustumCulled={false}>
      <sphereGeometry args={[1, 4, 3]} />
      <meshBasicMaterial color={COLORS.sun} fog={false} />
    </instancedMesh>
  );
}

function Bats({ maze }: { maze: MazeData }) {
  const ref = useRef<THREE.Group>(null);
  const span = Math.max(maze.cols, maze.rows) * CELL;
  const bats = useMemo(
    () =>
      Array.from({ length: 5 }, (_, i) => ({
        r: span * (0.32 + (i % 3) * 0.07),
        y: span * 0.22 + (i % 2) * 1.4,
        speed: 0.22 + i * 0.035,
        phase: i * 1.4,
      })),
    [span],
  );
  useFrame(({ clock }) => {
    const group = ref.current;
    if (!group) return;
    const reduced = useGame.getState().reduced;
    const t = reduced ? 0 : clock.elapsedTime;
    group.children.forEach((child, i) => {
      const b = bats[i];
      if (!b) return;
      const a = t * b.speed + b.phase;
      child.position.set(
        (maze.cols * CELL) / 2 + Math.cos(a) * b.r,
        b.y + Math.sin(t * 2.2 + i) * 0.35,
        (maze.rows * CELL) / 2 + Math.sin(a) * b.r * 0.72,
      );
      child.rotation.y = -a;
      const flap = reduced ? 0.35 : Math.sin(t * 10 + i) * 0.55;
      const left = child.children[0];
      const right = child.children[1];
      if (left) left.rotation.z = 0.35 + flap;
      if (right) right.rotation.z = -0.35 - flap;
    });
  });
  return (
    <group ref={ref}>
      {bats.map((_, i) => (
        <group key={i}>
          <mesh position={[-0.26, 0, 0]}>
            <boxGeometry args={[0.4, 0.05, 0.16]} />
            <meshLambertMaterial color={COLORS.ink} />
          </mesh>
          <mesh position={[0.26, 0, 0]}>
            <boxGeometry args={[0.4, 0.05, 0.16]} />
            <meshLambertMaterial color={COLORS.ink} />
          </mesh>
          <mesh>
            <sphereGeometry args={[0.08, 5, 4]} />
            <meshLambertMaterial color={COLORS.ink} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Garden({ maze }: { maze: MazeData }) {
  return (
    <group>
      <Floor cols={maze.cols} rows={maze.rows} />
      <Hedges walls={maze.walls} />
      <Shrubs maze={maze} />
      <Lanterns maze={maze} />
      <Gate maze={maze} />
      <Clouds maze={maze} />
      <Stars maze={maze} />
      <Bats maze={maze} />
    </group>
  );
}

function Sparks() {
  const ref = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  useFrame((_, delta) => {
    const mesh = ref.current;
    if (!mesh) return;
    const step = Math.min(delta, 0.05);
    const sparks = worldBus.sparks;
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i]!;
      s.life -= step;
      s.vy -= 7 * step;
      s.x += s.vx * step;
      s.y += s.vy * step;
      s.z += s.vz * step;
      if (s.life <= 0 || s.y < 0.06) sparks.splice(i, 1);
    }
    for (let i = 0; i < 48; i++) {
      const s = sparks[i];
      if (s) {
        const k = Math.max(0.08, s.life / s.max);
        dummy.position.set(s.x, s.y, s.z);
        dummy.scale.setScalar(0.14 * k);
        dummy.rotation.set(s.life * 4, s.life * 3, 0);
      } else {
        dummy.position.set(0, -30, 0);
        dummy.scale.setScalar(0.001);
        dummy.rotation.set(0, 0, 0);
      }
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, 48]} frustumCulled={false}>
      <octahedronGeometry args={[1, 0]} />
      <meshStandardMaterial color={COLORS.honey} emissive={COLORS.honey} emissiveIntensity={0.7} flatShading />
    </instancedMesh>
  );
}

function Player() {
  const look = useRef({ yaw: 0, pitch: 0 });
  const pos = useRef({ x: 0, z: 0 });
  const vel = useRef({ x: 0, z: 0 });
  const keys = useRef(new Set<string>());
  const seenRun = useRef(-1);
  const elapsed = useRef(0);
  const pushed = useRef(0);
  const bobPhase = useRef(0);
  const bob = useRef(0);
  const trauma = useRef(0);
  const finished = useRef(false);
  const lastHit = useRef(-1);
  const stepAcc = useRef(0);
  const stepFlip = useRef(false);
  const lookPtr = useRef({ id: -1, x: 0, y: 0 });
  const prevPhase = useRef(useGame.getState().phase);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Escape" && useGame.getState().phase === "play") {
        useGame.getState().pause();
      }
      if (e.repeat) return;
      keys.current.add(e.code);
      if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
    };
    const up = (e: KeyboardEvent) => keys.current.delete(e.code);
    const clear = () => keys.current.clear();
    const onVis = () => {
      if (document.hidden) clear();
      else unlockAudio();
    };
    const blockTouch = (e: TouchEvent) => {
      const phase = useGame.getState().phase;
      const target = e.target as HTMLElement | null;
      if (phase !== "play" && target?.closest("input")) return;
      e.preventDefault();
    };
    const onDown = (e: PointerEvent) => {
      const phase = useGame.getState().phase;
      if (phase !== "play") return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-ui]")) return;
      worldBus.dragging = true;
      lookPtr.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      if (!isTouchPlay()) lockPointer();
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId === lookPtr.current.id) lookPtr.current.id = -1;
      worldBus.dragging = false;
    };
    const onMove = (e: PointerEvent) => {
      if (useGame.getState().phase !== "play") return;
      const locked = document.pointerLockElement != null;
      if (locked) {
        worldBus.lookX += e.movementX;
        worldBus.lookY += e.movementY;
        return;
      }
      if (!worldBus.dragging || e.pointerId !== lookPtr.current.id) return;
      let dx = e.movementX;
      let dy = e.movementY;
      if (isTouchPlay() || e.pointerType !== "mouse" || (dx === 0 && dy === 0)) {
        dx = e.clientX - lookPtr.current.x;
        dy = e.clientY - lookPtr.current.y;
      }
      lookPtr.current.x = e.clientX;
      lookPtr.current.y = e.clientY;
      const cap = 72;
      if (dx > cap) dx = cap;
      else if (dx < -cap) dx = -cap;
      if (dy > cap) dy = cap;
      else if (dy < -cap) dy = -cap;
      worldBus.lookX += dx;
      worldBus.lookY += dy;
    };
    const onLock = () => {
      const locked = document.pointerLockElement != null;
      const phase = useGame.getState().phase;
      if (!locked && worldBus.hadLock && phase === "play" && !isTouchPlay() && !useGame.getState().maze.qa) {
        useGame.getState().pause();
      }
      worldBus.hadLock = locked;
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", clear);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("touchmove", blockTouch, { passive: false });
    document.addEventListener("pointerlockchange", onLock);
    window.__controlsTest = {
      getYaw: () => look.current.yaw,
      getSpeed: () => Math.hypot(vel.current.x, vel.current.z),
      getPos: () => ({ x: pos.current.x, z: pos.current.z }),
      setKeys: (codes) => {
        worldBus.inject = codes.slice();
      },
    };
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", clear);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("touchmove", blockTouch);
      document.removeEventListener("pointerlockchange", onLock);
      delete window.__controlsTest;
    };
  }, []);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    const st = useGame.getState();
    const maze = st.maze;
    const camera = state.camera;

    if (seenRun.current !== st.runId) {
      seenRun.current = st.runId;
      const spot = unstick(maze.start.x, maze.start.z, PLAYER_R, maze.walls);
      pos.current.x = spot.x;
      pos.current.z = spot.z;
      vel.current.x = 0;
      vel.current.z = 0;
      look.current.yaw = maze.yaw;
      look.current.pitch = 0;
      elapsed.current = 0;
      pushed.current = 0;
      bobPhase.current = 0;
      bob.current = 0;
      trauma.current = 0;
      finished.current = false;
      stepAcc.current = 0;
      worldBus.pose.x = spot.x;
      worldBus.pose.z = spot.z;
      worldBus.pose.yaw = maze.yaw;
      worldBus.pose.speed = 0;
    }

    const phase = st.phase;
    if (phase === "play") {
      const sens = st.sens * (isTouchPlay() ? 2.15 : 1);
      look.current.yaw -= worldBus.lookX * sens;
      look.current.pitch -= worldBus.lookY * sens;
      worldBus.lookX = 0;
      worldBus.lookY = 0;
      const limit = Math.PI / 2 - 0.08;
      if (look.current.pitch > limit) look.current.pitch = limit;
      if (look.current.pitch < -limit) look.current.pitch = -limit;

      const inject = worldBus.inject;
      const down = (code: string) => (inject ? inject.includes(code) : keys.current.has(code));
      let ix = worldBus.moveX;
      let iz = worldBus.moveZ;
      if (down("KeyD") || down("ArrowRight")) ix += 1;
      if (down("KeyA") || down("ArrowLeft")) ix -= 1;
      if (down("KeyW") || down("ArrowUp")) iz += 1;
      if (down("KeyS") || down("ArrowDown")) iz -= 1;
      const wish = wishFromInput(look.current.yaw, ix, iz);
      const sprint = down("ShiftLeft") || down("ShiftRight");
      const maxSpeed = sprint ? 7.4 : 4.7;
      const rate = wish.mag > 0.08 ? 5.2 : 6.4;
      const blend = 1 - Math.exp(-rate * dt);
      vel.current.x += (wish.wishX * maxSpeed - vel.current.x) * blend;
      vel.current.z += (wish.wishZ * maxSpeed - vel.current.z) * blend;

      const before = Math.hypot(vel.current.x, vel.current.z);
      const moved = moveWithWalls(
        pos.current.x,
        pos.current.z,
        vel.current.x,
        vel.current.z,
        dt,
        wallsForMove(maze),
        PLAYER_R,
      );
      pos.current.x = moved.x;
      pos.current.z = moved.z;
      vel.current.x = moved.vx;
      vel.current.z = moved.vz;
      if ((moved.hitX || moved.hitZ) && before > 3.1) {
        const now = state.clock.elapsedTime;
        if (now - lastHit.current > 0.2) {
          lastHit.current = now;
          if (!st.reduced) trauma.current = Math.min(0.7, trauma.current + 0.18);
          sfx.thud();
        }
      }

      const speed = Math.hypot(vel.current.x, vel.current.z);
      if (speed > 0.55) {
        stepAcc.current += speed * dt;
        if (stepAcc.current > 1.7) {
          stepAcc.current = 0;
          stepFlip.current = !stepFlip.current;
          sfx.step(stepFlip.current);
        }
        if (!st.reduced) bobPhase.current += speed * dt * 2.3;
      }
      const targetBob = speed > 0.55 && !st.reduced ? Math.sin(bobPhase.current * 2) * 0.035 : 0;
      bob.current += (targetBob - bob.current) * (1 - Math.exp(-10 * dt));

      const c = Math.floor(pos.current.x / CELL);
      const r = Math.floor(pos.current.z / CELL);
      if (r >= 0 && c >= 0 && r < maze.rows && c < maze.cols && worldBus.visited[r] && !worldBus.visited[r]![c]) {
        worldBus.visited[r]![c] = true;
      }

      for (let i = 0; i < maze.gems.length; i++) {
        const g = maze.gems[i]!;
        if (worldBus.taken.has(g.id)) continue;
        const dx = pos.current.x - g.x;
        const dz = pos.current.z - g.z;
        if (dx * dx + dz * dz < 0.78 * 0.78) {
          worldBus.taken.add(g.id);
          emitSparks(g.x, 1.1, g.z, 8);
          const filled = worldBus.taken.size >= maze.gems.length;
          if (filled) sfx.complete();
          else sfx.collect();
          useGame.getState().collect();
        }
      }

      if (
        !maze.qa &&
        maze.gems.length > 0 &&
        !worldBus.gateOpen &&
        worldBus.taken.size >= loopsNeeded(maze.gems.length)
      ) {
        worldBus.gateOpen = true;
        worldBus.flash = 1;
        sfx.unlock();
      }

      elapsed.current += dt;
      if (elapsed.current - pushed.current > 0.1) {
        pushed.current = elapsed.current;
        useGame.getState().setElapsed(elapsed.current);
      }

      if (!finished.current && !maze.qa) {
        const dx = pos.current.x - maze.exit.x;
        const dz = pos.current.z - maze.exit.z;
        const dist2 = dx * dx + dz * dz;
        worldBus.nearGate = !worldBus.gateOpen && dist2 < 2.2 * 2.2;
        const passage = worldBus.gateOpen && (maze.gems.length === 0 || worldBus.gateSwing > 0.72);
        if (passage && dist2 < 1.12 * 1.12) {
          finished.current = true;
          worldBus.nearGate = false;
          emitSparks(maze.exit.x, 2.8, maze.exit.z, 16);
          sfx.win();
          useGame.getState().win(elapsed.current);
        }
      }
    } else {
      worldBus.moveX = 0;
      worldBus.moveZ = 0;
      worldBus.lookX = 0;
      worldBus.lookY = 0;
      worldBus.nearGate = false;
      if (prevPhase.current === "play" && phase === "pause") {
        useGame.getState().setElapsed(elapsed.current);
      }
    }
    prevPhase.current = useGame.getState().phase;

    worldBus.pose.x = pos.current.x;
    worldBus.pose.z = pos.current.z;
    worldBus.pose.yaw = look.current.yaw;
    worldBus.pose.speed = Math.hypot(vel.current.x, vel.current.z);

    const nowPhase = useGame.getState().phase;
    if (nowPhase === "play" || nowPhase === "pause") {
      trauma.current = Math.max(0, trauma.current - 2.1 * dt);
      const shake = st.reduced ? 0 : trauma.current * trauma.current;
      const t = state.clock.elapsedTime;
      camera.position.set(pos.current.x, EYE + bob.current, pos.current.z);
      camera.rotation.order = "YXZ";
      camera.rotation.y = look.current.yaw;
      camera.rotation.x = look.current.pitch;
      camera.rotation.z = Math.sin(t * 27) * 0.012 * shake;
      camera.position.x += Math.sin(t * 41) * 0.04 * shake;
      camera.position.y += Math.sin(t * 33) * 0.028 * shake;
      return;
    }

    const span = Math.max(maze.cols, maze.rows) * CELL;
    const cx = (maze.cols * CELL) / 2;
    const cz = (maze.rows * CELL) / 2;
    const ang = state.clock.elapsedTime * (st.reduced ? 0.04 : 0.16);
    const rad = span * 0.58;
    camera.position.set(cx + Math.sin(ang) * rad, span * 0.7, cz + Math.cos(ang) * rad * 0.82);
    camera.up.set(0, 1, 0);
    camera.lookAt(cx, 0.4, cz);
  });

  return null;
}

export function MazeCanvas() {
  const maze = useGame((s) => s.maze);
  return (
    <Canvas
      className="game-canvas"
      dpr={[1, 1.25]}
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
      camera={{ fov: 74, near: 0.08, far: 200, position: [10, 18, 22] }}
      onCreated={({ gl }) => {
        worldBus.canvas = gl.domElement;
        const touch = isTouchPlay();
        gl.setPixelRatio(Math.min(window.devicePixelRatio || 1, touch ? 1.15 : 1.75));
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 0.96;
        gl.setClearColor(COLORS.sky);
        gl.domElement.addEventListener("contextmenu", (e) => e.preventDefault());
      }}
    >
      <Atmosphere maze={maze} />
      <Garden key={`${maze.seed}:${maze.cols}:${maze.rows}`} maze={maze} />
      <Sparks />
      <Player />
    </Canvas>
  );
}
