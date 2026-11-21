import { useRef, useState } from "react";
import { ChevronDown, ChevronRight, Folder, FolderPlus } from "lucide-react";
import { uniqueTitle, type LibraryNode } from "../library/model";

export default function ArchiveLocation({ nodes, value, disabled, onChange, onCreate }: {
  nodes: LibraryNode[]; value: string; disabled: boolean;
  onChange: (id: string) => void; onCreate: (node: LibraryNode) => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const [search, setSearch] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const folders = nodes.filter(n => n.kind === "folder");
  function path(id: string) {
    const parts: string[] = [];
    const seen = new Set<string>();
    let node = folders.find(n => n.id === id);
    while (node && !seen.has(node.id)) {
      seen.add(node.id); parts.unshift(node.title);
      node = folders.find(n => n.id === node?.parentId);
    }
    return ["资料库", ...parts];
  }
  const parts = value ? path(value) : [];
  function create() {
    const title = name.trim();
    if (!title || /[\\/:*?"<>|\x00-\x1f]/.test(title)) { setError("请输入有效目录名称，不能包含路径字符。"); return; }
    try {
      onCreate({ id: crypto.randomUUID(), parentId: value || null, kind: "folder", title: uniqueTitle(nodes, value || null, title), content: "", tags: [], favorite: false, updatedAt: Date.now(), visitedAt: 0 });
      setCustom(false); setOpen(false); setName(""); setError("");
    } catch { setError("目录保存失败，请重试。"); }
  }
  return <div className="tz-location-field"><span id="tz-location-label">位置</span>
    <div className="tz-location-controls">
      <button type="button" className="tz-location-path" ref={trigger} aria-labelledby="tz-location-label" aria-expanded={open} disabled={disabled} title={parts.join(" / ")} onClick={() => {setOpen(!open); setCustom(false);}}>
        <Folder size={16}/>{value ? <span className="tz-breadcrumb">{(parts.length > 3 ? [parts[0], "…", ...parts.slice(-2)] : parts).map((part, i, all) => <span key={i} className={i === all.length - 1 ? "is-target" : ""}>{i > 0 && <ChevronRight size={12}/ >}{part}</span>)}</span> : <span>请选择归档目录</span>}<ChevronDown size={14}/>
      </button>
      <button type="button" className="tz-location-custom" disabled={disabled} onClick={() => { setCustom(!custom); setOpen(false); }}><FolderPlus size={16}/>自定义位置</button>
    </div>
    {open && <div className="tz-location-options" onKeyDown={e => {if (e.key === "Escape") {e.preventDefault(); e.stopPropagation(); setOpen(false); trigger.current?.focus();}}}>
      <input autoFocus aria-label="搜索归档目录" placeholder="搜索已有目录" value={search} onChange={e => setSearch(e.target.value)}/>
      <div>{folders.filter(n => path(n.id).join(" / ").toLowerCase().includes(search.toLowerCase())).map(n => <button type="button" key={n.id} style={{paddingLeft: 12 + (path(n.id).length - 2) * 16}} title={path(n.id).join(" / ")} onClick={() => {onChange(n.id);setOpen(false); trigger.current?.focus();}}><Folder size={14}/>{path(n.id).join(" / ")}</button>)}
      {!folders.some(n => path(n.id).join(" / ").toLowerCase().includes(search.toLowerCase())) && <p>没有匹配目录，可使用自定义位置新建。</p>}</div>
    </div>}
    {custom && <div className="tz-location-create"><p>新建于：{parts.join(" / ") || "资料库"}</p><label>目录名称<input autoFocus aria-label="目录名称" value={name} onChange={e => setName(e.target.value)} onKeyDown={e => {if (e.key === "Enter" && !e.nativeEvent.isComposing) {e.preventDefault();create();}}}/></label>{error && <p className="tz-archive-error" role="alert">{error}</p>}<div><button type="button" className="tz-secondary" onClick={() => setCustom(false)}>取消</button><button type="button" className="tz-primary" onClick={create}>新建并选择</button></div></div>}
  </div>;
}
