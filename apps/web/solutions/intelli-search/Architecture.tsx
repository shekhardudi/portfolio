'use client';

import 'reactflow/dist/style.css';
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  type Edge,
  type Node,
} from 'reactflow';

const nodes: Node[] = [
  { id: 'q', position: { x: 0, y: 80 }, data: { label: 'User query' }, type: 'input' },
  {
    id: 'cls',
    position: { x: 220, y: 80 },
    data: { label: 'Intent Classifier\n(GPT-4o-mini + Instructor)' },
    style: nodeStyle('#2563eb'),
  },
  {
    id: 'reg',
    position: { x: 480, y: 0 },
    data: { label: 'Regular\nBM25' },
    style: nodeStyle('#0e7490'),
  },
  {
    id: 'sem',
    position: { x: 480, y: 80 },
    data: { label: 'Semantic\nkNN (HNSW, 384-d)' },
    style: nodeStyle('#0e7490'),
  },
  {
    id: 'ag',
    position: { x: 480, y: 160 },
    data: { label: 'Agentic\nLangGraph re-rank' },
    style: nodeStyle('#0e7490'),
  },
  {
    id: 'os',
    position: { x: 740, y: 80 },
    data: { label: 'OpenSearch' },
    style: nodeStyle('#7c3aed'),
  },
  {
    id: 'rrf',
    position: { x: 980, y: 80 },
    data: { label: 'Reciprocal Rank\nFusion' },
    style: nodeStyle('#16a34a'),
  },
  {
    id: 'out',
    position: { x: 1240, y: 80 },
    data: { label: 'Ranked hits' },
    type: 'output',
  },
];

const edges: Edge[] = [
  edge('q', 'cls'),
  edge('cls', 'reg'),
  edge('cls', 'sem'),
  edge('cls', 'ag'),
  edge('reg', 'os'),
  edge('sem', 'os'),
  edge('ag', 'os'),
  edge('os', 'rrf'),
  edge('rrf', 'out'),
];

function edge(source: string, target: string): Edge {
  return {
    id: `${source}-${target}`,
    source,
    target,
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
    width: 180,
    textAlign: 'center',
  };
}

export default function Architecture() {
  return (
    <div className="h-[480px] rounded-xl border border-border bg-muted/20">
      <ReactFlow nodes={nodes} edges={edges} fitView nodesDraggable={false} proOptions={{ hideAttribution: true }}>
        <Background gap={16} color="hsl(217 33% 17%)" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
