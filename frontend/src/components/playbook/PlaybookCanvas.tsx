import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
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

// ESTÁVEL — única instância, evita warning React Flow + re-render
const NODE_TYPES = Object.fromEntries(NODE_CATALOG.map((m) => [m.kind, PlaybookNode]));

const DEFAULT_EDGE_OPTS = {
  type: "smoothstep" as const,
  style: { stroke: "#94a3b8", strokeWidth: 2 },
};

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

  // ─── State INTERNO do React Flow (gerenciado pelos hooks oficiais)
  //     Drag/move atualiza só aqui → zero latência, sem re-render no parent
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);

  // Ref pra evitar loop sync: marca "ack" quando sincronizamos externo → interno
  const lastSyncedSig = useRef<string>("");
  // Ref pra ignorar mudanças durante drag (não comita até dragStop)
  const isDraggingRef = useRef(false);

  // ─── Sync EXTERNO → INTERNO
  //     Só ativa quando estrutura/data muda externamente (ex: drop novo nó, painel direito edita data,
  //     deleção via menu). Não dispara durante drag (porque o externo só atualiza em dragStop).
  useEffect(() => {
    const sig = JSON.stringify({
      n: canvas.nodes.map((n) => ({ id: n.id, type: n.type, data: n.data })),
      e: canvas.edges.map((e) => ({ id: e.id, s: e.source, t: e.target, h: e.sourceHandle })),
    });
    if (sig === lastSyncedSig.current) return;
    lastSyncedSig.current = sig;

    // Preserva posições do state interno se nó já existe (evita pular durante undo/redo)
    const positionsMap = new Map(nodes.map((n) => [n.id, n.position]));

    setNodes(
      canvas.nodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: positionsMap.get(n.id) || n.position,
        data: n.data,
      })),
    );
    setEdges(
      canvas.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle || undefined,
        ...DEFAULT_EDGE_OPTS,
      })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvas]);

  // ─── Aplica seleção visual (sem mexer em data/position — não comita)
  const nodesWithSelection = useMemo(
    () => nodes.map((n) => (n.selected !== (n.id === selectedNodeId) ? { ...n, selected: n.id === selectedNodeId } : n)),
    [nodes, selectedNodeId],
  );

  // ─── COMMIT pro parent (chamado só em eventos "finais")
  const commitToParent = useCallback(
    (nextNodes?: Node[], nextEdges?: Edge[]) => {
      const finalNodes = nextNodes ?? nodes;
      const finalEdges = nextEdges ?? edges;

      const out: CanvasShape = {
        version: canvas.version || 1,
        nodes: finalNodes.map((n) => ({
          id: n.id,
          type: n.type as PlaybookNodeKind,
          position: n.position,
          data: (n.data as Record<string, unknown>) || {},
        })),
        edges: finalEdges.map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          sourceHandle: e.sourceHandle,
        })),
      };
      // Marca como já sincronizado pra evitar bounce no useEffect
      lastSyncedSig.current = JSON.stringify({
        n: out.nodes.map((n) => ({ id: n.id, type: n.type, data: n.data })),
        e: out.edges.map((e) => ({ id: e.id, s: e.source, t: e.target, h: e.sourceHandle })),
      });
      onChange(out);
    },
    [canvas.version, edges, nodes, onChange],
  );

  // ─── Eventos do React Flow
  const onConnect = useCallback(
    (connection: Connection) => {
      const newEdge: Edge = {
        id: genEdgeId(),
        source: connection.source!,
        target: connection.target!,
        sourceHandle: connection.sourceHandle || undefined,
        ...DEFAULT_EDGE_OPTS,
      };
      const next = addEdge(newEdge, edges);
      setEdges(next);
      commitToParent(undefined, next);
    },
    [commitToParent, edges, setEdges],
  );

  // Drag: durante move só atualiza state interno (zero latência)
  // No dragStop, comita position pro parent
  const onNodeDragStart = useCallback(() => {
    isDraggingRef.current = true;
  }, []);

  const onNodeDragStop = useCallback(() => {
    isDraggingRef.current = false;
    commitToParent();
  }, [commitToParent]);

  // Deletes (Backspace/Delete key) — React Flow já remove do state interno via onNodesChange,
  // só precisamos comitar depois.
  const onNodesDelete = useCallback(() => {
    // Roda DEPOIS de onNodesChange aplicar a remoção — usa setTimeout pra pegar state atualizado
    setTimeout(commitToParent, 0);
  }, [commitToParent]);

  const onEdgesDelete = useCallback(() => {
    setTimeout(commitToParent, 0);
  }, [commitToParent]);

  // ─── Drag & drop da paleta
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
      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const newPbNode: PbNode = {
        id: genNodeId(),
        type: meta.kind,
        position,
        data: { ...(meta.defaultData || {}) },
      };
      // Cria diretamente no state interno + comita
      const newRfNode: Node = {
        id: newPbNode.id,
        type: newPbNode.type,
        position: newPbNode.position,
        data: newPbNode.data,
      };
      const nextNodes = [...nodes, newRfNode];
      setNodes(nextNodes);
      commitToParent(nextNodes, undefined);
    },
    [commitToParent, nodes, screenToFlowPosition, setNodes],
  );

  return (
    <div ref={flowRef} className="w-full h-full" onDragOver={onDragOver} onDrop={onDrop}>
      <ReactFlow
        nodes={nodesWithSelection}
        edges={edges}
        nodeTypes={NODE_TYPES}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        onNodeClick={(_, node) => onSelectNode(node.id)}
        onPaneClick={() => onSelectNode(null)}
        fitView
        fitViewOptions={{ padding: 0.25, maxZoom: 1 }}
        proOptions={{ hideAttribution: true }}
        defaultEdgeOptions={DEFAULT_EDGE_OPTS}
        nodeOrigin={[0, 0]}
        minZoom={0.2}
        maxZoom={2}
        snapToGrid={false}
        elevateNodesOnSelect
        nodesDraggable
        nodesConnectable
        elementsSelectable
        deleteKeyCode={["Delete", "Backspace"]}
        multiSelectionKeyCode={["Meta", "Control"]}
        selectionKeyCode={["Shift"]}
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
          nodeStrokeColor={(n) => {
            const meta = NODE_CATALOG.find((m) => m.kind === n.type);
            return meta?.color || "#64748b";
          }}
          nodeStrokeWidth={2}
          nodeBorderRadius={6}
          maskColor="rgba(250, 251, 253, 0.6)"
          className="!shadow-[0_0_0_1px_rgb(226,232,240)] !rounded-md !overflow-hidden opacity-50 hover:opacity-100 transition-opacity"
          style={{ background: "white", width: 140, height: 90 }}
        />
      </ReactFlow>
    </div>
  );
}
