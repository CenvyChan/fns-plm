import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Modeler from "bpmn-js/lib/Modeler";
import type { AuthUser } from "./api";
import { apiFetch } from "./api";
import flowableDescriptor from "./flowable-minimal-moddle.json";
import "bpmn-js/dist/assets/diagram-js.css";
import "bpmn-js/dist/assets/bpmn-js.css";
import "bpmn-js/dist/assets/bpmn-font/css/bpmn.css";
import "./bpmn-modeler.css";

type NodeType = "startEvent" | "endEvent" | "userTask" | "exclusiveGateway";
type Node = {
  id: string;
  type: NodeType;
  name: string;
  assignment?: {
    kind: "assignee" | "candidateUsers" | "candidateRole";
    userIds?: string[];
    role?: string;
  };
  x?: number;
  y?: number;
};
type Flow = {
  id: string;
  source: string;
  target: string;
  name?: string;
  condition?: "approved" | "rejected";
  isDefault?: boolean;
};
type Graph = { key: string; name: string; nodes: Node[]; flows: Flow[] };
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
const roles = ["admin", "plm_manager", "reviewer", "member"];
const emptyGraph = (key = "uiApproval", name = "新审批流程"): Graph => ({
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
function graphXml(g: Graph) {
  const nodes = g.nodes
    .map((n) => {
      const assignment = n.assignment;
      const attr =
        assignment?.kind === "assignee" || assignment?.kind === "candidateUsers"
          ? ` flowable:${assignment.kind}="${xmlEscape((assignment.userIds || []).join(","))}"`
          : "";
      return `<bpmn:${n.type} id="${xmlEscape(n.id)}" name="${xmlEscape(n.name)}"${attr}/>`;
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
            : b?.type === "exclusiveGateway"
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
        `<bpmndi:BPMNShape id="di_${xmlEscape(n.id)}" bpmnElement="${xmlEscape(n.id)}"><dc:Bounds x="${n.x ?? 120}" y="${n.y ?? 180}" width="${n.type === "userTask" ? 100 : n.type === "exclusiveGateway" ? 50 : 36}" height="${n.type === "userTask" ? 80 : n.type === "exclusiveGateway" ? 50 : 36}"/></bpmndi:BPMNShape>`,
    )
    .join("");
  return `<?xml version="1.0" encoding="UTF-8"?><bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:flowable="http://flowable.org/bpmn" xmlns:moddle="http://bpmn.io/schema/bpmn" id="Definitions_1" targetNamespace="http://bpmn.io/schema/bpmn"><bpmn:process id="${xmlEscape(g.key)}" name="${xmlEscape(g.name)}" isExecutable="true">${nodes}${flows}</bpmn:process><bpmndi:BPMNDiagram id="Diagram_1"><bpmndi:BPMNPlane id="Plane_1" bpmnElement="${xmlEscape(g.key)}">${shapes}${edges}</bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`;
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
    [selectedNode, setSelectedNode] = useState("review"),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [validation, setValidation] = useState<any>(null),
    [preview, setPreview] = useState<any>(null),
    [chosenVersion, setChosenVersion] = useState(0),
    [confirm, setConfirm] = useState(false);
  const admin = currentUser?.role === "admin";
  const refresh = useCallback(async () => {
    try {
      const [list, opt] = await Promise.all([
        json<Model[]>("/api/bpmn-models"),
        json<Options>("/api/bpmn-modeler/options"),
      ]);
      setItems(list);
      setOptions({ ...opt, roles: opt.roles?.length ? opt.roles : roles });
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
        ].includes(x.businessObject?.$type),
      );
      if (el) setSelectedNode(el.id);
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
  }, []);
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
          if (
            sequence === importSequence.current &&
            modeler.current === instance
          )
            (instance.get("canvas") as any).zoom("fit-viewport");
        } catch (e) {
          if (sequence === importSequence.current)
            setError(`图形渲染失败：${String(e)}`);
        } finally {
          if (sequence === importSequence.current) syncing.current = false;
        }
      });
    return importQueue.current;
  }, []);
  const selected =
    graph.nodes.find((n) => n.id === selectedNode) ||
    graph.nodes.find((n) => n.type === "userTask");
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
      setPreview(null);
      setConfirm(false);
    }
    if (modeler.current) void loadGraph(graph);
  }, [graph, loadGraph]);
  const addNode = (type: NodeType) => {
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
    setGraph({ ...graph, nodes: [...graph.nodes, n] });
    setSelectedNode(id);
  };
  const addFlow = () => {
    const a = graph.nodes[0],
      b = graph.nodes[graph.nodes.length - 1];
    if (a && b && a.id !== b.id)
      setGraph({
        ...graph,
        flows: [
          ...graph.flows,
          {
            id: `flow_${Math.random().toString(36).slice(2, 7)}`,
            source: a.id,
            target: b.id,
          },
        ],
      });
  };
  const create = async () => {
    setBusy(true);
    setError("");
    try {
      const firstAvailableKey = items.some((item) => item.key === "uiApproval")
        ? `uiApproval_${Date.now()}`
        : "uiApproval";
      const g = emptyGraph(firstAvailableKey, "新审批流程");
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
    setModelId(id);
    setValidation(null);
    setPreview(null);
    setConfirm(false);
    setChosenVersion(0);
    setNotice("");
    setError("");
    try {
      const m = await json<Model>(`/api/bpmn-models/${encodeURIComponent(id)}`);
      setGraph(m.graph || emptyGraph(m.key, m.name));
      savedGraph.current = JSON.stringify(m.graph || emptyGraph(m.key, m.name));
      setRevision(m.revision);
      setValidation(null);
      setPreview(null);
      const v = await json<Version[]>(
        `/api/bpmn-models/${encodeURIComponent(id)}/versions`,
      );
      setVersions(v);
    } catch (e) {
      setError(String(e));
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
      setPreview(null);
      setConfirm(false);
      await refresh();
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
  return (
    <main className="bpmn-page">
      <header className="bpmn-head">
        <div>
          <small>流程协同 / BPMN</small>
          <h1>流程模型设计器</h1>
          <p>
            结构化 BPMN 安全 MVP · 仅管理员可编辑；角色是 PLM
            业务角色，由服务端映射用户，绝不等同于 Flowable Group
          </p>
        </div>
        <div className="bpmn-actions">
          <button onClick={() => void create()} disabled={!admin || busy}>
            新建
          </button>
          <button
            onClick={() => void save()}
            disabled={!admin || !modelId || busy}
          >
            保存草稿
          </button>
          <button
            onClick={() => void validate()}
            disabled={!admin || !modelId || busy}
          >
            校验
          </button>
          <button
            onClick={() => void freeze()}
            disabled={!admin || !modelId || busy}
          >
            冻结版本
          </button>
        </div>
      </header>
      {!admin && (
        <div className="bpmn-alert">
          当前账户不是工作区管理员，设计与写入操作已禁用。
        </div>
      )}
      {error && (
        <div className="bpmn-alert" role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className="bpmn-notice" role="status">
          {notice}
        </div>
      )}
      <div className="bpmn-layout">
        <aside className="bpmn-models">
          <h2>流程草稿</h2>
          {items.map((m) => (
            <button
              key={m.id}
              className={modelId === m.id ? "active" : ""}
              onClick={() => void load(m.id)}
            >
              {m.name}
              <small>
                {m.key} · r{m.revision}
              </small>
            </button>
          ))}
          {!items.length && <p>尚无模型</p>}
        </aside>
        <section className="bpmn-work">
          <div className="bpmn-model-fields">
            <label>
              流程名称
              <input
                disabled={!admin}
                value={graph.name}
                maxLength={120}
                onChange={(e) => setGraph({ ...graph, name: e.target.value })}
              />
            </label>
            <label>
              流程 Key
              <input
                disabled={!admin}
                value={graph.key}
                maxLength={64}
                onChange={(e) => setGraph({ ...graph, key: e.target.value })}
              />
            </label>
          </div>
          <div className="bpmn-toolbar">
            {(
              [
                "startEvent",
                "userTask",
                "exclusiveGateway",
                "endEvent",
              ] as NodeType[]
            ).map((t) => (
              <button key={t} onClick={() => addNode(t)} disabled={!admin}>
                {
                  (
                    {
                      startEvent: "＋ 开始",
                      userTask: "＋ 用户任务",
                      exclusiveGateway: "＋ 排他网关",
                      endEvent: "＋ 结束",
                    } as any
                  )[t]
                }
              </button>
            ))}
            <button onClick={addFlow} disabled={!admin}>
              ＋ 连线
            </button>
            <span>
              只允许开始/结束、用户任务、排他网关与顺序流；无 XML
              导入或源文本编辑
            </span>
          </div>
          <div className="bpmn-canvas-wrap">
            <div
              ref={host}
              className="bpmn-canvas"
              aria-label="BPMN 图形画布"
            />
          </div>
          <section className="bpmn-inspector">
            <h2>选中元素属性</h2>
            {selected ? (
              <>
                <label>
                  名称
                  <input
                    disabled={!admin}
                    value={selected.name}
                    maxLength={120}
                    onChange={(e) => changeNode({ name: e.target.value })}
                  />
                </label>
                {selected.type === "userTask" && (
                  <>
                    <label>
                      分配方式
                      <select
                        disabled={!admin}
                        value={selected.assignment?.kind || "assignee"}
                        onChange={(e) => {
                          const kind = e.target.value as
                            "assignee" | "candidateUsers" | "candidateRole";
                          changeNode({
                            assignment:
                              kind === "candidateRole"
                                ? { kind, role: "" }
                                : { kind, userIds: [] },
                          });
                        }}
                      >
                        <option value="assignee">指定用户</option>
                        <option value="candidateUsers">候选用户</option>
                        <option value="candidateRole">
                          工作区角色（PLM 服务端展开）
                        </option>
                      </select>
                    </label>
                    {selected.assignment?.kind === "candidateRole" ? (
                      <label>
                        角色
                        <select
                          disabled={!admin}
                          value={selected.assignment.role || ""}
                          onChange={(e) =>
                            changeNode({
                              assignment: {
                                ...selected.assignment!,
                                role: e.target.value,
                              },
                            })
                          }
                        >
                          <option value="">选择角色</option>
                          {(options.roles || roles)
                            .filter((r) => roles.includes(r))
                            .map((r) => (
                              <option key={r} value={r}>
                                {
                                  (
                                    {
                                      admin: "管理员",
                                      plm_manager: "PLM 管理员",
                                      reviewer: "审批人",
                                      member: "成员",
                                    } as any
                                  )[r]
                                }
                              </option>
                            ))}
                        </select>
                      </label>
                    ) : (
                      <label>
                        {selected.assignment?.kind === "assignee"
                          ? "审批用户"
                          : "候选用户"}
                        <select
                          multiple={
                            selected.assignment?.kind === "candidateUsers"
                          }
                          value={
                            selected.assignment?.kind === "assignee"
                              ? (selected.assignment?.userIds || [])[0] || ""
                              : selected.assignment?.userIds || []
                          }
                          onChange={(e) => {
                            const vals =
                              selected.assignment?.kind === "assignee"
                                ? [e.currentTarget.value]
                                : Array.from(
                                    e.currentTarget.selectedOptions,
                                    (o) => o.value,
                                  );
                            changeNode({
                              assignment: {
                                ...selected.assignment!,
                                userIds: vals.filter(Boolean),
                              },
                            });
                          }}
                        >
                          {options.users.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.displayName} · {u.email}
                            </option>
                          ))}
                        </select>
                        <small>
                          展示业务名称及邮箱；仅保存 PLM 用户 ID，不暴露/编辑
                          Flowable 原始 ID。
                        </small>
                      </label>
                    )}
                  </>
                )}
              </>
            ) : (
              <p>请选择一个节点</p>
            )}
            <label>
              顺序流条件
              <select value="" onChange={() => {}}>
                <option value="">选择连线编辑…</option>
                {graph.flows.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.source} → {f.target}
                  </option>
                ))}
              </select>
            </label>
            <div className="bpmn-flow-list">
              {graph.flows.map((f) => (
                <div key={f.id}>
                  <select
                    aria-label="起点"
                    value={f.source}
                    onChange={(e) =>
                      setGraph({
                        ...graph,
                        flows: graph.flows.map((x) =>
                          x.id === f.id ? { ...x, source: e.target.value } : x,
                        ),
                      })
                    }
                  >
                    {graph.nodes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.name}
                      </option>
                    ))}
                  </select>
                  <span>→</span>
                  <select
                    aria-label="终点"
                    value={f.target}
                    onChange={(e) =>
                      setGraph({
                        ...graph,
                        flows: graph.flows.map((x) =>
                          x.id === f.id ? { ...x, target: e.target.value } : x,
                        ),
                      })
                    }
                  >
                    {graph.nodes.map((n) => (
                      <option key={n.id} value={n.id}>
                        {n.name}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="条件"
                    value={f.isDefault ? "default" : f.condition || ""}
                    onChange={(e) =>
                      setGraph({
                        ...graph,
                        flows: graph.flows.map((x) =>
                          x.id === f.id
                            ? {
                                ...x,
                                condition:
                                  e.target.value === "default"
                                    ? undefined
                                    : (e.target.value as any),
                                isDefault: e.target.value === "default",
                              }
                            : x,
                        ),
                      })
                    }
                  >
                    <option value="">无条件</option>
                    <option value="approved">approved</option>
                    <option value="rejected">rejected</option>
                    <option value="default">默认</option>
                  </select>
                  <button
                    onClick={() =>
                      setGraph({
                        ...graph,
                        flows: graph.flows.filter((x) => x.id !== f.id),
                      })
                    }
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>
            <div className="bpmn-node-delete">
              <button
                disabled={!admin || graph.nodes.length <= 2}
                onClick={() => {
                  const id = selected?.id;
                  if (!id) return;
                  setGraph({
                    ...graph,
                    nodes: graph.nodes.filter((n) => n.id !== id),
                    flows: graph.flows.filter(
                      (f) => f.source !== id && f.target !== id,
                    ),
                  });
                }}
              >
                删除选中节点
              </button>
            </div>
          </section>
        </section>
      </div>
      <section className="bpmn-lifecycle">
        <h2>校验、版本与发布</h2>
        <div className="bpmn-version-controls">
          <button
            onClick={() => void validate()}
            disabled={!admin || !modelId || busy}
          >
            校验当前草稿
          </button>
          <button
            onClick={() => void freeze()}
            disabled={!admin || !modelId || busy}
          >
            冻结不可变版本
          </button>
          <select
            value={chosenVersion || ""}
            onChange={(e) => {
              setChosenVersion(Number(e.target.value));
              setPreview(null);
              setConfirm(false);
            }}
          >
            <option value="">选择版本</option>
            {versionRows}
          </select>
          <button
            onClick={() => void doPreview()}
            disabled={!admin || !chosenVersion || busy}
          >
            预览差异
          </button>
        </div>
        {validation && (
          <pre className="bpmn-result">
            {JSON.stringify(validation, null, 2)}
          </pre>
        )}
        {preview && (
          <div className="bpmn-preview">
            <b>版本 v{preview.version} 预览</b>
            <pre>{JSON.stringify(preview.changes ?? preview, null, 2)}</pre>
            {(preview.blocked || preview.blockedReasons || preview.reasons) && (
              <div className="bpmn-alert">
                安全阻断：
                {JSON.stringify(
                  preview.blockedReasons || preview.reasons || preview.blocked,
                )}
                。CVE 依赖审查未完成时禁止真实 Flowable 发布；仅后端
                NODE_ENV=test + loopback mock
                可走本地闭环。界面提示不替代后端控制。
              </div>
            )}
            <label className="bpmn-confirm">
              <input
                type="checkbox"
                checked={confirm}
                onChange={(e) => setConfirm(e.target.checked)}
              />
              我已审阅此版本的差异，并明确确认发起发布请求
            </label>
            <button
              className="publish"
              disabled={
                !admin || !confirm || busy || !preview.confirmationToken
              }
              onClick={() => void publish()}
            >
              明确确认发布
            </button>
          </div>
        )}
        {!preview && (
          <p>
            只有冻结版本、查看预览并明确勾选确认后，才能发起发布；服务端可返回
            423 安全阻断。
          </p>
        )}
      </section>
      <footer className="bpmn-foot">
        Flowable 属性采用本项目自有最小 moddle 描述符（assignee / candidateUsers
        / candidateGroups），并非 Flowable 官方描述符。保留 bpmn.io
        水印。禁止导入外部 XML。当前用户：{currentUser?.displayName || "未知"}
      </footer>
    </main>
  );
}
