'use client';

import 'reactflow/dist/style.css';
import ReactFlow, { Background, Controls, MarkerType, type Edge, type Node } from 'reactflow';

const nodes: Node[] = [
  { id: 'u', position: { x: 0, y: 80 }, data: { label: 'POST /generate' }, type: 'input' },
  { id: 'q', position: { x: 220, y: 80 }, data: { label: 'In-memory\njob store' }, style: nodeStyle('#f59e0b') },
  { id: 'crew', position: { x: 460, y: 80 }, data: { label: 'AuthorityCrew\n(CrewAI)' }, style: nodeStyle('#7c3aed') },
  { id: 'a1', position: { x: 720, y: 0 }, data: { label: 'Researcher' }, style: nodeStyle('#0e7490') },
  { id: 'a2', position: { x: 720, y: 80 }, data: { label: 'Strategist' }, style: nodeStyle('#0e7490') },
  { id: 'a3', position: { x: 720, y: 160 }, data: { label: 'Writer' }, style: nodeStyle('#0e7490') },
  { id: 't', position: { x: 980, y: 0 }, data: { label: 'Tavily web' }, style: nodeStyle('#475569') },
  { id: 'llm', position: { x: 980, y: 120 }, data: { label: 'LLM\n(OpenAI/Anthropic)' }, style: nodeStyle('#475569') },
  { id: 'poll', position: { x: 220, y: 200 }, data: { label: 'GET /jobs/{id}' }, style: nodeStyle('#16a34a') },
  { id: 'out', position: { x: 1240, y: 80 }, data: { label: 'Final post' }, type: 'output' },
];

const edges: Edge[] = [
  edge('u', 'q'),
  edge('q', 'crew'),
  edge('crew', 'a1'),
  edge('crew', 'a2'),
  edge('crew', 'a3'),
  edge('a1', 't'),
  edge('a2', 'llm'),
  edge('a3', 'llm'),
  edge('crew', 'out'),
  edge('poll', 'q'),
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
    width: 160,
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
