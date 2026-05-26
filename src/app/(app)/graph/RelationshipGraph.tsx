"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { GraphData, GraphNode } from "@/lib/graph-read";

const BG = "#0b0d13";
const NODE_COLOR: Record<GraphNode["cls"], string> = {
  lead_pastor: "#f472b6",
  shepherd_team: "#60a5fa",
  shepherded: "#34d399",
  active: "#fbbf24",
  present: "#5b6577",
};
// Edge colour by kind: 0 shepherded (prominent), 1 active (grey),
// 2 present (faint). On a dark canvas the "prominent" edge is light.
const EDGE_COLOR = [
  "rgba(228,233,242,0.42)",
  "rgba(150,162,184,0.22)",
  "rgba(92,103,124,0.12)",
];
const EDGE_WIDTH = [1.15, 0.85, 0.6];

// Force-sim constants (world units). Repulsion is an all-pairs
// Barnes-Hut n-body force: that long range is what lets densely linked
// groups settle into their own clusters instead of one hairball.
const REPULSION = 140;
const MAX_FORCE = 80; // cap on any single Barnes-Hut cell's push.
// Hard cap on how far a node can move in one tick. All-pairs repulsion
// has unbounded total force, so without this a spike flings nodes to
// infinity and the auto-fit zooms the graph down to nothing.
const MAX_SPEED = 50;
const THETA2 = 0.7; // Barnes-Hut accuracy: (cellSize/dist)^2 threshold.
const MAX_DEPTH = 22;
const SPRING = 0.09;
const SPRING_LEN = 32;
// Centre gravity per node. It scales with the SQUARE ROOT of degree so
// the most-connected hubs are pulled hardest to the middle and loosely
// connected people sit on the outside. Leadership has a floor — they
// sit at the core even if their personal degree happens to be low.
const DEGREE_GRAV_BASE = 0.008;
const DEGREE_GRAV_MULT = 0.014;
const GRAVITY_LEAD = 0.15;
const GRAVITY_TEAM = 0.085;
const DAMP = 0.86;
const ALPHA_DECAY = 0.99;
const ALPHA_MIN = 0.02;
const FIT_LOCK = 0.12; // stop auto-fitting the view below this alpha.
const WARMUP = 60;

interface QNode {
  x: number;
  y: number;
  w: number;
  mass: number;
  sumX: number;
  sumY: number;
  body: number;
  kids: (QNode | null)[] | null;
}

/** Obsidian-style force-directed graph of the whole church. Custom
 *  canvas renderer + a Barnes-Hut force simulation so ~8k nodes stay
 *  interactive and cluster by connection density — no charting
 *  dependency. Every mutable variable is declared before any closure
 *  that reads it, so nothing can be touched in its temporal dead zone. */
export function RelationshipGraph({ data }: { data: GraphData }) {
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hoverName, setHoverName] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const nodes = data.nodes;
    const edges = data.edges;
    const n = nodes.length;

    // ── Simulation buffers ────────────────────────────────────────
    const px = new Float32Array(n);
    const py = new Float32Array(n);
    const vx = new Float32Array(n);
    const vy = new Float32Array(n);
    const spread = 18 * Math.sqrt(Math.max(1, n));
    for (let i = 0; i < n; i++) {
      px[i] = (Math.random() - 0.5) * spread;
      py[i] = (Math.random() - 0.5) * spread;
    }
    const degree = new Int32Array(n);
    const neighbors: number[][] = Array.from({ length: n }, () => []);
    for (const e of edges) {
      degree[e[0]]++;
      degree[e[1]]++;
      neighbors[e[0]].push(e[1]);
      neighbors[e[1]].push(e[0]);
    }
    // Per-node centre gravity + draw radius. Leadership gravitates to
    // the centre and renders a touch larger.
    const gravity = new Float32Array(n);
    const radii = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const c = nodes[i].cls;
      const fromDegree =
        DEGREE_GRAV_BASE + DEGREE_GRAV_MULT * Math.sqrt(degree[i]);
      const fromCategory =
        c === "lead_pastor"
          ? GRAVITY_LEAD
          : c === "shepherd_team"
            ? GRAVITY_TEAM
            : 0;
      gravity[i] = Math.max(fromDegree, fromCategory);
      const bonus = c === "lead_pastor" ? 4 : c === "shepherd_team" ? 2 : 0;
      radii[i] = 2 + Math.min(7, Math.sqrt(degree[i])) + bonus;
    }

    // ── All mutable state — declared before any closure below ─────
    let alpha = 1;
    let dragNode = -1;
    let dragMoved = false;
    let panning = false;
    let hover = -1;
    let scale = 1;
    let offX = 0;
    let offY = 0;
    let dpr = Math.min(2, window.devicePixelRatio || 1);
    let W = 0;
    let H = 0;
    let autoFit = true;
    let lastX = 0;
    let lastY = 0;
    let raf = 0;

    // ── Barnes-Hut quadtree ───────────────────────────────────────
    function qnode(x: number, y: number, w: number): QNode {
      return { x, y, w, mass: 0, sumX: 0, sumY: 0, body: -1, kids: null };
    }
    function qput(node: QNode, i: number, depth: number) {
      const hw = node.w / 2;
      const right = px[i] >= node.x + hw ? 1 : 0;
      const bottom = py[i] >= node.y + hw ? 1 : 0;
      const q = bottom * 2 + right;
      let kid = node.kids![q];
      if (!kid) {
        kid = qnode(node.x + right * hw, node.y + bottom * hw, hw);
        node.kids![q] = kid;
      }
      qinsert(kid, i, depth + 1);
    }
    function qinsert(node: QNode, i: number, depth: number) {
      node.mass++;
      node.sumX += px[i];
      node.sumY += py[i];
      if (node.mass === 1) {
        node.body = i;
        return;
      }
      if (node.kids !== null) {
        qput(node, i, depth);
        return;
      }
      // Leaf with kids === null and mass >= 2.
      if (node.body < 0) return; // fat leaf (coincident points) — absorb.
      if (depth >= MAX_DEPTH) {
        node.body = -1; // becomes a fat leaf.
        return;
      }
      const existing = node.body;
      node.body = -1;
      node.kids = [null, null, null, null];
      qput(node, existing, depth);
      qput(node, i, depth);
    }
    function applyBH(node: QNode, i: number) {
      if (node.mass === 0) return;
      if (node.kids === null && node.body === i && node.mass === 1) return;
      const invM = 1 / node.mass;
      let dx = px[i] - node.sumX * invM;
      let dy = py[i] - node.sumY * invM;
      let d2 = dx * dx + dy * dy;
      if (node.kids === null || node.w * node.w < THETA2 * d2) {
        if (d2 < 1) {
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          d2 = 1;
        }
        const d = Math.sqrt(d2);
        let f = ((REPULSION * node.mass) / d2) * alpha;
        if (f > MAX_FORCE) f = MAX_FORCE;
        vx[i] += (dx / d) * f;
        vy[i] += (dy / d) * f;
        return;
      }
      const k = node.kids;
      if (k[0]) applyBH(k[0], i);
      if (k[1]) applyBH(k[1], i);
      if (k[2]) applyBH(k[2], i);
      if (k[3]) applyBH(k[3], i);
    }

    function tick() {
      if (n === 0) return;
      // Build the quadtree over a square that covers every node.
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < n; i++) {
        if (px[i] < minX) minX = px[i];
        if (px[i] > maxX) maxX = px[i];
        if (py[i] < minY) minY = py[i];
        if (py[i] > maxY) maxY = py[i];
      }
      const size = Math.max(maxX - minX, maxY - minY, 1) * 1.05;
      const root = qnode(minX - 1, minY - 1, size);
      for (let i = 0; i < n; i++) qinsert(root, i, 0);

      // Repulsion — every node against the whole tree.
      for (let i = 0; i < n; i++) applyBH(root, i);

      // Springs along edges.
      for (const e of edges) {
        const s = e[0];
        const t = e[1];
        const dx = px[t] - px[s];
        const dy = py[t] - py[s];
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const f = SPRING * (d - SPRING_LEN) * alpha;
        const fx = (dx / d) * f;
        const fy = (dy / d) * f;
        vx[s] += fx;
        vy[s] += fy;
        vx[t] -= fx;
        vy[t] -= fy;
      }
      // Gravity toward the centre + integrate.
      for (let i = 0; i < n; i++) {
        if (i === dragNode) {
          vx[i] = 0;
          vy[i] = 0;
          continue;
        }
        vx[i] -= px[i] * gravity[i] * alpha;
        vy[i] -= py[i] * gravity[i] * alpha;
        vx[i] *= DAMP;
        vy[i] *= DAMP;
        // Clamp speed so a force spike can never fling a node off-screen.
        const sp = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]);
        if (sp > MAX_SPEED) {
          vx[i] *= MAX_SPEED / sp;
          vy[i] *= MAX_SPEED / sp;
        }
        px[i] += vx[i];
        py[i] += vy[i];
        // Self-heal if anything ever goes non-finite.
        if (!Number.isFinite(px[i]) || !Number.isFinite(py[i])) {
          px[i] = (Math.random() - 0.5) * 200;
          py[i] = (Math.random() - 0.5) * 200;
          vx[i] = 0;
          vy[i] = 0;
        }
      }
      alpha *= ALPHA_DECAY;
    }

    function fitView() {
      if (n === 0) return;
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let i = 0; i < n; i++) {
        if (px[i] < minX) minX = px[i];
        if (px[i] > maxX) maxX = px[i];
        if (py[i] < minY) minY = py[i];
        if (py[i] > maxY) maxY = py[i];
      }
      const gw = Math.max(maxX - minX, 1);
      const gh = Math.max(maxY - minY, 1);
      scale = Math.max(0.05, Math.min(6, Math.min(W / gw, H / gh) * 0.9));
      if (!Number.isFinite(scale) || scale <= 0) scale = 1;
      offX = W / 2 - ((minX + maxX) / 2) * scale;
      offY = H / 2 - ((minY + maxY) / 2) * scale;
      if (!Number.isFinite(offX)) offX = W / 2;
      if (!Number.isFinite(offY)) offY = H / 2;
    }

    function resize() {
      const r = wrap!.getBoundingClientRect();
      W = r.width;
      H = r.height;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas!.width = Math.round(W * dpr);
      canvas!.height = Math.round(H * dpr);
      canvas!.style.width = `${W}px`;
      canvas!.style.height = `${H}px`;
    }

    function nodeRadius(i: number): number {
      return radii[i];
    }

    function hitTest(mx: number, my: number): number {
      const wx = (mx - offX) / scale;
      const wy = (my - offY) / scale;
      const tol = 7 / scale;
      let best = -1;
      let bestD = Infinity;
      for (let i = 0; i < n; i++) {
        const dx = px[i] - wx;
        const dy = py[i] - wy;
        const d2 = dx * dx + dy * dy;
        const rr = nodeRadius(i) + tol;
        if (d2 < rr * rr && d2 < bestD) {
          bestD = d2;
          best = i;
        }
      }
      return best;
    }

    function render() {
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx!.fillStyle = BG;
      ctx!.fillRect(0, 0, W, H);

      const hl = hover >= 0 ? new Set(neighbors[hover]) : null;

      // Edges — faint first so prominent links sit on top.
      for (let kind = 2; kind >= 0; kind--) {
        ctx!.strokeStyle = EDGE_COLOR[kind];
        ctx!.lineWidth = EDGE_WIDTH[kind];
        ctx!.beginPath();
        for (const e of edges) {
          if (e[2] !== kind) continue;
          if (hl && e[0] !== hover && e[1] !== hover) continue;
          ctx!.moveTo(px[e[0]] * scale + offX, py[e[0]] * scale + offY);
          ctx!.lineTo(px[e[1]] * scale + offX, py[e[1]] * scale + offY);
        }
        ctx!.stroke();
      }
      if (hl) {
        ctx!.strokeStyle = "rgba(80,90,110,0.06)";
        ctx!.lineWidth = 0.5;
        ctx!.beginPath();
        for (const e of edges) {
          if (e[0] === hover || e[1] === hover) continue;
          ctx!.moveTo(px[e[0]] * scale + offX, py[e[0]] * scale + offY);
          ctx!.lineTo(px[e[1]] * scale + offX, py[e[1]] * scale + offY);
        }
        ctx!.stroke();
      }

      // Nodes — one fill pass per classification. When hovering, the
      // un-connected nodes keep their own colour, just lightly faded.
      for (const cls of [
        "present",
        "active",
        "shepherded",
        "shepherd_team",
        "lead_pastor",
      ] as const) {
        ctx!.fillStyle = NODE_COLOR[cls];
        if (hl) {
          ctx!.globalAlpha = 0.62;
          ctx!.beginPath();
          for (let i = 0; i < n; i++) {
            if (nodes[i].cls !== cls) continue;
            if (i === hover || hl.has(i)) continue;
            const sx = px[i] * scale + offX;
            const sy = py[i] * scale + offY;
            const r = nodeRadius(i);
            ctx!.moveTo(sx + r, sy);
            ctx!.arc(sx, sy, r, 0, Math.PI * 2);
          }
          ctx!.fill();
          ctx!.globalAlpha = 1;
        }
        ctx!.beginPath();
        for (let i = 0; i < n; i++) {
          if (nodes[i].cls !== cls) continue;
          if (hl && i !== hover && !hl.has(i)) continue;
          const sx = px[i] * scale + offX;
          const sy = py[i] * scale + offY;
          const r = nodeRadius(i);
          ctx!.moveTo(sx + r, sy);
          ctx!.arc(sx, sy, r, 0, Math.PI * 2);
        }
        ctx!.fill();
      }

      // Hovered node — glow ring + label.
      if (hover >= 0) {
        const sx = px[hover] * scale + offX;
        const sy = py[hover] * scale + offY;
        const r = nodeRadius(hover);
        ctx!.beginPath();
        ctx!.arc(sx, sy, r + 4, 0, Math.PI * 2);
        ctx!.strokeStyle = NODE_COLOR[nodes[hover].cls];
        ctx!.lineWidth = 1.5;
        ctx!.stroke();
        const label = nodes[hover].name;
        ctx!.font =
          "12px ui-sans-serif, system-ui, -apple-system, sans-serif";
        const tw = ctx!.measureText(label).width;
        ctx!.fillStyle = "rgba(10,12,18,0.92)";
        ctx!.fillRect(sx + r + 6, sy - 11, tw + 12, 22);
        ctx!.fillStyle = "#e8ebf2";
        ctx!.fillText(label, sx + r + 12, sy + 4);
      }
    }

    function frame() {
      if (alpha > ALPHA_MIN || dragNode >= 0) tick();
      if (autoFit) {
        if (alpha < FIT_LOCK) autoFit = false;
        else fitView();
      }
      render();
      raf = requestAnimationFrame(frame);
    }

    function localXY(e: PointerEvent): [number, number] {
      const r = canvas!.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    }
    function onDown(e: PointerEvent) {
      const [mx, my] = localXY(e);
      const hit = hitTest(mx, my);
      canvas!.setPointerCapture(e.pointerId);
      autoFit = false;
      if (hit >= 0) {
        dragNode = hit;
        dragMoved = false;
        alpha = Math.max(alpha, 0.3);
      } else {
        panning = true;
      }
      lastX = mx;
      lastY = my;
    }
    function onMove(e: PointerEvent) {
      const [mx, my] = localXY(e);
      if (dragNode >= 0) {
        px[dragNode] = (mx - offX) / scale;
        py[dragNode] = (my - offY) / scale;
        alpha = Math.max(alpha, 0.3);
        if (Math.abs(mx - lastX) + Math.abs(my - lastY) > 3) dragMoved = true;
      } else if (panning) {
        offX += mx - lastX;
        offY += my - lastY;
      } else {
        const h = hitTest(mx, my);
        if (h !== hover) {
          hover = h;
          setHoverName(h >= 0 ? nodes[h].name : null);
          canvas!.style.cursor = h >= 0 ? "pointer" : "grab";
        }
      }
      lastX = mx;
      lastY = my;
    }
    function onUp(e: PointerEvent) {
      if (dragNode >= 0 && !dragMoved) {
        router.push(`/people/${nodes[dragNode].id}`);
      }
      dragNode = -1;
      panning = false;
      try {
        canvas!.releasePointerCapture(e.pointerId);
      } catch {}
    }
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      autoFit = false;
      const r = canvas!.getBoundingClientRect();
      const mx = e.clientX - r.left;
      const my = e.clientY - r.top;
      const factor = Math.exp(-e.deltaY * 0.0012);
      const next = Math.max(0.02, Math.min(8, scale * factor));
      offX = mx - ((mx - offX) * next) / scale;
      offY = my - ((my - offY) * next) / scale;
      scale = next;
    }

    // ── Run ───────────────────────────────────────────────────────
    for (let i = 0; i < WARMUP; i++) tick();
    resize();
    fitView();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);
    frame();

    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      canvas.removeEventListener("pointerdown", onDown);
      canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [data, router]);

  return (
    <div
      ref={wrapRef}
      className="relative w-full rounded-xl overflow-hidden border border-border-soft"
      style={{ height: "76vh", background: BG, touchAction: "none" }}
    >
      <canvas ref={canvasRef} className="block" style={{ cursor: "grab" }} />
      <div className="absolute top-3 left-3 text-xs space-y-1.5 pointer-events-none select-none">
        <LegendDot color={NODE_COLOR.lead_pastor} label="Lead pastor" />
        <LegendDot color={NODE_COLOR.shepherd_team} label="Shepherd team" />
        <LegendDot color={NODE_COLOR.shepherded} label="Shepherded" />
        <LegendDot color={NODE_COLOR.active} label="Active" />
        <LegendDot color={NODE_COLOR.present} label="Present" />
      </div>
      <div className="absolute bottom-3 left-3 text-[11px] text-[#7c879c] pointer-events-none select-none">
        Drag to pan · scroll to zoom · drag a node to pull it · click a node to
        open their profile
      </div>
      {hoverName && (
        <div className="absolute top-3 right-3 text-xs text-[#e8ebf2] bg-[#11141c] border border-[#262b38] rounded px-2 py-1 pointer-events-none">
          {hoverName}
        </div>
      )}
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="w-2.5 h-2.5 rounded-full inline-block"
        style={{ background: color }}
      />
      <span className="text-[#aab2c5]">{label}</span>
    </div>
  );
}
