import { useCallback, useMemo, useRef } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeChange,
  type Node,
  type NodeChange,
  type OnEdgesChange,
  type OnNodesChange,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";

import {
  NODE_CATALOG,
  genEdgeId,
  genNodeId,
  type NodeKindMeta,
  type PlaybookCanvas as CanvasShape,
  type PlaybookNode as PbNode,
  type PlaybookNodeKind,
} from "@/lib/playbookSchema";
import PlaybookNode from "./PlaybookNode";

interface Props {
  canvas: CanvasShape;
  onChange: (next: CanvasShape) => void;
  onSelectNode: (nodeId: string | null) => void;
  selectedNodeId: string | null;
}

const NODE_TYPES = Object.fromEntries(NODE_CATALOG.map((m) => [m.kind, PlaybookNode]));

export default function PlaybookCanvasWrapper(props: Props) {
  return (
    <ReactFlowProvider>
      <InnerCanvas {...props} />
    </ReactFlowProvider>
  );
}

function InnerCanvas({ canvas, onChange, onSelectNode, selectedNodeId }: Props) {
  const flowRef = useRef<HTMLDivElement>(null);
  const { screenToFlowPosition } = useReactFlow();

  // Map canvas → @xyflow types (são compatíveis estruturalmente, só rotular)
  const nodes: Node[] = useMemo(
    () =>
      canvas.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: n.position,
        data: n.data,
        selected: n.id === selectedNodeId,
      })),
    [canvas.nodes, selectedNodeId],
  );

  const edges: Edge[] = useMemo(
    () =>
      canvas.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle || undefined,
        type: "smoothstep",
        animated: false,
        style: { stroke: "#94a3b8", strokeWidth: 2 },
      })),
    [canvas.edges],
  );

  const onNodesChange: OnNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const updated = applyNodeChanges(changes, nodes);
      onChange({
        ...canvas,
        nodes: updated.map((n) => ({
          id: n.id,
          type: n.type as PlaybookNodeKind,
          position: n.position,
          data: (n.data as Record<string, unknown>) || {},
        })),
      });
    },
    [canvas, nodes, onChange],
  );

  const onEdgesChange: OnEdgesChange = useCallback(
    (changes: EdgeChange[]) => {
      const updated = applyEdgeChanges(changes, edges);
      onChange({
        ...canvas,
        edges: updated.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle,
        })),
      });
    },
    [canvas, edges, onChange],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      const newEdge: Edge = {
        ...connection,
        id: genEdgeId(),
        source: connection.source!,
        target: connection.target!,
        type: "smoothstep",
        style: { stroke: "#94a3b8", strokeWidth: 2 },
      };
      const updated = addEdge(newEdge, edges);
      onChange({
        ...canvas,
        edges: updated.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle,
        })),
      });
    },
    [canvas, edges, onChange],
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const raw = event.dataTransfer.getData("application/tier-playbook-node");
      if (!raw) return;
      let meta: NodeKindMeta;
      try {
        meta = JSON.parse(raw);
      } catch {
        return;
      }
      const position = screenToFlowPosition({
        x: event.clientX,
        y: event.clientY,
      });
      const newNode: PbNode = {
        id: genNodeId(),
        type: meta.kind,
        position,
        data: { ...(meta.defaultData || {}) },
      };
      onChange({
        ...canvas,
        nodes: [...canvas.nodes, newNode],
      });
    },
    [canvas, onChange, screenToFlowPosition],
  );

  return (
    <div ref={flowRef} className="w-full h-full" onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        onPaneClick={() => onSelectNode(null)}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={{ type: "smoothstep", style: { stroke: "#94a3b8", strokeWidth: 2 } }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="#cbd5e1" />
        <Controls
          position="bottom-right"
          showInteractive={false}
          className="!shadow-[0_0_0_1px_rgb(226,232,240),0_4px_12px_-4px_rgba(15,23,42,0.08)] !rounded-lg !overflow-hidden"
          style={{ background: "white" }}
        />
        <MiniMap
          position="bottom-left"
          pannable
          zoomable
          nodeColor={(n) => {
            const meta = NODE_CATALOG.find((m) => m.kind === n.type);
            return meta?.color || "#94a3b8";
          }}
          nodeBorderRadius={8}
          maskColor="rgba(250, 251, 253, 0.7)"
          className="!shadow-[0_0_0_1px_rgb(226,232,240),0_4px_12px_-4px_rgba(15,23,42,0.08)] !rounded-lg !overflow-hidden"
          style={{ background: "white" }}
        />
      </ReactFlow>
    </div>
  );
}
