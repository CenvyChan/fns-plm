import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Modeler from "bpmn-js/lib/Modeler";
import type { AuthUser } from "./api";
import FormVersionPanel from "./FormVersionPanel";
import CustomProcessStartPanel, { engineLabel } from "./CustomProcessStartPanel";
import { approvalTemplate, type TemplateKind } from "./bpmnTemplates";
import { apiFetch } from "./api";
import flowableDescriptor from "./flowable-minimal-moddle.json";
import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-js.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn.css";
import "./bpmn-modeler.css";

export type NodeType = "startEvent" | "endEvent" | "userTask" | "exclusiveGateway" | "parallelGateway";
export type Node = {
  id: string;
  type: NodeType;
  name: string;
  formBinding?: { formKey: string; formVersion: number };
  assignment?: {
    kind: "assignee" | "candidateUsers" | "candidateRole";
    userIds?: string[];
    role?: string;
  };
  x?: number;
  y?: number;
};
export type Flow = {
  id: string;
  source: string;
  target: string;
  name?: string;
  condition?: "approved" | "rejected";
  isDefault?: boolean;
};
export type Graph = { key: string; name: string; nodes: Node[]; flows: Flow[] };
type Model = {
  id: string;
  key: string;
  name: string;
  revision: number;
  graph?: Graph;
  updatedAt?: string;
  publishedVersion?: number;
};
type Options = {
  users: { id: string; email: string; displayName: string }[];
  roles: string[];
};
type Version = { version: number; createdAt?: string; sha256?: string };
type FormItem = { key: string; name: string; revision: number; latestVersion: number };
type FormHistory = { publications: any[]; audit: any[] };
const roles = ["admin", "plm_manager", "reviewer", "member"];
export const emptyGraph = (key = "uiApproval", name = "新审批流程"): Graph => ({
  key,
  name,
  nodes: [
    { id: "start", type: "startEvent", name: "开始", x: 120, y: 180 },
    {
      id: "review",
      type: "userTask",
      name: "审批",
      assignment: { kind: "assignee", userIds: [] },
      x: 340,
      y: 180,
    },
    { id: "end", type: "endEvent", name: "结束", x: 600, y: 180 },
  ],
  flows: [
    { id: "flow1", source: "start", target: "review" },
    { id: "flow2", source: "review", target: "end" },
  ],
});
const xmlEscape = (v: string) =>
  v.replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c]!,
  );
export function graphXml(g: Graph) {
  const nodes = g.nodes
    .map((n) => {
      const assignment = n.assignment;
      const form = n.formBinding;
      const attr =
        assignment?.kind === "assignee" || assignment?.kind === "candidateUsers"
          ? ` flowable:${assignment.kind}="${xmlEscape((assignment.userIds || []).join(","))}"`
          : "";
      const formAttr = form ? ` flowable:formKey="${xmlEscape(`plm-form:${form.formKey}:v${form.formVersion}`)}"` : "";
      return `<bpmn:${n.type} id="${xmlEscape(n.id)}" name="${xmlEscape(n.name)}"${attr}${formAttr}/>`;
    })
    .join("");
  const flows = g.flows
    .map(
      (f) =>
        `<bpmn:sequenceFlow id="${xmlEscape(f.id)}" sourceRef="${xmlEscape(f.source)}" targetRef="${xmlEscape(f.target)}"${f.name ? ` name="${xmlEscape(f.name)}"` : f.condition ? ` name="${f.condition}"` : ""}/>`,
    )
    .join("");
  const edges = g.flows
    .map((f) => {
      const a = g.nodes.find((n) => n.id === f.source),
        b = g.nodes.find((n) => n.id === f.target);
      const aw =
          a?.type === "userTask"
            ? 100
            : a?.type === "exclusiveGateway"
              ? 50
              : 36,
        bw =
          b?.type === "userTask"
            ? 100
            : (b?.type === "exclusiveGateway" || b?.type === "parallelGateway")
              ? 50
              : 36,
        ah = a?.type === "userTask" ? 80 : 36,
        bh = b?.type === "userTask" ? 80 : 36,
        ax = (a?.x ?? 120) + aw / 2,
        ay = (a?.y ?? 180) + ah / 2,
        bx = (b?.x ?? 300) + bw / 2,
        by = (b?.y ?? 180) + bh / 2;
      return `<bpmndi:BPMNEdge id="di_${xmlEscape(f.id)}" bpmnElement="${xmlEscape(f.id)}"><di:waypoint x="${ax + aw / 2}" y="${ay}"/><di:waypoint x="${bx - bw / 2}" y="${by}"/></bpmndi:BPMNEdge>`;
    })
    .join("");
  const shapes = g.nodes
    .map(
      (n) =>
        `<bpmndi:BPMNShape id="di_${xmlEscape(n.id)}" bpmnElement="${xmlEscape(n.id)}"><dc:Bounds x="${n.x ?? 120}" y="${n.y ?? 180}" width="${n.type === "userTask" ? 100 : n.type === "exclusiveGateway" || n.type === "parallelGateway" ? 50 : 36}" height="${n.type === "userTask" ? 80 : n.type === "exclusiveGateway" || n.type === "parallelGateway" ? 50 : 36}"/></bpmndi:BPMNShape>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:flowable="http://flowable.org/bpmn" xmlns:moddle="http://bpmn.io/schema/bpmn" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn"><bpmn:process id="${xmlEscape(g.key)}" name="${xmlEscape(g.name)}" isExecutable="true">${nodes}${flows}</bpmn:process><bpmndi:BPMNDiagram id="Diagram_1"><bpmndi:BPMNPlane id="Plane_1" bpmnElement="${xmlEscape(g.key)}">${shapes}${edges}</bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`;
}
function changeSummary(value: any, kind: string, graph: Graph): string {
  if (!value) return "无";
  if (kind === "node") {
    const roleNames: Record<string,string> = {admin:"管理员",plm_manager:"PLM 管理员",reviewer:"审批人",member:"成员"};
    const assignment = value.assignment?.kind === "candidateRole" ? ` · 角色：${roleNames[value.assignment.role] || value.assignment.role}` : value.assignment ? ` · ${value.assignment.kind === "candidateUsers" ? "候选用户" : "指定用户"} ${(value.assignment.userIds || []).length} 人` : "";
    return `${value.name || value.id} · ${value.type}${assignment}${value.formBinding ? ` · 表单 ${value.formBinding.formKey} v${value.formBinding.formVersion}` : ""}`;
  }
  if (kind === "flow") return `${graph.nodes.find(n=>n.id===value.source)?.name || value.source} → ${graph.nodes.find(n=>n.id===value.target)?.name || value.target}${value.isDefault ? " · 默认路径" : value.condition === "approved" ? " · 审批通过" : value.condition === "rejected" ? " · 审批驳回" : " · 无条件"}`;
  if (typeof value === "object") return `${value.name || ""} ${value.key || ""}`.trim() || "属性更新";
  return String(value);
}
async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await apiFetch(url, init);
  if (!r.ok) {
    let msg = `HTTP ${r.status}`;
    try {
      const d = await r.json();
      msg = d.message || d.error || msg;
      if (Array.isArray(d.errors) && d.errors.length) {
        const details = d.errors
          .map((item: any) =>
            typeof item === "string"
              ? item
              : item.message || JSON.stringify(item),
          )
          .join("；");
        msg = `${msg}（${details}）`;
      }
      if (r.status === 423) msg = `发布被安全策略阻止（423）：${msg}`;
    } catch {}
    throw new Error(msg);
  }
  return r.json() as Promise<T>;
}
export default function BpmnModelerWorkbench({
  currentUser,
}: {
  currentUser?: AuthUser;
}) {
  const host = useRef<HTMLDivElement>(null),
    modeler = useRef<Modeler | null>(null),
    syncing = useRef(false),
    importSequence = useRef(0),
    savedGraph = useRef("");
  const [items, setItems] = useState<Model[]>([]),
    [modelId, setModelId] = useState(""),
    [graph, setGraph] = useState<Graph>(emptyGraph()),
    [revision, setRevision] = useState(0),
    [options, setOptions] = useState<Options>({ users: [], roles }),
    [versions, setVersions] = useState<Version[]>([]),
    [selectedNode, setSelectedNode] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [validation, setValidation] = useState<any>(null),
    [preview, setPreview] = useState<any>(null),
    [chosenVersion, setChosenVersion] = useState(0),
    [confirm, setConfirm] = useState(false),
    [panel, setPanel] = useState("画布"),
    [modelQuery, setModelQuery] = useState(""),
    [selectedFlow, setSelectedFlow] = useState(""),
    [forms, setForms] = useState<FormItem[]>([]),
    [formVersions, setFormVersions] = useState<Record<string, number[]>>({}),
    [history, setHistory] = useState<FormHistory>({ publications: [], audit: [] }),
    [focusMode, setFocusMode] = useState(false),
    [templateKind, setTemplateKind] = useState<TemplateKind>("serial"),
    [startRefresh, setStartRefresh] = useState(0);
  const admin = currentUser?.role === "admin";
  const selectedElementRef = useRef("");
  selectedElementRef.current = selectedFlow || selectedNode;
  const refresh = useCallback(async () => {
    try {
      const [list, opt] = await Promise.all([
        json<Model[]>("/api/bpmn-models"),
        json<Options>("/api/bpmn-modeler/options"),
      ]);
      setItems(list);
      setOptions({ ...opt, roles: opt.roles?.length ? opt.roles : roles });
      try { const data = await json<{forms:FormItem[]}>("/api/forms"); setForms(data.forms || []); } catch { setForms([]); }
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取流程模型失败");
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (!host.current) return;
    const m = new Modeler({
      container: host.current,
      moddleExtensions: { flowable: flowableDescriptor },
      keyboard: { bindTo: null },
    } as any);
    modeler.current = m;
    const rules = m.get("bpmnRules") as any;
    for (const action of ["shape.create", "connection.create", "shape.replace"])
      rules.addRule(action, 2000, () => false);
    for (const action of ["shape.delete", "connection.delete"])
      rules.addRule(action, 2000, () => false);
    rules.addRule("elements.move", 2000, () => Boolean(admin));
    const onSelect = (e: any) => {
      const el = e.newSelection?.find((x: any) =>
        [
          "bpmn:UserTask",
          "bpmn:StartEvent",
          "bpmn:EndEvent",
          "bpmn:ExclusiveGateway",
          "bpmn:ParallelGateway",
        ].includes(x.businessObject?.$type),
      );
      if (el) { setSelectedNode(el.id); setSelectedFlow(""); }
      const connection = e.newSelection?.find((x:any)=>x.businessObject?.$type === "bpmn:SequenceFlow");
      if (connection) { setSelectedFlow(connection.id); setPanel("属性"); }
    };
    const onCommand = () => {
      if (syncing.current) return;
      const registry = m.get("elementRegistry") as any;
      setGraph((current) => {
        let changed = false;
        const nodes = current.nodes.map((n) => {
          const shape = registry.get(n.id);
          if (!shape) return n;
          const x = shape.x,
            y = shape.y;
          if (
            (x !== n.x || y !== n.y) &&
            Number.isFinite(x) &&
            Number.isFinite(y)
          ) {
            changed = true;
            return { ...n, x, y };
          }
          return n;
        });
        if (changed) { setValidation(null); setPreview(null); setConfirm(false); }
        return changed ? { ...current, nodes } : current;
      });
    };
    m.on("selection.changed", onSelect);
    m.on("commandStack.changed", onCommand);
    return () => {
      m.off("selection.changed", onSelect);
      m.off("commandStack.changed", onCommand);
      void m.destroy();
      modeler.current = null;
    };
  }, [Boolean(modelId), admin]);
  const importQueue = useRef<Promise<void>>(Promise.resolve());
  const loadGraph = useCallback((g: Graph) => {
    const sequence = ++importSequence.current;
    syncing.current = true;
    importQueue.current = importQueue.current
      .catch(() => {})
      .then(async () => {
        if (sequence !== importSequence.current || !modeler.current) return;
        const instance = modeler.current;
        try {
          await (instance as any).importXML(graphXml(g));
          if (sequence === importSequence.current && modeler.current === instance) {
            const canvas = instance.get("canvas") as any;
            canvas.zoom("fit-viewport");
            const box = canvas.viewbox();
            canvas.viewbox({x:box.x-35,y:box.y-35,width:box.width+70,height:box.height+70});
            const element = (instance.get("elementRegistry") as any).get(selectedElementRef.current);
            if (element) (instance.get("selection") as any).select(element);
          }
        } catch (e) {
          if (sequence === importSequence.current)
            setError(`图形渲染失败：${String(e)}`);
        } finally {
          if (sequence === importSequence.current) syncing.current = false;
        }
      });
    return importQueue.current;
  }, []);
  const selected = modelId ? (graph.nodes.find((n) => n.id === selectedNode) ||
    graph.nodes.find((n) => n.type === "userTask")) : undefined;
  const changeNode = (patch: Partial<Node>) => {
    if (!admin || !selected) return;
    setPreview(null);
    setConfirm(false);
    const next = {
      ...graph,
      nodes: graph.nodes.map((n) =>
        n.id === selected.id ? { ...n, ...patch } : n,
      ),
    };
    setGraph(next);
  };
  useEffect(() => {
    if (JSON.stringify(graph) !== savedGraph.current) {
      setValidation(null);
      setPreview(null);
      setConfirm(false);
    }
    if (modeler.current) void loadGraph(graph);
  }, [graph, loadGraph, modelId]);
  const addNode = (type: NodeType) => {
    if (!admin || busy) return;
    const id = `${type}_${Math.random().toString(36).slice(2, 7)}`,
      n: Node = {
        id,
        type,
        name:
          type === "userTask"
            ? "新审批"
            : type === "startEvent"
              ? "开始"
              : type === "endEvent"
                ? "结束"
                : "条件分支",
        x: 160 + graph.nodes.length * 120,
        y: 180,
        ...(type === "userTask"
          ? {
              assignment: {
                kind: "assignee" as const,
                userIds: [currentUser?.id || ""],
              },
            }
          : {}),
      };
    setPreview(null);
    setConfirm(false);
    const outgoing = selected ? graph.flows.find((f) => f.source === selected.id) : undefined;
    const nextFlows = outgoing && type === "userTask"
      ? [...graph.flows.filter((f) => f.id !== outgoing.id), { ...outgoing, source: id }, { id: `flow_${Math.random().toString(36).slice(2, 7)}`, source: selected!.id, target: id }]
      : selected ? [...graph.flows, { id: `flow_${Math.random().toString(36).slice(2, 7)}`, source: selected.id, target: id }] : graph.flows;
    const downstream = new Set<string>();
    if (outgoing && type === "userTask") {
      const queue = [outgoing.target];
      while (queue.length) { const id = queue.pop()!; if(downstream.has(id)) continue; downstream.add(id); queue.push(...graph.flows.filter(f=>f.source===id).map(f=>f.target)); }
      n.x = (selected?.x ?? 340) + 180; n.y = selected?.y ?? 180;
    }
    setGraph({ ...graph, nodes: [...graph.nodes.map(node=>downstream.has(node.id)?{...node,x:(node.x??600)+180}:node), n], flows: nextFlows });
    setSelectedNode(id);
  };
  const addFlow = () => {
    if (!admin || busy || !modelId) return;
    const source = selected || graph.nodes[0];
    if (!source || source.type === "endEvent") { setError("结束事件不能添加出线，请先选择其他节点。"); return; }
    const outgoing = graph.flows.filter(f=>f.source === source.id);
    if (!["exclusiveGateway","parallelGateway"].includes(source.type) && outgoing.length) { setError("该节点已有出线。请先删除或编辑现有连线；分支请使用网关。"); return; }
    const candidates = graph.nodes.filter(n=>n.id!==source.id && n.type!=="startEvent" && !outgoing.some(f=>f.target===n.id));
    candidates.sort((a,b)=>{ const dx=(a.x??0)-(source.x??0),dy=(b.x??0)-(source.x??0);return (dx>0?dx:10000+Math.abs(dx))-(dy>0?dy:10000+Math.abs(dy)); });
    const target = candidates[0];
    if (!target) { setError("没有可连接的目标节点，请先添加节点。"); return; }
    const id = `flow_${Math.random().toString(36).slice(2,7)}`;
    setGraph({...graph,flows:[...graph.flows,{id,source:source.id,target:target.id}]});
    setSelectedFlow(id);setValidation(null);setPreview(null);setConfirm(false);setPanel("属性");setError("");
  };
  const create = async () => {
    if (!admin || busy) return;
    if (modelId && JSON.stringify(graph) !== savedGraph.current && !window.confirm("当前草稿尚未保存，新建将丢弃改动。继续？")) return;
    setBusy(true);
    setError("");
    try {
      const firstAvailableKey = items.some((item) => item.key === "uiApproval")
        ? `uiApproval_${Date.now()}`
        : "uiApproval";
      const g = approvalTemplate(templateKind, firstAvailableKey, currentUser?.id || "");
      g.nodes = g.nodes.map((n) =>
        n.type === "userTask"
          ? {
              ...n,
              assignment: {
                kind: "assignee",
                userIds: [currentUser?.id || ""],
              },
            }
          : n,
      );
      const m = await json<Model>("/api/bpmn-models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ graph: g }),
      });
      setModelId(m.id);
      setRevision(m.revision);
      setGraph(m.graph || g);
      savedGraph.current = JSON.stringify(m.graph || g);
      setVersions([]);
      setHistory({publications:[],audit:[]});
      setSelectedNode(g.nodes.find(n=>n.type === "userTask")?.id || "");
      setSelectedFlow("");
      setPanel("画布");
      setValidation(null);
      setPreview(null);
      setConfirm(false);
      setChosenVersion(0);
      await refresh();
      setNotice("已创建并保存草稿");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const load = async (id: string) => {
    if (busy || id === modelId) return;
    if (JSON.stringify(graph) !== savedGraph.current && modelId && !window.confirm("当前草稿尚未保存，切换将丢弃改动。继续？")) return;
    setBusy(true);
    const requestedId = id;
    setValidation(null);
    setPreview(null);
    setConfirm(false);
    setChosenVersion(0);
    setNotice("");
    setError("");
    try {
      const m = await json<Model>(`/api/bpmn-models/${encodeURIComponent(id)}`);
      if (requestedId !== id) return;
      setModelId(id);
      setSelectedNode(m.graph?.nodes.find(n=>n.type === "userTask")?.id || "");
      setSelectedFlow("");
      setPanel("画布");
      setGraph(m.graph || emptyGraph(m.key, m.name));
      savedGraph.current = JSON.stringify(m.graph || emptyGraph(m.key, m.name));
      setRevision(m.revision);
      setValidation(null);
      setPreview(null);
      const v = await json<Version[]>(
        `/api/bpmn-models/${encodeURIComponent(id)}/versions`,
      );
      setVersions(v);
      try { setHistory(await json<FormHistory>(`/api/bpmn-models/${encodeURIComponent(id)}/history`)); } catch { setHistory({ publications: [], audit: [] }); }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const save = async () => {
    if (!modelId) return;
    setPreview(null);
    setConfirm(false);
    setBusy(true);
    setError("");
    try {
      const m = await json<Model>(
        `/api/bpmn-models/${encodeURIComponent(modelId)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ expectedRevision: revision, graph }),
        },
      );
      setRevision(m.revision);
      savedGraph.current = JSON.stringify(graph);
      setNotice(`草稿已保存（修订 ${m.revision}）`);
      await refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const act = async (path: string, body?: any) => {
    if (!modelId) return null;
    setBusy(true);
    setError("");
    try {
      return await json<any>(
        `/api/bpmn-models/${encodeURIComponent(modelId)}/${path}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body || {}),
        },
      );
    } catch (e) {
      setError(String(e));
      return null;
    } finally {
      setBusy(false);
    }
  };
  const validate = async () => {
    if (JSON.stringify(graph) !== savedGraph.current) {
      setError("请先保存当前改动，再校验草稿");
      return;
    }
    const v = await act("validate");
    if (v) {
      setValidation(v);
      setNotice(
        v.valid ? "模型校验通过" : `校验发现 ${v.errors?.length || 0} 项问题`,
      );
    }
  };
  const freeze = async () => {
    if (JSON.stringify(graph) !== savedGraph.current) {
      setError("请先保存当前改动，再冻结版本");
      return;
    }
    const v = await act("versions", { expectedRevision: revision });
    if (v) {
      setVersions([v, ...versions]);
      setChosenVersion(v.version);
      setPreview(null);
      setConfirm(false);
      setNotice(`已冻结不可变版本 v${v.version}`);
    }
  };
  const doPreview = async () => {
    if (!chosenVersion) return;
    const p = await act("preview", { version: chosenVersion });
    if (p) {
      setPreview(p);
      setConfirm(false);
      setNotice("预览已生成；请检查变更及安全阻断状态");
    }
  };
  const publish = async () => {
    if (!preview?.confirmationToken || !confirm) {
      setError("请先预览并明确勾选确认发布");
      return;
    }
    const r = await act("publish", {
      version: chosenVersion,
      confirmationToken: preview.confirmationToken,
      confirm: true,
    });
    if (r) {
      setNotice("发布请求已完成");
      setStartRefresh(value => value + 1);
      setPreview(null);
      setConfirm(false);
      await refresh();
      setHistory(await json<FormHistory>(`/api/bpmn-models/${encodeURIComponent(modelId)}/history`));
    }
  };
  const versionRows = useMemo(
    () =>
      versions.map((v) => (
        <option key={v.version} value={v.version}>
          v{v.version}
          {v.createdAt ? ` · ${new Date(v.createdAt).toLocaleString()}` : ""}
        </option>
      )),
    [versions],
  );
  const flow = graph.flows.find((f) => f.id === selectedFlow);
  const dirty = Boolean(modelId) && JSON.stringify(graph) !== savedGraph.current;
  const visibleItems = items.filter((m) => `${m.name} ${m.key}`.toLowerCase().includes(modelQuery.toLowerCase()));
  const types: { type: NodeType; label: string; symbol: string }[] = [
    { type: "startEvent", label: "开始", symbol: "◉" }, { type: "userTask", label: "用户任务", symbol: "▣" },
    { type: "exclusiveGateway", label: "排他网关", symbol: "◇" }, { type: "parallelGateway", label: "并行网关", symbol: "＋" }, { type: "endEvent", label: "结束", symbol: "◎" },
  ];
  return (
    <main data-panel={panel} className={`bpmn-page ${focusMode ? "focus-mode" : ""}`}>
      <header className="bpmn-head">
        <div className="bpmn-brand"><div className="bpmn-mark">PL</div><div><small>流程协同　/　设计工作区</small><h1>流程模型设计器</h1><p>{modelId ? `${graph.name}　·　${graph.key}　·　修订 r${revision}` : "创建或选择流程模型以开始设计"}</p></div></div>
        <div className="bpmn-actions"><button className="bpmn-button" onClick={()=>setPanel(panel === "表单" ? "画布" : "表单")}>表单管理</button><button className="bpmn-button focus-toggle" aria-label={focusMode ? "退出专注设计" : "进入专注设计"} onClick={()=>setFocusMode(!focusMode)}>{focusMode ? "退出专注" : "专注设计"}</button><span className={`bpmn-dirty ${dirty ? "is-dirty" : ""}`}>{dirty ? "未保存更改" : "已同步"}</span>
          <button className="bpmn-button" disabled={!admin || !modelId || busy || !dirty} onClick={() => void save()}>保存草稿</button>
          <button className="bpmn-button" disabled={!admin || !modelId || busy} onClick={() => void validate()}>校验</button>
          <button className="bpmn-button primary" disabled={!admin || !modelId || busy} onClick={() => void freeze()}>冻结版本</button>
          <select className="bpmn-template-select" aria-label="新建流程模板" value={templateKind} onChange={e=>setTemplateKind(e.target.value as TemplateKind)} disabled={!admin||busy}><option value="serial">串行审批模板</option><option value="exclusive">条件审批模板</option><option value="parallel">并行审批模板</option></select><button className="bpmn-button quiet" disabled={!admin || busy} onClick={() => void create()}>＋ 新建</button>
        </div>
      </header>
      {!admin && <div className="bpmn-alert">当前账户不是工作区管理员，模型设计与发布已禁用；PLM 管理员仍可按权限启动已发布自定义流程。</div>}
      {error && <div className="bpmn-alert" role="alert">{error}<button className="bpmn-button" disabled={busy} onClick={()=>{setError("");void refresh();}}>重新读取</button></div>}{notice && <div className="bpmn-notice" role="status">{notice}</div>}
      <CustomProcessStartPanel key={modelId} modelId={modelId} currentUser={currentUser} refreshKey={startRefresh} />
      <nav className="bpmn-mobile-nav" aria-label="工作区面板">{["模型", "画布", "属性", "发布", "表单"].map((x) => <button key={x} className={panel === x ? "active" : ""} onClick={() => setPanel(x)}>{x}</button>)}</nav>
      <div className={`bpmn-layout ${panel === "表单" ? "form-active" : ""}`}>
        <aside className={`bpmn-models ${panel === "模型" ? "mobile-active" : ""}`}>
          <div className="bpmn-section-title"><div><small>LIBRARY</small><h2>流程模型</h2></div><span className="bpmn-count">{items.length}</span></div>
          <label className="bpmn-search"><span>⌕</span><input aria-label="搜索模型" placeholder="搜索模型名称或 Key" value={modelQuery} onChange={(e) => setModelQuery(e.target.value)} /></label>
          <div className="bpmn-model-list">{visibleItems.map((m) => <button key={m.id} className={`bpmn-model-item ${modelId === m.id ? "active" : ""}`} disabled={busy} onClick={() => void load(m.id)}><span className="model-icon">⌘</span><span className="model-copy"><b>{m.name}</b><small>{m.key} · r{m.revision}{m.publishedVersion ? ` · 已发布 v${m.publishedVersion}` : " · 草稿"}</small></span><span className="model-arrow">›</span></button>)}
            {!visibleItems.length && <div className="bpmn-empty"><span>⌘</span><b>{items.length ? "没有匹配的模型" : "从一个空白模型开始"}</b><p>{items.length ? "试试其他名称或 Key" : "新建后可在画布中添加安全支持的 BPMN 元素。"}{!items.length && admin && <button className="text-button" onClick={() => void create()}>创建新模型 →</button>}</p></div>}</div>
          <div className="bpmn-model-foot">仅管理员可编辑　·　草稿保存在服务端</div>
        </aside>
        <section className={`bpmn-work ${panel === "画布" ? "mobile-active" : ""}`}>
          {!modelId ? <div className="bpmn-canvas-empty"><div className="empty-symbol">◇</div><h2>准备好构建流程</h2><p>选择左侧已有模型，或新建模型后在画布中添加节点。</p><small>不会加载示例流程 · 仅支持受控 BPMN 元素</small></div> : <>
          <div className="bpmn-model-fields"><label className="bpmn-field"><span>流程名称</span><input disabled={!admin || busy} value={graph.name} maxLength={120} onChange={(e) => { setValidation(null); setGraph({ ...graph, name: e.target.value }); }} /></label><label className="bpmn-field key-field"><span>流程 Key</span><input disabled={!admin || busy} value={graph.key} maxLength={64} onChange={(e) => { setValidation(null); setGraph({ ...graph, key: e.target.value }); }} /></label></div>
          <div className="bpmn-toolbar"><div className="tool-group">{types.map(({type,label,symbol}) => <button key={type} className="tool-button" title={`添加${label}`} onClick={() => addNode(type)} disabled={!admin || busy}><span>{symbol}</span>{label}</button>)}<i className="tool-divider"/><button className="tool-button" onClick={addFlow} disabled={!admin || busy}><span>⌁</span>添加连线</button></div><span className="toolbar-hint">受控元素范围 · 仅管理员可编辑</span></div>
          <div className="bpmn-canvas-wrap"><div ref={host} className="bpmn-canvas" aria-label="BPMN 图形画布" />{!graph.nodes.length && <div className="canvas-empty-overlay">添加第一个节点以开始流程设计</div>}</div>
          </>}
          <div className="bpmn-canvas-meta"><span><i/> BPMN 2.0</span><span>点选节点查看属性</span><span className="canvas-controls"><button title="缩小" onClick={() => (modeler.current?.get("canvas") as any)?.zoom((modeler.current?.get("canvas") as any).zoom() - .2)}>−</button><button title="适配画布" onClick={() => (modeler.current?.get("canvas") as any)?.zoom("fit-viewport")}>适配</button><button title="放大" onClick={() => (modeler.current?.get("canvas") as any)?.zoom((modeler.current?.get("canvas") as any).zoom() + .2)}>＋</button></span></div>
        </section>
        <aside className={`bpmn-inspector ${panel === "属性" ? "mobile-active" : ""}`}>
          <div className="bpmn-inspector-heading"><div><small>PROPERTIES</small><h2>属性</h2></div><button className="icon-button" title="删除选中节点" disabled={!admin || busy || !selected || graph.nodes.length <= 2} onClick={() => { if (!selected) return; setGraph({ ...graph, nodes: graph.nodes.filter(n => n.id !== selected.id), flows: graph.flows.filter(f => f.source !== selected.id && f.target !== selected.id) }); setSelectedNode(""); setValidation(null); }}>⌫</button></div>
          <label className="bpmn-node-picker"><span>选择节点</span><select aria-label="选择画布节点" value={selected?.id || ""} onChange={e=>{setSelectedNode(e.target.value);setSelectedFlow("");const el=(modeler.current?.get("elementRegistry") as any)?.get(e.target.value);if(el)(modeler.current?.get("selection") as any)?.select(el);}}><option value="">选择节点…</option>{(modelId ? graph.nodes : []).map(n=><option key={n.id} value={n.id}>{n.name} · {n.id}</option>)}</select></label><div className="bpmn-selection-chip">{selected ? <><span>{types.find(t=>t.type===selected.type)?.symbol}</span>{selected.type === "userTask" ? "用户任务" : selected.type === "startEvent" ? "开始事件" : selected.type === "endEvent" ? "结束事件" : selected.type === "parallelGateway" ? "并行网关" : "排他网关"}<code>{selected.id}</code></> : "未选择节点"}</div>
          {selected ? <div className="bpmn-property-fields"><label className="bpmn-field"><span>显示名称</span><input disabled={!admin || busy} value={selected.name} maxLength={120} onChange={(e) => changeNode({name:e.target.value})}/></label>
            {selected.type === "userTask" && <><label className="bpmn-field"><span>分配策略</span><select disabled={!admin || busy} value={selected.assignment?.kind || "assignee"} onChange={(e) => { const kind=e.target.value as "assignee"|"candidateUsers"|"candidateRole"; changeNode({assignment:kind==="candidateRole"?{kind,role:""}:{kind,userIds:[]}}); }}>{[["assignee","指定用户"],["candidateUsers","候选用户"],["candidateRole","工作区角色"]].map(([v,l])=><option key={v} value={v}>{l}</option>)}</select></label>
              {selected.assignment?.kind === "candidateRole" ? <label className="bpmn-field"><span>工作区角色</span><select disabled={!admin || busy} value={selected.assignment.role || ""} onChange={(e)=>changeNode({assignment:{...selected.assignment!,role:e.target.value}})}><option value="">选择角色</option>{(options.roles||roles).filter(r=>roles.includes(r)).map(r=><option key={r} value={r}>{({admin:"管理员",plm_manager:"PLM 管理员",reviewer:"审批人",member:"成员"} as any)[r]}</option>)}</select></label> : <label className="bpmn-field"><span>{selected.assignment?.kind === "assignee" ? "审批用户" : "候选用户"}</span><select disabled={!admin || busy} multiple={selected.assignment?.kind === "candidateUsers"} value={selected.assignment?.kind === "assignee" ? (selected.assignment?.userIds||[])[0]||"" : selected.assignment?.userIds||[]} onChange={(e)=>changeNode({assignment:{...selected.assignment!,userIds:selected.assignment?.kind === "assignee"?[e.currentTarget.value].filter(Boolean):Array.from(e.currentTarget.selectedOptions,o=>o.value)}})}>{options.users.map(u=><option key={u.id} value={u.id}>{u.displayName} · {u.email}</option>)}</select><small>仅保存 PLM 用户 ID，不暴露 Flowable 原始 ID。</small></label>}</>}
            {selected.type === "userTask" && <><div className="property-divider"/><div className="bpmn-flow-heading"><b>业务表单</b><span>固定版本</span></div><label className="bpmn-field"><span>绑定表单</span><select aria-label="绑定业务表单" disabled={!admin || busy} value={selected.formBinding?.formKey || ""} onChange={async e=>{const key=e.target.value;if(!key){changeNode({formBinding:undefined});return;}let vs=formVersions[key];if(!vs){try{const data=await json<{versions:{version:number}[]}>(`/api/forms/${encodeURIComponent(key)}/versions`);vs=data.versions.map(v=>v.version);setFormVersions({...formVersions,[key]:vs});}catch{vs=[];}}changeNode({formBinding:vs.length?{formKey:key,formVersion:vs[0]}:undefined});}}><option value="">不绑定表单</option>{forms.map(f=><option key={f.key} value={f.key}>{f.name} · {f.key}</option>)}</select></label>{selected.formBinding&&<label className="bpmn-field"><span>固定表单版本</span><select aria-label="固定表单版本" disabled={!admin||busy} value={selected.formBinding.formVersion} onFocus={async e=>{const key=selected.formBinding!.formKey;if(!formVersions[key])try{const data=await json<{versions:{version:number}[]}>(`/api/forms/${encodeURIComponent(key)}/versions`);setFormVersions({...formVersions,[key]:data.versions.map(v=>v.version)});}catch{}}} onChange={e=>changeNode({formBinding:{...selected.formBinding!,formVersion:Number(e.target.value)}})}>{(formVersions[selected.formBinding.formKey]||[selected.formBinding.formVersion]).map(v=><option key={v} value={v}>v{v}</option>)}</select></label>}</>}
            <div className="property-divider"/><div className="bpmn-flow-heading"><b>顺序流</b><button disabled={!admin || busy} onClick={addFlow}>＋ 添加</button></div>
            {graph.flows.filter(f=>f.source===selected.id||f.target===selected.id).map(f=><button key={f.id} className={`bpmn-flow-row ${selectedFlow===f.id?"active":""}`} onClick={()=>setSelectedFlow(f.id)}><span>{graph.nodes.find(n=>n.id===f.source)?.name||f.source}</span><b>→</b><span>{graph.nodes.find(n=>n.id===f.target)?.name||f.target}</span><small>{f.isDefault?"默认":f.condition||"无条件"}</small></button>)}
          </div> : <div className="bpmn-inspector-empty"><span>⌖</span><p>在画布中选择节点<br/>以查看和编辑属性</p></div>}
          {flow && <div className="bpmn-flow-editor"><b>连线条件</b><label className="bpmn-field"><span>起点</span><select disabled={!admin||busy} value={flow.source} onChange={e=>{setValidation(null);setGraph({...graph,flows:graph.flows.map(f=>f.id===flow.id?{...f,source:e.target.value}:f)});}}>{graph.nodes.map(n=><option key={n.id} value={n.id}>{n.name}</option>)}</select></label><label className="bpmn-field"><span>终点</span><select disabled={!admin||busy} value={flow.target} onChange={e=>{setValidation(null);setGraph({...graph,flows:graph.flows.map(f=>f.id===flow.id?{...f,target:e.target.value}:f)});}}>{graph.nodes.map(n=><option key={n.id} value={n.id}>{n.name}</option>)}</select></label><label className="bpmn-field"><span>路径类型</span><select disabled={!admin||busy} value={flow.isDefault?"default":flow.condition||""} onChange={e=>{setValidation(null);setGraph({...graph,flows:graph.flows.map(f=>f.id===flow.id?{...f,condition:!e.target.value||e.target.value==="default"?undefined:(e.target.value as any),isDefault:e.target.value==="default"}:f)});}}><option value="">无条件</option><option value="approved">审批通过（approved）</option><option value="rejected">审批驳回（rejected）</option><option value="default">默认路径</option></select></label><button className="danger-button" disabled={!admin||busy} onClick={()=>{setGraph({...graph,flows:graph.flows.filter(f=>f.id!==flow.id)});setSelectedFlow("");}}>删除连线</button></div>}
          <div className="bpmn-inspector-note">角色由 PLM 服务端映射用户，绝不等同于 Flowable Group。</div>
        </aside>
      </div>
      <section className={`bpmn-form-management ${panel === "表单" ? "active" : ""}`}><FormVersionPanel currentUser={currentUser} onVersionsChanged={()=>{setFormVersions({});void refresh();}}/></section>
      <section className={`bpmn-lifecycle ${panel === "发布" ? "mobile-active" : ""}`}><div className="lifecycle-head"><div><small>RELEASE CONTROL</small><h2>校验与发布</h2></div><span className="lifecycle-safe">受控发布</span></div>
        <div className="bpmn-version-controls"><button className="bpmn-button" onClick={()=>void validate()} disabled={!admin||!modelId||busy}>校验草稿</button><button className="bpmn-button" onClick={()=>void freeze()} disabled={!admin||!modelId||busy}>冻结不可变版本</button><select aria-label="选择版本" disabled={!admin||busy} value={chosenVersion||""} onChange={e=>{setChosenVersion(Number(e.target.value));setPreview(null);setConfirm(false);}}><option value="">选择已冻结版本</option>{versionRows}</select><button className="bpmn-button" onClick={()=>void doPreview()} disabled={!admin||!chosenVersion||busy}>预览差异</button></div>
        <div className="lifecycle-columns"><div className="lifecycle-card"><b>校验结果</b>{validation?<div className={validation.valid?"result-good":"result-bad"}>{validation.valid?"校验通过":"发现需处理的问题"}{(validation.errors||[]).map((x:any,i:number)=><p key={i}>{typeof x==="string"?x:x.message||JSON.stringify(x)}</p>)}</div>:<p>保存草稿后运行校验。结果会在此呈现。</p>}</div>
        <div className="lifecycle-card"><b>冻结版本 / 发布预览</b>{preview?<><p>版本 v{preview.version} · 基线 {preview.baselineVersion ? `v${preview.baselineVersion}` : "首次发布"} · {engineLabel(preview.engineMode)} · 变更摘要</p><div className="change-list">{(Array.isArray(preview.changes)?preview.changes:[]).length ? preview.changes.map((c:any,i:number)=><div key={i}><span>{({added:"新增",removed:"删除",changed:"修改"} as any)[c.change]||"变更"}</span><b>{c.name||c.key||c.id||"流程定义"}</b><small>{`${changeSummary(c.before,c.kind,graph)} → ${changeSummary(c.after,c.kind,graph)}`}</small></div>):<p>{typeof preview.changes==="string"?preview.changes:"已生成预览。服务端返回的变更内容如下："}</p>}</div>
          {(preview.blocked||preview.blockedReasons||preview.reasons)&&<div className="bpmn-alert">安全阻断：{Array.isArray(preview.blockedReasons||preview.reasons)?(preview.blockedReasons||preview.reasons).map((r:any)=>typeof r==="string"?r:r.message||JSON.stringify(r)).join("；"):String(preview.blockedReason||preview.blockedReasons||preview.reasons||preview.blocked)}。后端策略为最终控制。</div>}
          <label className="bpmn-confirm"><input type="checkbox" disabled={!admin||busy} checked={confirm} onChange={e=>setConfirm(e.target.checked)}/>我已审阅差异，并确认向上述服务端允许的引擎发布</label><button className="bpmn-button publish" disabled={!admin||!confirm||busy||!preview.confirmationToken} onClick={()=>void publish()}>确认发布</button></>:<p>选择一个冻结版本并预览差异。只有持有效预览令牌且明确确认后才可发起发布；安全策略可能返回 423 阻断。</p>}</div></div>
        <section className="history-panel"><b>发布历史与审计</b><button className="bpmn-button" disabled={!modelId||busy} onClick={async()=>{try{setHistory(await json<FormHistory>(`/api/bpmn-models/${encodeURIComponent(modelId)}/history`));}catch(e){setError(String(e));}}}>刷新历史</button>{history.publications.length ? history.publications.map((p:any,i:number)=><div key={i}><span>v{p.version}</span><b>{({published:"发布完成",uncertain:"结果不明确 · 禁止重试",deploying:"发布中"} as any)[p.status]||p.status}</b><small>{p.deploymentId||p.deployment_id} · {p.updatedAt||p.updated_at}</small></div>) : <p>尚无发布记录</p>}{history.audit.slice(0,12).map((a:any,i:number)=><div key={i}><span>{({create:"创建草稿",update:"保存草稿",version_created:"冻结版本",preview:"预览差异",publish_started:"发起发布",published:"发布完成"} as any)[a.event]||a.event}</span><small>{a.createdAt||a.created_at}</small></div>)}</section>
      </section>
      <footer className="bpmn-foot">支持开始/结束、用户任务、排他及受限并行网关、固定表单版本；并行分支不等同于多实例会签。工作区角色由服务端映射为账套隔离的候选组。发布和启动受服务端安全门禁控制：隔离测试模式不代表模拟引擎；已验证补丁的 Flowable 连接与测试模式分别标识。禁止导入外部 XML 或编辑源文本。Flowable 属性采用本项目自有最小 moddle 描述符。保留原生 bpmn.io 水印。当前用户：{currentUser?.displayName||"未知"}</footer>
    </main>
  );
}
