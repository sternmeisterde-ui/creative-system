"use client";
import { useEffect, useState, useMemo } from "react";
import { ReactFlow, Background, Controls, Handle, Position, type Node, type Edge } from "@xyflow/react";
import "@xyflow/react/dist/style.css";

const PARAM_COLOR: Record<string, string> = {
  persona: "#48B8D0", hook: "#C490D1", body: "#6EC8A0", angle: "#FF8B5A",
};
const KIND = {
  winner:   { c: "#6EC8A0", t: "ВИННЕР" },
  loser:    { c: "#D96B6B", t: "ЛУЗЕР" },
  proposal: { c: "#C490D1", t: "НОВЫЙ КРЕАТИВ" },
} as const;

type Codes = { persona: string | null; hook: string | null; body: string | null; angle: string | null; format: string | null; flow: string | null };
interface GraphNode { adName: string; codes: Codes; cpl: number | null; cpql: number | null; leads: number; qualLeads: number; spend: number }
interface Proposal { fromWinner: number; changedParam: string; oldCode: string; newCode: string; codes: Codes; adName: string }
interface GraphData { winners: GraphNode[]; losers: GraphNode[]; proposals: Proposal[]; hurts: string[]; hasData: boolean }

const eur = (v: number | null) => v == null ? "—" : `€${v.toFixed(1)}`;
const cplColor = (v: number | null) => v == null ? "#666" : v <= 20 ? "#6EC8A0" : v <= 26 ? "#FF8B5A" : "#D96B6B";

type NodeData = {
  kind: keyof typeof KIND;
  adName: string;
  codes: Codes;
  metrics?: { cpl: number | null; cpql: number | null; leads: number };
  changed?: { param: string; from: string; to: string };
};

function Chip({ pt, code, dim }: { pt: string; code: string | null; dim?: boolean }) {
  if (!code) return null;
  const c = PARAM_COLOR[pt] ?? "#888";
  return (
    <span style={{ fontFamily: "monospace", fontSize: 11, fontWeight: 700, color: dim ? "#555" : c, padding: "2px 6px", borderRadius: 5, background: `${c}${dim ? "0A" : "1A"}`, border: `1px solid ${c}${dim ? "20" : "40"}`, textDecoration: dim ? "line-through" : "none" }}>{code}</span>
  );
}

function CreativeNode({ data }: { data: NodeData }) {
  const k = KIND[data.kind];
  const c = data.codes;
  return (
    <div style={{ minWidth: 190, background: "#10111A", border: `1.5px solid ${k.c}`, borderRadius: 12, padding: "10px 12px", boxShadow: `0 0 0 1px ${k.c}22` }}>
      <Handle type="target" position={Position.Left} style={{ background: k.c, border: "none", width: 7, height: 7 }} />
      <Handle type="source" position={Position.Right} style={{ background: k.c, border: "none", width: 7, height: 7 }} />
      <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: 1, color: k.c, marginBottom: 3 }}>{k.t}</div>
      <div title={data.adName} style={{ fontSize: 11, fontWeight: 600, color: "#E2E0DB", fontFamily: "monospace", marginBottom: 8, maxWidth: 210, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{data.adName}</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
        <Chip pt="persona" code={c.persona} />
        <Chip pt="hook" code={c.hook} />
        <Chip pt="body" code={c.body} />
        <Chip pt="angle" code={c.angle} />
      </div>
      {data.changed && (
        <div style={{ fontSize: 10, color: "#C490D1", marginBottom: 6 }}>
          сменили {data.changed.param}: <Chip pt={data.changed.param} code={data.changed.from} dim /> → <Chip pt={data.changed.param} code={data.changed.to} /> <span style={{ color: "#6EC8A0" }}>HELPS</span>
        </div>
      )}
      {data.metrics && (
        <div style={{ display: "flex", gap: 10, fontSize: 10, color: "#999" }}>
          <span>CPL <b style={{ color: cplColor(data.metrics.cpl) }}>{eur(data.metrics.cpl)}</b></span>
          <span>CPQL <b style={{ color: cplColor(data.metrics.cpql) }}>{eur(data.metrics.cpql)}</b></span>
          <span>лиды <b style={{ color: "#BBB" }}>{data.metrics.leads}</b></span>
        </div>
      )}
    </div>
  );
}

const nodeTypes = { creative: CreativeNode };

export default function LineageGraph() {
  const [data, setData] = useState<GraphData | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    fetch("/api/analytics/lineage-graph")
      .then(r => r.json())
      .then(d => d.ok ? setData(d) : setErr(d.error ?? "Ошибка"))
      .catch(e => setErr(String(e)));
  }, []);

  const { nodes, edges } = useMemo<{ nodes: Node[]; edges: Edge[] }>(() => {
    if (!data) return { nodes: [], edges: [] };
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const WY = 60, GAP = 175, COL_W = 600;

    data.winners.forEach((w, i) => {
      nodes.push({
        id: `w${i}`, type: "creative", position: { x: 0, y: WY + i * GAP },
        data: { kind: "winner", adName: w.adName, codes: w.codes, metrics: { cpl: w.cpl, cpql: w.cpql, leads: w.leads } } as NodeData,
      });
    });

    data.proposals.forEach((p, idx) => {
      const id = `p${idx}`;
      nodes.push({
        id, type: "creative", position: { x: COL_W, y: WY + p.fromWinner * GAP },
        data: { kind: "proposal", adName: p.adName, codes: p.codes, changed: { param: p.changedParam, from: p.oldCode, to: p.newCode } } as NodeData,
      });
      edges.push({
        id: `e-w${p.fromWinner}-${id}`, source: `w${p.fromWinner}`, target: id,
        animated: true, label: "наследует P·H·B·A", style: { stroke: "#6EC8A0", strokeWidth: 2 },
        labelStyle: { fill: "#6EC8A0", fontSize: 10 }, labelBgStyle: { fill: "#10111A" },
      });
    });

    // Лузеры — отдельной колонкой слева (без связей: их много, спагетти ни к чему).
    // Это «не повторять»-контекст; HURTS-коды видно по чипам.
    data.losers.forEach((l, j) => {
      nodes.push({
        id: `l${j}`, type: "creative", position: { x: -400, y: WY + j * GAP },
        data: { kind: "loser", adName: l.adName, codes: l.codes, metrics: { cpl: l.cpl, cpql: l.cpql, leads: l.leads } } as NodeData,
      });
    });

    return { nodes, edges };
  }, [data]);

  if (err) return <div style={{ color: "#D96B6B", fontSize: 13, padding: 20 }}>{err}</div>;
  if (!data) return <div style={{ color: "#666", fontSize: 13, padding: 20 }}>Загрузка схемы…</div>;
  if (!data.hasData) return <div style={{ color: "#666", fontSize: 13, padding: 20 }}>Нет виннеров для схемы. Появятся, когда объявления наберут данные (CPL ≤ цель + ≥ порог показов).</div>;

  return (
    <div style={{ height: 600, width: "100%", borderRadius: 12, overflow: "hidden", border: "1px solid rgba(255,255,255,0.07)" }}>
      <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView fitViewOptions={{ padding: 0.15 }} minZoom={0.3} proOptions={{ hideAttribution: true }}>
        <Background color="#222" gap={20} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
