"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import SearchBar from "./searchbar";

interface GraphNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  inDegree: number;
  outDegree: number;
}
interface GraphEdge {
  source: string;
  target: string;
}

function extractInternalLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  let baseDomain = "";
  try {
    baseDomain = new URL(baseUrl).hostname;
  } catch {
    return links;
  }
  const regex = /href=["']([^"'#]+)["']/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    try {
      const resolved = new URL(m[1], baseUrl);
      if (resolved.hostname === baseDomain)
        links.push(resolved.origin + resolved.pathname);
    } catch {}
  }
  return [...new Set(links)];
}

export default function Graph() {
  const [data, setData] = useState<any[] | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const nodesRef = useRef<GraphNode[]>([]);
  const edgesRef = useRef<GraphEdge[]>([]);
  const animRef = useRef<number>(0);
  const [hovered, setHovered] = useState<GraphNode | null>(null);
  const [stats, setStats] = useState({ nodes: 0, edges: 0 });

  // Camera: zoom + pan
  const camRef = useRef({ x: 0, y: 0, zoom: 1 });
  // Drag state
  const dragRef = useRef<{
    node: GraphNode | null;
    panning: boolean;
    startX: number;
    startY: number;
    camStartX: number;
    camStartY: number;
  }>({ node: null, panning: false, startX: 0, startY: 0, camStartX: 0, camStartY: 0 });

  const buildGraph = useCallback(() => {
    if (!data?.length) return;
    const pageUrls = new Set(
      data.filter((p) => p?.url).map((p: any) => p.url)
    );
    const inDeg = new Map<string, number>();
    const outDeg = new Map<string, number>();
    const edges: GraphEdge[] = [];
    for (const page of data) {
      if (!page?.url || !page?.content) continue;
      const links = extractInternalLinks(page.content, page.url).filter((l) =>
        pageUrls.has(l)
      );
      outDeg.set(page.url, links.length);
      for (const link of links) {
        inDeg.set(link, (inDeg.get(link) || 0) + 1);
        edges.push({ source: page.url, target: link });
      }
    }

    const count = pageUrls.size;
    // Spread nodes in a large circle proportional to count
    const radius = Math.max(200, count * 12);
    const nodes: GraphNode[] = [...pageUrls].map((url, i) => {
      const angle = (i / count) * Math.PI * 2;
      const jitter = (Math.random() - 0.5) * radius * 0.3;
      return {
        id: url,
        x: Math.cos(angle) * (radius + jitter),
        y: Math.sin(angle) * (radius + jitter),
        vx: 0,
        vy: 0,
        inDegree: inDeg.get(url) || 0,
        outDegree: outDeg.get(url) || 0,
      };
    });

    nodesRef.current = nodes;
    edgesRef.current = edges;
    setStats({ nodes: nodes.length, edges: edges.length });

    // Reset camera to center on graph
    camRef.current = { x: 0, y: 0, zoom: 1 };
  }, [data]);

  useEffect(() => {
    buildGraph();
  }, [buildGraph]);

  // Force simulation + rendering loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let running = true;
    let alpha = 1;

    const tick = () => {
      if (!running) return;
      const nodes = nodesRef.current;
      const edges = edgesRef.current;
      const cam = camRef.current;
      const drag = dragRef.current;

      // Resize canvas to container
      const dpr = window.devicePixelRatio || 1;
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      if (canvas.width !== cw * dpr || canvas.height !== ch * dpr) {
        canvas.width = cw * dpr;
        canvas.height = ch * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      if (nodes.length > 0) {
        // Alpha decay
        alpha *= 0.997;
        if (alpha < 0.001) alpha = 0.001;

        const nodeCount = nodes.length;
        // Adaptive repulsion scales with node count
        const repulsionStrength = Math.min(8000, 3000 + nodeCount * 40);
        const targetDist = Math.max(120, 80 + nodeCount * 1.5);

        // Damping
        for (const n of nodes) {
          n.vx *= 0.55;
          n.vy *= 0.55;
        }

        // Center gravity — gentle pull toward origin
        for (const n of nodes) {
          n.vx += -n.x * 0.003 * alpha;
          n.vy += -n.y * 0.003 * alpha;
        }

        // Repulsion (charge force)
        for (let i = 0; i < nodeCount; i++) {
          for (let j = i + 1; j < nodeCount; j++) {
            const dx = nodes[j].x - nodes[i].x;
            const dy = nodes[j].y - nodes[i].y;
            const distSq = dx * dx + dy * dy;
            const dist = Math.max(Math.sqrt(distSq), 1);
            const force = (repulsionStrength / distSq) * alpha;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            nodes[i].vx -= fx;
            nodes[i].vy -= fy;
            nodes[j].vx += fx;
            nodes[j].vy += fy;
          }
        }

        // Attraction along edges (spring force)
        const nodeMap = new Map(nodes.map((n) => [n.id, n]));
        for (const edge of edges) {
          const s = nodeMap.get(edge.source);
          const t = nodeMap.get(edge.target);
          if (!s || !t) continue;
          const dx = t.x - s.x;
          const dy = t.y - s.y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          const force = (dist - targetDist) * 0.008 * alpha;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          s.vx += fx;
          s.vy += fy;
          t.vx -= fx;
          t.vy -= fy;
        }

        // Velocity clamping + position update
        for (const n of nodes) {
          // Pin dragged node
          if (drag.node === n) {
            n.vx = 0;
            n.vy = 0;
            continue;
          }
          const speed = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
          if (speed > 8) {
            n.vx = (n.vx / speed) * 8;
            n.vy = (n.vy / speed) * 8;
          }
          n.x += n.vx;
          n.y += n.vy;
        }
      }

      // --- Drawing ---
      ctx.fillStyle = "hsl(240, 10%, 3.5%)";
      ctx.fillRect(0, 0, cw, ch);

      if (nodes.length === 0) {
        animRef.current = requestAnimationFrame(tick);
        return;
      }

      // Apply camera transform
      ctx.save();
      ctx.translate(cw / 2 + cam.x, ch / 2 + cam.y);
      ctx.scale(cam.zoom, cam.zoom);

      const nodeMap = new Map(nodes.map((n) => [n.id, n]));
      const hoveredNode = hovered;

      // Edges — curved quadratic bezier with opacity based on connectivity
      for (const edge of edges) {
        const s = nodeMap.get(edge.source);
        const t = nodeMap.get(edge.target);
        if (!s || !t) continue;

        const isHighlighted =
          hoveredNode &&
          (s.id === hoveredNode.id || t.id === hoveredNode.id);

        const dx = t.x - s.x;
        const dy = t.y - s.y;
        // Curve offset perpendicular to the line
        const len = Math.sqrt(dx * dx + dy * dy);
        const curvature = Math.min(30, len * 0.1);
        const mx = (s.x + t.x) / 2 + (-dy / len) * curvature;
        const my = (s.y + t.y) / 2 + (dx / len) * curvature;

        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.quadraticCurveTo(mx, my, t.x, t.y);

        if (isHighlighted) {
          ctx.strokeStyle = "rgba(59, 222, 119, 0.6)";
          ctx.lineWidth = 1.5 / cam.zoom;
        } else {
          ctx.strokeStyle = "rgba(59, 222, 119, 0.08)";
          ctx.lineWidth = 0.8 / cam.zoom;
        }
        ctx.stroke();

        // Arrow head on highlighted edges
        if (isHighlighted) {
          const arrowLen = 8 / cam.zoom;
          // Point along curve near target
          const at = 0.85;
          const ax = (1 - at) * (1 - at) * s.x + 2 * (1 - at) * at * mx + at * at * t.x;
          const ay = (1 - at) * (1 - at) * s.y + 2 * (1 - at) * at * my + at * at * t.y;
          const adx = t.x - ax;
          const ady = t.y - ay;
          const aLen = Math.sqrt(adx * adx + ady * ady) || 1;
          const ux = adx / aLen;
          const uy = ady / aLen;
          // Arrow tip near target
          const tipX = t.x - ux * (nodeRadius(t) + 2 / cam.zoom);
          const tipY = t.y - uy * (nodeRadius(t) + 2 / cam.zoom);
          ctx.beginPath();
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(tipX - ux * arrowLen + uy * arrowLen * 0.4, tipY - uy * arrowLen - ux * arrowLen * 0.4);
          ctx.lineTo(tipX - ux * arrowLen - uy * arrowLen * 0.4, tipY - uy * arrowLen + ux * arrowLen * 0.4);
          ctx.closePath();
          ctx.fillStyle = "rgba(59, 222, 119, 0.6)";
          ctx.fill();
        }
      }

      // Nodes
      const maxDegree = Math.max(1, ...nodes.map((n) => n.inDegree + n.outDegree));

      for (const n of nodes) {
        const r = nodeRadius(n);
        const isHov = hoveredNode?.id === n.id;
        const isNeighbor =
          hoveredNode &&
          edges.some(
            (e) =>
              (e.source === hoveredNode.id && e.target === n.id) ||
              (e.target === hoveredNode.id && e.source === n.id)
          );
        const degree = n.inDegree + n.outDegree;
        const importance = degree / maxDegree;

        // Glow for high-degree or hovered nodes
        if (isHov || importance > 0.3) {
          const glowR = r + (isHov ? 12 : 6) / cam.zoom;
          const grad = ctx.createRadialGradient(n.x, n.y, r * 0.5, n.x, n.y, glowR);
          grad.addColorStop(0, isHov ? "rgba(255, 255, 255, 0.25)" : "rgba(59, 222, 119, 0.15)");
          grad.addColorStop(1, "rgba(59, 222, 119, 0)");
          ctx.beginPath();
          ctx.arc(n.x, n.y, glowR, 0, Math.PI * 2);
          ctx.fillStyle = grad;
          ctx.fill();
        }

        // Node circle
        ctx.beginPath();
        ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        if (isHov) {
          ctx.fillStyle = "#ffffff";
        } else if (isNeighbor) {
          ctx.fillStyle = "#6aeea0";
        } else {
          // Color intensity by importance
          const g = Math.round(180 + importance * 75);
          ctx.fillStyle = `rgb(40, ${g}, ${Math.round(80 + importance * 40)})`;
        }
        ctx.fill();

        // Subtle ring on important nodes
        if (importance > 0.5 && !isHov) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, r + 1.5 / cam.zoom, 0, Math.PI * 2);
          ctx.strokeStyle = "rgba(59, 222, 119, 0.3)";
          ctx.lineWidth = 1 / cam.zoom;
          ctx.stroke();
        }
      }

      // Labels — only for hovered, its neighbors, and top-degree nodes
      const labelCount = Math.max(2, Math.floor(nodes.length * 0.15));
      const sortedByDegree = [...nodes].sort((a, b) => (b.inDegree + b.outDegree) - (a.inDegree + a.outDegree));
      const cutoffNode = sortedByDegree[Math.min(labelCount, nodes.length - 1)];
      const topDegreeThreshold = cutoffNode ? cutoffNode.inDegree + cutoffNode.outDegree : 0;

      for (const n of nodes) {
        const isHov = hoveredNode?.id === n.id;
        const isNeighbor =
          hoveredNode &&
          edges.some(
            (e) =>
              (e.source === hoveredNode.id && e.target === n.id) ||
              (e.target === hoveredNode.id && e.source === n.id)
          );
        const degree = n.inDegree + n.outDegree;
        const showLabel = isHov || isNeighbor || degree >= topDegreeThreshold;

        if (!showLabel) continue;

        let pathname = "/";
        try {
          pathname = new URL(n.id).pathname;
        } catch {}
        if (pathname.length > 35) pathname = pathname.slice(0, 32) + "...";

        const r = nodeRadius(n);
        const fontSize = Math.max(9, Math.min(12, 10 + (degree / maxDegree) * 3));
        ctx.font = `${fontSize / cam.zoom}px ui-monospace, monospace`;

        // Label background for readability
        const textW = ctx.measureText(pathname).width;
        const lx = n.x + r + 5 / cam.zoom;
        const ly = n.y;
        const pad = 3 / cam.zoom;

        ctx.fillStyle = "rgba(10, 10, 15, 0.75)";
        ctx.beginPath();
        const bx = lx - pad;
        const by = ly - fontSize / cam.zoom / 2 - pad;
        const bw = textW + pad * 2;
        const bh = fontSize / cam.zoom + pad * 2;
        const br = 3 / cam.zoom;
        ctx.moveTo(bx + br, by);
        ctx.lineTo(bx + bw - br, by);
        ctx.quadraticCurveTo(bx + bw, by, bx + bw, by + br);
        ctx.lineTo(bx + bw, by + bh - br);
        ctx.quadraticCurveTo(bx + bw, by + bh, bx + bw - br, by + bh);
        ctx.lineTo(bx + br, by + bh);
        ctx.quadraticCurveTo(bx, by + bh, bx, by + bh - br);
        ctx.lineTo(bx, by + br);
        ctx.quadraticCurveTo(bx, by, bx + br, by);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = isHov
          ? "#ffffff"
          : isNeighbor
          ? "#6aeea0"
          : "rgba(255, 255, 255, 0.8)";
        ctx.textBaseline = "middle";
        ctx.fillText(pathname, lx, ly);
      }

      ctx.restore();

      animRef.current = requestAnimationFrame(tick);
    };

    tick();
    return () => {
      running = false;
      cancelAnimationFrame(animRef.current);
    };
  }, [data, hovered]);

  function nodeRadius(n: GraphNode): number {
    return Math.max(4, Math.min(20, 4 + n.inDegree * 1.5 + n.outDegree * 0.5));
  }

  // --- Interaction handlers ---

  function screenToWorld(sx: number, sy: number) {
    const cam = camRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    return {
      x: (sx - canvas.clientWidth / 2 - cam.x) / cam.zoom,
      y: (sy - canvas.clientHeight / 2 - cam.y) / cam.zoom,
    };
  }

  function findNodeAt(wx: number, wy: number): GraphNode | undefined {
    const cam = camRef.current;
    return nodesRef.current.find((n) => {
      const r = nodeRadius(n) + 4 / cam.zoom;
      return Math.hypot(n.x - wx, n.y - wy) < r;
    });
  }

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const { x: wx, y: wy } = screenToWorld(sx, sy);
    const node = findNodeAt(wx, wy);

    if (node) {
      dragRef.current = { node, panning: false, startX: sx, startY: sy, camStartX: 0, camStartY: 0 };
    } else {
      const cam = camRef.current;
      dragRef.current = { node: null, panning: true, startX: sx, startY: sy, camStartX: cam.x, camStartY: cam.y };
    }
  };

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const drag = dragRef.current;

    if (drag.node) {
      // Dragging a node
      const { x: wx, y: wy } = screenToWorld(sx, sy);
      drag.node.x = wx;
      drag.node.y = wy;
      drag.node.vx = 0;
      drag.node.vy = 0;
      setHovered(drag.node);
      return;
    }

    if (drag.panning) {
      const cam = camRef.current;
      cam.x = drag.camStartX + (sx - drag.startX);
      cam.y = drag.camStartY + (sy - drag.startY);
      return;
    }

    // Hover detection
    const { x: wx, y: wy } = screenToWorld(sx, sy);
    const found = findNodeAt(wx, wy);
    setHovered(found || null);
  };

  const onMouseUp = () => {
    dragRef.current = { node: null, panning: false, startX: 0, startY: 0, camStartX: 0, camStartY: 0 };
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const cam = camRef.current;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;

    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    const oldZoom = cam.zoom;
    const factor = e.deltaY < 0 ? 1.08 : 1 / 1.08;
    cam.zoom = Math.max(0.1, Math.min(10, cam.zoom * factor));

    // Zoom toward cursor position
    const cx = sx - rect.width / 2;
    const cy = sy - rect.height / 2;
    cam.x = cx - (cx - cam.x) * (cam.zoom / oldZoom);
    cam.y = cy - (cy - cam.y) * (cam.zoom / oldZoom);
  };

  // Sidebar data
  const nodes = nodesRef.current;
  const topPages = [...nodes]
    .sort((a, b) => b.inDegree - a.inDegree)
    .slice(0, 10);
  const orphans = nodes.filter((n) => n.inDegree === 0);

  return (
    <div className="flex flex-col h-screen">
      <SearchBar setDataValues={setData} />
      <div className="flex flex-1 overflow-hidden">
        <canvas
          ref={canvasRef}
          className="flex-1 cursor-crosshair"
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseUp}
          onWheel={onWheel}
        />
        <div className="w-64 border-l overflow-auto p-3 text-sm shrink-0 bg-background">
          <h3 className="font-bold mb-2">Stats</h3>
          <p>
            Pages: {stats.nodes}
          </p>
          <p>
            Links: {stats.edges}
          </p>
          {hovered && (
            <div className="mt-3 p-2 border rounded text-xs bg-muted/30">
              <p className="truncate font-medium text-[#3bde77]">
                {hovered.id}
              </p>
              <p className="mt-1">
                In: {hovered.inDegree} &middot; Out: {hovered.outDegree}
              </p>
            </div>
          )}
          <h3 className="font-bold mt-4 mb-2">Top Linked</h3>
          {topPages.map((n) => (
            <p key={n.id} className="truncate text-xs py-0.5">
              <span className="text-[#3bde77] mr-1 font-mono">
                {n.inDegree}
              </span>
              {(() => { try { return new URL(n.id).pathname; } catch { return n.id; } })()}
            </p>
          ))}
          {orphans.length > 0 && (
            <>
              <h3 className="font-bold mt-4 mb-2 text-yellow-500">
                Orphan Pages ({orphans.length})
              </h3>
              {orphans.slice(0, 10).map((n) => (
                <p key={n.id} className="truncate text-xs py-0.5">
                  {(() => { try { return new URL(n.id).pathname; } catch { return n.id; } })()}
                </p>
              ))}
            </>
          )}
          <div className="mt-6 pt-3 border-t text-xs text-muted-foreground space-y-1">
            <p>Scroll to zoom</p>
            <p>Drag canvas to pan</p>
            <p>Drag nodes to move</p>
          </div>
        </div>
      </div>
    </div>
  );
}
