"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import SearchBar from "./searchbar";

interface GraphNode { id: string; x: number; y: number; vx: number; vy: number; inDegree: number; outDegree: number; }
interface GraphEdge { source: string; target: string; }

function extractInternalLinks(html: string, baseUrl: string): string[] {
  const links: string[] = [];
  let baseDomain = "";
  try { baseDomain = new URL(baseUrl).hostname; } catch { return links; }
  const regex = /href=["']([^"'#]+)["']/gi;
  let m;
  while ((m = regex.exec(html)) !== null) {
    try {
      const resolved = new URL(m[1], baseUrl);
      if (resolved.hostname === baseDomain) links.push(resolved.origin + resolved.pathname);
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

  const buildGraph = useCallback(() => {
    if (!data?.length) return;
    const pageUrls = new Set(data.filter((p) => p?.url).map((p: any) => p.url));
    const inDeg = new Map<string, number>();
    const outDeg = new Map<string, number>();
    const edges: GraphEdge[] = [];
    for (const page of data) {
      if (!page?.url || !page?.content) continue;
      const links = extractInternalLinks(page.content, page.url).filter((l) => pageUrls.has(l));
      outDeg.set(page.url, links.length);
      for (const link of links) {
        inDeg.set(link, (inDeg.get(link) || 0) + 1);
        edges.push({ source: page.url, target: link });
      }
    }
    const w = canvasRef.current?.clientWidth || 800, h = canvasRef.current?.clientHeight || 600;
    const nodes: GraphNode[] = [...pageUrls].map((url, i) => ({
      id: url, x: w / 2 + Math.cos(i * 2.4) * 150 + Math.random() * 30, y: h / 2 + Math.sin(i * 2.4) * 150 + Math.random() * 30,
      vx: 0, vy: 0, inDegree: inDeg.get(url) || 0, outDegree: outDeg.get(url) || 0,
    }));
    nodesRef.current = nodes;
    edgesRef.current = edges;
  }, [data]);

  useEffect(() => { buildGraph(); }, [buildGraph]);

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
      const cx = canvas.clientWidth / 2, cy = canvas.clientHeight / 2;

      // Alpha decay — simulation cools down and settles
      alpha *= 0.995;
      if (alpha < 0.001) alpha = 0.001;

      // Force simulation
      for (const n of nodes) { n.vx *= 0.6; n.vy *= 0.6; }
      // Center gravity — pull toward canvas center
      for (const n of nodes) {
        n.vx += (cx - n.x) * 0.005 * alpha;
        n.vy += (cy - n.y) * 0.005 * alpha;
      }
      // Repulsion
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[j].x - nodes[i].x, dy = nodes[j].y - nodes[i].y;
          const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
          const force = (2000 / (dist * dist)) * alpha;
          nodes[i].vx -= (dx / dist) * force; nodes[i].vy -= (dy / dist) * force;
          nodes[j].vx += (dx / dist) * force; nodes[j].vy += (dy / dist) * force;
        }
      }
      // Attraction along edges
      const nodeMap = new Map(nodes.map((n) => [n.id, n]));
      for (const edge of edges) {
        const s = nodeMap.get(edge.source), t = nodeMap.get(edge.target);
        if (!s || !t) continue;
        const dx = t.x - s.x, dy = t.y - s.y;
        const dist = Math.max(Math.sqrt(dx * dx + dy * dy), 1);
        const force = (dist - 100) * 0.02 * alpha;
        s.vx += (dx / dist) * force; s.vy += (dy / dist) * force;
        t.vx -= (dx / dist) * force; t.vy -= (dy / dist) * force;
      }
      // Clamp velocities to prevent runaway
      for (const n of nodes) {
        const speed = Math.sqrt(n.vx * n.vx + n.vy * n.vy);
        if (speed > 10) { n.vx = (n.vx / speed) * 10; n.vy = (n.vy / speed) * 10; }
        n.x += n.vx; n.y += n.vy;
      }
      // Draw
      canvas.width = canvas.clientWidth; canvas.height = canvas.clientHeight;
      ctx.fillStyle = "hsl(240, 10%, 4%)"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.strokeStyle = "rgba(59, 222, 119, 0.15)"; ctx.lineWidth = 1;
      for (const edge of edges) {
        const s = nodeMap.get(edge.source), t = nodeMap.get(edge.target);
        if (!s || !t) continue;
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(t.x, t.y); ctx.stroke();
      }
      for (const n of nodes) {
        const r = Math.max(4, Math.min(16, 4 + n.inDegree * 2));
        ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
        ctx.fillStyle = n === hovered ? "#fff" : "#3bde77"; ctx.fill();
        // Label
        let pathname = "/";
        try { pathname = new URL(n.id).pathname; } catch {}
        if (pathname.length > 30) pathname = pathname.slice(0, 27) + "...";
        ctx.font = "10px monospace";
        ctx.fillStyle = n === hovered ? "#fff" : "rgba(255,255,255,0.7)";
        ctx.fillText(pathname, n.x + r + 4, n.y + 3);
      }
      animRef.current = requestAnimationFrame(tick);
    };
    tick();
    return () => { running = false; cancelAnimationFrame(animRef.current); };
  }, [data, hovered]);

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const found = nodesRef.current.find((n) => Math.hypot(n.x - mx, n.y - my) < 16);
    setHovered(found || null);
  };

  const nodes = nodesRef.current;
  const topPages = [...nodes].sort((a, b) => b.inDegree - a.inDegree).slice(0, 10);
  const orphans = nodes.filter((n) => n.inDegree === 0);

  return (
    <div className="flex flex-col h-screen">
      <SearchBar setDataValues={setData} />
      <div className="flex flex-1 overflow-hidden">
        <canvas ref={canvasRef} className="flex-1 cursor-crosshair" onMouseMove={onMouseMove} />
        <div className="w-64 border-l overflow-auto p-3 text-sm shrink-0">
          <h3 className="font-bold mb-2">Stats</h3>
          <p>Pages: {nodes.length}</p>
          <p>Links: {edgesRef.current.length}</p>
          {hovered && <div className="mt-3 p-2 border rounded text-xs"><p className="truncate font-medium">{hovered.id}</p><p>In: {hovered.inDegree} Out: {hovered.outDegree}</p></div>}
          <h3 className="font-bold mt-4 mb-2">Top Linked</h3>
          {topPages.map((n) => <p key={n.id} className="truncate text-xs py-0.5"><span className="text-primary mr-1">{n.inDegree}</span>{new URL(n.id).pathname}</p>)}
          {orphans.length > 0 && (<><h3 className="font-bold mt-4 mb-2 text-yellow-500">Orphan Pages ({orphans.length})</h3>{orphans.slice(0, 10).map((n) => <p key={n.id} className="truncate text-xs py-0.5">{new URL(n.id).pathname}</p>)}</>)}
        </div>
      </div>
    </div>
  );
}
