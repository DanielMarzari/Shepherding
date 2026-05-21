"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { GraphData, GraphNode } from "@/lib/graph-read";

const BG = "#0b0d13";
const NODE_COLOR: Record<GraphNode["cls"], string> = {
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

// Force-sim constants (world units).
const REP_RADIUS = 90;
const REPULSION = 2400;
const MAX_FORCE = 240;
const SPRING = 0.02;
const SPRING_LEN = 40;
const GRAVITY = 0.011;
const DAMP = 0.82;
const ALPHA_DECAY = 0.985;
const ALPHA_MIN = 0.02;

/** Obsidian-style force-directed graph of the whole church. Custom
 *  canvas renderer + grid-approximated force simulation so ~8k nodes
 *  stay interactive without a charting dependency. */
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

    const n = data.nodes.length;
    const edges = data.edges;

    // ── Simulation state ──────────────────────────────────────────
    const px = new Float32Array(n);
    const py = new Float32Array(n);
    const vx = new Float32Array(n);
    const vy = new Float32Array(n);
    const spread = 22 * Math.sqrt(Math.max(1, n));
    for (let i = 0; i < n; i++) {
      px[i] = (Math.random() - 0.5) * spread;
      py[i] = (Math.random() - 0.5) * spread;
    }
    // Degree drives node radius + the neighbour-highlight on hover.
    const degree = new Int32Array(n);
    const neighbors: number[][] = Array.from({ length: n }, () => []);
    for (const [s, t] of edges) {
      degree[s]++;
      degree[t]++;
      neighbors[s].push(t);
      neighbors[t].push(s);
    }
    let alpha = 1;
    // Declared up here: tick() reads it, and tick() runs in the warm-up
    // loop below — a `let` declared lower would be in the temporal dead
    // zone and throw once there are nodes to integrate.
    let dragNode = -1;

    function tick() {
      const cs = REP_RADIUS;
      const grid = new Map<number, number[]>();
      for (let i = 0; i < n; i++) {
        const key =
          (Math.floor(px[i] / cs) + 5000) * 100000 +
          (Math.floor(py[i] / cs) + 5000);
        const arr = grid.get(key);
        if (arr) arr.push(i);
        else grid.set(key, [i]);
      }
      // Repulsion — only against nodes in the 3×3 neighbouring cells.
      for (let i = 0; i < n; i++) {
        const cx = Math.floor(px[i] / cs);
        const cy = Math.floor(py[i] / cs);
        for (let gx = -1; gx <= 1; gx++) {
          for (let gy = -1; gy <= 1; gy++) {
            const arr = grid.get(
              (cx + gx + 5000) * 100000 + (cy + gy + 5000),
            );
            if (!arr) continue;
            for (const j of arr) {
              if (j <= i) continue;
              let dx = px[i] - px[j];
              let dy = py[i] - py[j];
              let d2 = dx * dx + dy * dy;
              if (d2 === 0) {
                dx = Math.random() - 0.5;
                dy = Math.random() - 0.5;
                d2 = 0.01;
              } else if (d2 > cs * cs) {
                continue;
              }
              const d = Math.sqrt(d2);
              let f = (REPULSION / d2) * alpha;
              if (f > MAX_FORCE) f = MAX_FORCE;
              const fx = (dx / d) * f;
              const fy = (dy / d) * f;
              vx[i] += fx;
              vy[i] += fy;
              vx[j] -= fx;
              vy[j] -= fy;
            }
          }
        }
      }
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
        vx[i] -= px[i] * GRAVITY * alpha;
        vy[i] -= py[i] * GRAVITY * alpha;
        vx[i] *= DAMP;
        vy[i] *= DAMP;
        px[i] += vx[i];
        py[i] += vy[i];
      }
      alpha *= ALPHA_DECAY;
    }

    // Warm up a little before the first paint so it isn't pure noise.
    for (let i = 0; i < 40; i++) tick();

    // ── View + interaction state ──────────────────────────────────
    let scale = 1;
    let offX = 0;
    let offY = 0;
    let dpr = Math.min(2, window.devicePixelRatio || 1);
    let W = 0;
    let H = 0;
    let centered = false;
    let hover = -1;
    let dragMoved = false;
    let panning = false;
    let lastX = 0;
    let lastY = 0;

    function resize() {
      const r = wrap!.getBoundingClientRect();
      W = r.width;
      H = r.height;
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas!.width = Math.round(W * dpr);
      canvas!.height = Math.round(H * dpr);
      canvas!.style.width = `${W}px`;
      canvas!.style.height = `${H}px`;
      if (!centered) {
        scale = Math.max(0.05, Math.min(1.4, (Math.min(W, H) * 0.9) / spread));
        offX = W / 2;
        offY = H / 2;
        centered = true;
      }
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    function nodeRadius(i: number): number {
      return 2 + Math.min(7, Math.sqrt(degree[i]));
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

      // Edges — three passes, faint first so prominent links sit on top.
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
      // When hovering, draw the rest of the edges very dim underneath.
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

      // Nodes — one fill pass per classification.
      for (const cls of ["present", "active", "shepherded"] as const) {
        ctx!.fillStyle = NODE_COLOR[cls];
        ctx!.beginPath();
        for (let i = 0; i < n; i++) {
          if (data.nodes[i].cls !== cls) continue;
          const dim = hl && i !== hover && !hl.has(i);
          if (dim) continue;
          const sx = px[i] * scale + offX;
          const sy = py[i] * scale + offY;
          const r = nodeRadius(i);
          ctx!.moveTo(sx + r, sy);
          ctx!.arc(sx, sy, r, 0, Math.PI * 2);
        }
        ctx!.fill();
      }
      // Dimmed nodes when hovering.
      if (hl) {
        ctx!.fillStyle = "rgba(120,130,150,0.18)";
        ctx!.beginPath();
        for (let i = 0; i < n; i++) {
          if (i === hover || hl.has(i)) continue;
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
        ctx!.strokeStyle = NODE_COLOR[data.nodes[hover].cls];
        ctx!.lineWidth = 1.5;
        ctx!.stroke();
        const label = data.nodes[hover].name;
        ctx!.font =
          "12px ui-sans-serif, system-ui, -apple-system, sans-serif";
        const tw = ctx!.measureText(label).width;
        ctx!.fillStyle = "rgba(10,12,18,0.92)";
        ctx!.fillRect(sx + r + 6, sy - 11, tw + 12, 22);
        ctx!.fillStyle = "#e8ebf2";
        ctx!.fillText(label, sx + r + 12, sy + 4);
      }
    }

    let raf = 0;
    function frame() {
      if (alpha > ALPHA_MIN || dragNode >= 0) tick();
      render();
      raf = requestAnimationFrame(frame);
    }
    frame();

    // ── Pointer interaction ───────────────────────────────────────
    function localXY(e: PointerEvent): [number, number] {
      const r = canvas!.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top];
    }
    function onDown(e: PointerEvent) {
      const [mx, my] = localXY(e);
      const hit = hitTest(mx, my);
      canvas!.setPointerCapture(e.pointerId);
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
          setHoverName(h >= 0 ? data.nodes[h].name : null);
          canvas!.style.cursor = h >= 0 ? "pointer" : "grab";
        }
      }
      lastX = mx;
      lastY = my;
    }
    function onUp(e: PointerEvent) {
      if (dragNode >= 0 && !dragMoved) {
        router.push(`/people/${data.nodes[dragNode].id}`);
      }
      dragNode = -1;
      panning = false;
      try {
        canvas!.releasePointerCapture(e.pointerId);
      } catch {}
    }
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const [mx, my] = [
        e.clientX - canvas!.getBoundingClientRect().left,
        e.clientY - canvas!.getBoundingClientRect().top,
      ];
      const factor = Math.exp(-e.deltaY * 0.0012);
      const next = Math.max(0.02, Math.min(8, scale * factor));
      // Zoom toward the cursor.
      offX = mx - ((mx - offX) * next) / scale;
      offY = my - ((my - offY) * next) / scale;
      scale = next;
    }

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
