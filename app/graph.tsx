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
  pinned?: boolean;
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

  // Adjacency lookup for fast neighbor checks
  const adjacencyRef = useRef<Map<string, Set<string>>>(new Map());

  const buildGraph = useCallback(() => {
    if (!data?.length) return;
    const pageUrls = new Set(
      data.filter((p) => p?.url).map((p: any) => p.url)
    );
    const inDeg = new Map<string, number>();
    const outDeg = new Map<string, number>();
    const edges: GraphEdge[] = [];
    const adjacency = new Map<string, Set<string>>();

    for (const page of data) {
      if (!page?.url || !page?.content) continue;
      const links = extractInternalLinks(page.content, page.url).filter((l) =>
        pageUrls.has(l)
      );
      outDeg.set(page.url, links.length);
      for (const link of links) {
        if (link === page.url) continue; // skip self-links
        inDeg.set(link, (inDeg.get(link) || 0) + 1);
        edges.push({ source: page.url, target: link });
        // Build adjacency
        if (!adjacency.has(page.url)) adjacency.set(page.url, new Set());
        if (!adjacency.has(link)) adjacency.set(link, new Set());
        adjacency.get(page.url)!.add(link);
        adjacency.get(link)!.add(page.url);
      }
    }

    const count = pageUrls.size;
    // Large initial spread — golden angle distribution for even spacing
    const spreadRadius = Math.max(400, count * 35);
    const goldenAngle = Math.PI * (3 - Math.sqrt(5));
    const nodes: GraphNode[] = [...pageUrls].map((url, i) => {
      const angle = i * goldenAngle;
      const r = spreadRadius * Math.sqrt((i + 1) / count);
      return {
        id: url,
        x: Math.cos(angle) * r,
        y: Math.sin(angle) * r,
        vx: 0,
        vy: 0,
        inDegree: inDeg.get(url) || 0,
        outDegree: outDeg.get(url) || 0,
      };
    });

    nodesRef.current = nodes;
    edgesRef.current = edges;
    adjacencyRef.current = adjacency;
    setStats({ nodes: nodes.length, edges: edges.length });

    // Auto-fit camera zoom to show all nodes
    if (nodes.length > 1) {
      const canvas = canvasRef.current;
      if (canvas) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const n of nodes) {
          if (n.x < minX) minX = n.x;
          if (n.x > maxX) maxX = n.x;
          if (n.y < minY) minY = n.y;
          if (n.y > maxY) maxY = n.y;
        }
        const graphW = maxX - minX + 100;
        const graphH = maxY - minY + 100;
        const cw = canvas.clientWidth;
        const ch = canvas.clientHeight;
        const fitZoom = Math.min(cw / graphW, ch / graphH, 1.5) * 0.85;
        camRef.current = { x: 0, y: 0, zoom: fitZoom };
      } else {
        camRef.current = { x: 0, y: 0, zoom: 0.5 };
      }
    } else {
      camRef.current = { x: 0, y: 0, zoom: 1 };
    }
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
    let tickCount = 0;

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
        tickCount++;
        // Slow alpha decay — let the simulation run longer
        alpha *= 0.9985;
        if (alpha < 0.001) alpha = 0.001;

        const nodeCount = nodes.length;

        // --- Velocity damping ---
        const damping = 0.82;
        for (const n of nodes) {
          n.vx *= damping;
          n.vy *= damping;
        }

        // --- Center gravity: very gentle pull toward origin ---
        const gravity = 0.002 * alpha;
        for (const n of nodes) {
          n.vx -= n.x * gravity;
          n.vy -= n.y * gravity;
        }

        // --- Repulsion: Coulomb's law with NO cap ---
        // Use 1/dist (not 1/dist^2) for longer-range repulsion that prevents clumping
        const repulsionK = 800 + nodeCount * 80;
        for (let i = 0; i < nodeCount; i++) {
          for (let j = i + 1; j < nodeCount; j++) {
            const dx = nodes[j].x - nodes[i].x;
            const dy = nodes[j].y - nodes[i].y;
            const distSq = dx * dx + dy * dy;
            const dist = Math.sqrt(distSq) || 0.1;
            // 1/dist repulsion — much longer range than 1/dist^2
            const force = (repulsionK / dist) * alpha;
            const fx = (dx / dist) * force;
            const fy = (dy / dist) * force;
            nodes[i].vx -= fx;
            nodes[i].vy -= fy;
            nodes[j].vx += fx;
            nodes[j].vy += fy;
          }
        }

        // --- Collision: prevent node overlap ---
        const collisionPad = 8;
        for (let i = 0; i < nodeCount; i++) {
          for (let j = i + 1; j < nodeCount; j++) {
            const dx = nodes[j].x - nodes[i].x;
            const dy = nodes[j].y - nodes[i].y;
            const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
            const ri = nodeRadius(nodes[i]);
            const rj = nodeRadius(nodes[j]);
            const minDist = ri + rj + collisionPad;
            if (dist < minDist) {
              const push = (minDist - dist) * 0.5;
              const ux = dx / dist;
              const uy = dy / dist;
              nodes[i].x -= ux * push;
              nodes[i].y -= uy * push;
              nodes[j].x += ux * push;
              nodes[j].y += uy * push;
            }
          }
        }

        // --- Attraction along edges: weak spring ---
        const nodeMap = new Map(nodes.map((n) => [n.id, n]));
        const idealLen = Math.max(180, 120 + nodeCount * 3);
        const springK = 0.0015 * alpha;
        for (const edge of edges) {
          const s = nodeMap.get(edge.source);
          const t = nodeMap.get(edge.target);
          if (!s || !t) continue;
          const dx = t.x - s.x;
          const dy = t.y - s.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
          const displacement = dist - idealLen;
          const force = displacement * springK;
          const fx = (dx / dist) * force;
          const fy = (dy / dist) * force;
          s.vx += fx;
          s.vy += fy;
          t.vx -= fx;
          t.vy -= fy;
        }

        // --- Velocity clamping + position update ---
        const maxSpeed = 15;
        for (const n of nodes) {
          if (n.pinned || drag.node === n) {
            n.vx = 0;
            n.vy = 0;
            continue;
          }
          const speed = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
          if (speed > maxSpeed) {
            n.vx = (n.vx / speed) * maxSpeed;
            n.vy = (n.vy / speed) * maxSpeed;
          }
          n.x += n.vx;
          n.y += n.vy;
        }

        // Auto-fit camera during early ticks
        if (tickCount % 60 === 0 && tickCount < 300 && alpha > 0.3) {
          let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
          for (const n of nodes) {
            if (n.x < minX) minX = n.x;
            if (n.x > maxX) maxX = n.x;
            if (n.y < minY) minY = n.y;
            if (n.y > maxY) maxY = n.y;
          }
          const graphW = maxX - minX + 200;
          const graphH = maxY - minY + 200;
          if (graphW > 0 && graphH > 0 && !drag.node && !drag.panning) {
            const fitZoom = Math.min(cw / graphW, ch / graphH, 2) * 0.85;
            cam.zoom += (fitZoom - cam.zoom) * 0.1;
          }
        }
      }

      // --- Drawing ---
      ctx.fillStyle = "#07080a";
      ctx.fillRect(0, 0, cw, ch);

      // Subtle grid
      ctx.save();
      ctx.translate(cw / 2 + cam.x, ch / 2 + cam.y);
      ctx.scale(cam.zoom, cam.zoom);
      const gridSize = 80;
      const gridRange = 4000;
      ctx.strokeStyle = "rgba(255,255,255,0.015)";
      ctx.lineWidth = 0.5 / cam.zoom;
      for (let gx = -gridRange; gx <= gridRange; gx += gridSize) {
        ctx.beginPath();
        ctx.moveTo(gx, -gridRange);
        ctx.lineTo(gx, gridRange);
        ctx.stroke();
      }
      for (let gy = -gridRange; gy <= gridRange; gy += gridSize) {
        ctx.beginPath();
        ctx.moveTo(-gridRange, gy);
        ctx.lineTo(gridRange, gy);
        ctx.stroke();
      }
      ctx.restore();

      if (nodes.length === 0) {
        // Empty state
        ctx.save();
        ctx.fillStyle = "rgba(255,255,255,0.15)";
        ctx.font = "16px ui-monospace, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("Enter a URL to visualize its link structure", cw / 2, ch / 2);
        ctx.restore();
        animRef.current = requestAnimationFrame(tick);
        return;
      }

      // Apply camera transform
      ctx.save();
      ctx.translate(cw / 2 + cam.x, ch / 2 + cam.y);
      ctx.scale(cam.zoom, cam.zoom);

      const nodeMap = new Map(nodes.map((n) => [n.id, n]));
      const hoveredNode = hovered;
      const adj = adjacencyRef.current;

      // Set of hovered node's neighbor IDs
      const hovNeighbors = new Set<string>();
      if (hoveredNode) {
        const s = adj.get(hoveredNode.id);
        if (s) s.forEach((id) => hovNeighbors.add(id));
      }

      // --- Edges ---
      for (const edge of edges) {
        const s = nodeMap.get(edge.source);
        const t = nodeMap.get(edge.target);
        if (!s || !t) continue;

        const isHighlighted =
          hoveredNode &&
          (s.id === hoveredNode.id || t.id === hoveredNode.id);
        const dimmed = hoveredNode && !isHighlighted;

        const dx = t.x - s.x;
        const dy = t.y - s.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const curvature = Math.min(25, len * 0.08);
        const mx = (s.x + t.x) / 2 + (-dy / len) * curvature;
        const my = (s.y + t.y) / 2 + (dx / len) * curvature;

        ctx.beginPath();
        ctx.moveTo(s.x, s.y);
        ctx.quadraticCurveTo(mx, my, t.x, t.y);

        if (isHighlighted) {
          ctx.strokeStyle = "rgba(59, 222, 119, 0.7)";
          ctx.lineWidth = 2 / cam.zoom;
        } else if (dimmed) {
          ctx.strokeStyle = "rgba(59, 222, 119, 0.025)";
          ctx.lineWidth = 0.5 / cam.zoom;
        } else {
          ctx.strokeStyle = "rgba(59, 222, 119, 0.07)";
          ctx.lineWidth = 0.7 / cam.zoom;
        }
        ctx.stroke();

        // Arrow on highlighted edges
        if (isHighlighted) {
          const arrowLen = 8 / cam.zoom;
          const at = 0.85;
          const ax = (1 - at) * (1 - at) * s.x + 2 * (1 - at) * at * mx + at * at * t.x;
          const ay = (1 - at) * (1 - at) * s.y + 2 * (1 - at) * at * my + at * at * t.y;
          const adx = t.x - ax;
          const ady = t.y - ay;
          const aLen = Math.sqrt(adx * adx + ady * ady) || 1;
          const ux = adx / aLen;
          const uy = ady / aLen;
          const tr = nodeRadius(t);
          const tipX = t.x - ux * (tr + 3 / cam.zoom);
          const tipY = t.y - uy * (tr + 3 / cam.zoom);
          ctx.beginPath();
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(tipX - ux * arrowLen + uy * arrowLen * 0.4, tipY - uy * arrowLen - ux * arrowLen * 0.4);
          ctx.lineTo(tipX - ux * arrowLen - uy * arrowLen * 0.4, tipY - uy * arrowLen + ux * arrowLen * 0.4);
          ctx.closePath();
          ctx.fillStyle = "rgba(59, 222, 119, 0.7)";
          ctx.fill();
        }
      }

      // --- Nodes ---
      const maxDegree = Math.max(1, ...nodes.map((n) => n.inDegree + n.outDegree));

      for (const n of nodes) {
        const r = nodeRadius(n);
        const isHov = hoveredNode?.id === n.id;
        const isNeighbor = hovNeighbors.has(n.id);
        const dimmed = hoveredNode && !isHov && !isNeighbor;
        const degree = n.inDegree + n.outDegree;
        const importance = degree / maxDegree;

        // Outer glow
        if (isHov || (importance > 0.4 && !dimmed)) {
          const glowR = r + (isHov ? 16 : 8) / cam.zoom;
          const grad = ctx.createRadialGradient(n.x, n.y, r * 0.3, n.x, n.y, glowR);
          grad.addColorStop(0, isHov ? "rgba(255, 255, 255, 0.3)" : "rgba(59, 222, 119, 0.2)");
          grad.addColorStop(1, "transparent");
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
        } else if (dimmed) {
          ctx.fillStyle = `rgba(30, ${100 + importance * 40}, ${50 + importance * 20}, 0.3)`;
        } else {
          const g = Math.round(160 + importance * 95);
          ctx.fillStyle = `rgb(30, ${g}, ${Math.round(70 + importance * 50)})`;
        }
        ctx.fill();

        // Ring on important nodes
        if (importance > 0.5 && !dimmed) {
          ctx.beginPath();
          ctx.arc(n.x, n.y, r + 2 / cam.zoom, 0, Math.PI * 2);
          ctx.strokeStyle = isHov ? "rgba(255,255,255,0.5)" : "rgba(59, 222, 119, 0.35)";
          ctx.lineWidth = 1.2 / cam.zoom;
          ctx.stroke();
        }
      }

      // --- Labels: only hovered node + its neighbors ---
      if (hoveredNode) {
        const labelNodes = [hoveredNode, ...nodes.filter((n) => hovNeighbors.has(n.id))];
        for (const n of labelNodes) {
          const isHov = n.id === hoveredNode.id;
          let pathname = "/";
          try { pathname = new URL(n.id).pathname; } catch {}
          if (pathname.length > 40) pathname = pathname.slice(0, 37) + "...";

          const r = nodeRadius(n);
          const fontSize = isHov ? 12 : 10;
          ctx.font = `${fontSize / cam.zoom}px ui-monospace, monospace`;

          const textW = ctx.measureText(pathname).width;
          const lx = n.x + r + 6 / cam.zoom;
          const ly = n.y;
          const pad = 4 / cam.zoom;

          // Background pill
          ctx.fillStyle = "rgba(7, 8, 10, 0.88)";
          const bx = lx - pad;
          const by = ly - fontSize / cam.zoom / 2 - pad;
          const bw = textW + pad * 2;
          const bh = fontSize / cam.zoom + pad * 2;
          const br = 4 / cam.zoom;
          ctx.beginPath();
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
          // Border
          ctx.strokeStyle = isHov ? "rgba(255,255,255,0.2)" : "rgba(59,222,119,0.2)";
          ctx.lineWidth = 0.8 / cam.zoom;
          ctx.stroke();

          ctx.fillStyle = isHov ? "#ffffff" : "#6aeea0";
          ctx.textBaseline = "middle";
          ctx.fillText(pathname, lx, ly);
        }
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
    return Math.max(3, Math.min(18, 3 + n.inDegree * 1.2 + n.outDegree * 0.4));
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
    // Check in reverse order so top-drawn nodes are found first
    for (let i = nodesRef.current.length - 1; i >= 0; i--) {
      const n = nodesRef.current[i];
      const r = nodeRadius(n) + 6 / cam.zoom;
      if (Math.hypot(n.x - wx, n.y - wy) < r) return n;
    }
    return undefined;
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
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    cam.zoom = Math.max(0.05, Math.min(10, cam.zoom * factor));

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
            <p>Hover nodes for details</p>
          </div>
        </div>
      </div>
    </div>
  );
}
