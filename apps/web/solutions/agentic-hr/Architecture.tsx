'use client';

import 'reactflow/dist/style.css';
import ReactFlow, { Background, Controls, MarkerType, type Edge, type Node } from 'reactflow';

const nodes: Node[] = [
  { id: 'u', position: { x: 0, y: 120 }, data: { label: 'User /chat' }, type: 'input' },
  { id: 'g', position: { x: 200, y: 120 }, data: { label: 'LangGraph\norchestrator' }, style: nodeStyle('#7c3aed') },
  { id: 'rag', position: { x: 460, y: 0 }, data: { label: 'RAG node\n(pgvector)' }, style: nodeStyle('#0e7490') },
  { id: 'tool', position: { x: 460, y: 120 }, data: { label: 'Tool router' }, style: nodeStyle('#16a34a') },
  { id: 'gr', position: { x: 460, y: 240 }, data: { label: 'Guardrails' }, style: nodeStyle('#dc2626') },
  { id: 'noco', position: { x: 720, y: 60 }, data: { label: 'NocoDB' }, style: nodeStyle('#475569') },
  { id: 'gitea', position: { x: 720, y: 140 }, data: { label: 'Gitea' }, style: nodeStyle('#475569') },
  { id: 'mm', position: { x: 720, y: 220 }, data: { label: 'Mattermost' }, style: nodeStyle('#475569') },
  { id: 'app', position: { x: 460, y: 360 }, data: { label: 'Approval queue' }, style: nodeStyle('#f59e0b') },
  { id: 'out', position: { x: 980, y: 120 }, data: { label: 'Reply' }, type: 'output' },
];

const edges: Edge[] = [
  edge('u', 'g'),
  edge('g', 'rag'),
  edge('g', 'tool'),
  edge('g', 'gr'),
  edge('tool', 'noco'),
  edge('tool', 'gitea'),
  edge('tool', 'mm'),
  edge('tool', 'app', 'destructive'),
  edge('app', 'tool', 'approved'),
  edge('rag', 'out'),
  edge('tool', 'out'),
];

function edge(source: string, target: string, label?: string): Edge {
  return {
    id: `${source}-${target}-${label ?? ''}`,
    source,
    target,
    label,
    labelStyle: { fill: '#94a3b8', fontSize: 10 },
    markerEnd: { type: MarkerType.ArrowClosed },
    style: { stroke: '#64748b' },
  };
}

function nodeStyle(color: string): React.CSSProperties {
  return {
    background: 'hsl(217 33% 12%)',
    color: 'white',
    border: `1px solid ${color}`,
    borderRadius: 8,
    padding: 8,
    fontSize: 12,
    whiteSpace: 'pre-wrap',
    width: 160,
    textAlign: 'center',
  };
}

export default function Architecture() {
  return (
    <div className="h-[520px] rounded-xl border border-border bg-muted/20">
      <ReactFlow nodes={nodes} edges={edges} fitView nodesDraggable={false} proOptions={{ hideAttribution: true }}>
        <Background gap={16} color="hsl(217 33% 17%)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
