"use strict";
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const api = (name, ...args) => window.desktop.call(name, ...args);
let project,
  assets = {},
  projects = [],
  selected = null,
  groupFilter = null,
  query = "",
  mode = "network",
  view = { x: 0, y: 0, scale: 1 },
  historyState = {},
  dataPath = "";
let filters = new Set(Object.keys(Kin.TYPES)),
  showInferred = false,
  dimUnrelated = true,
  calc = null,
  calcToken = 0,
  calcWorker = null,
  layoutWorker = null,
  pathSelection = null,
  pathIndex = 0,
  projection = null,
  drag = null,
  toastTimer,
  saveQueue = Promise.resolve(),
  saveError = null,
  saveSerial = 0,
  modalState = {},
  pendingSnapshot = null,
  expandedRelations = false;
let renderedEdges = [];
const avatarCache = new Map();
const CARD_W = 188,
  CARD_H = 132;
const person = (id) => project.people.find((p) => p.id === id);
const parentNames = {
  biological: "생물학적",
  adoptive: "입양",
  guardian: "양육",
  unspecified: "미지정",
};
function avatar(p) {
  if (p.photo && assets[p.photo]) return assets[p.photo];
  const palettes = [
    ["#29403b", "#a6b79b", "#514538", "#ddbc99"],
    ["#3a3548", "#aaa0c7", "#302d3c", "#e6c7b2"],
    ["#3e4149", "#98a8b9", "#74604d", "#c89d7c"],
    ["#3b4336", "#a7b994", "#6e4a38", "#edc7a4"],
    ["#333e48", "#91a9bb", "#292d37", "#d8b79f"],
    ["#3e3b49", "#b8a9c2", "#60596d", "#d4bca4"],
    ["#454039", "#c4b387", "#a87d4e", "#f2d0aa"],
    ["#2f4443", "#8cb3a8", "#3d3937", "#bd967e"],
  ];
  const n =
      (p.avatar ?? [...p.id].reduce((a, c) => a + c.charCodeAt(0), 0)) % 8,
    [bg, cloth, hair, skin] = palettes[n];
  if (avatarCache.has(n)) return avatarCache.get(n);
  const long = [1, 3, 5, 6].includes(n);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240" viewBox="0 0 240 240"><defs><radialGradient id="b"><stop stop-color="${cloth}" stop-opacity=".35"/><stop offset="1" stop-color="${bg}"/></radialGradient></defs><rect width="240" height="240" fill="${bg}"/><rect width="240" height="240" fill="url(#b)"/><circle cx="120" cy="111" r="78" fill="none" stroke="${cloth}" stroke-opacity=".13"/><path d="M35 240Q42 176 92 169L148 169Q201 183 206 240" fill="${cloth}"/><path d="M103 147L101 178Q120 196 140 178L137 146" fill="${skin}"/><path d="M71 112Q58 37 120 35Q185 32 174 121L${long ? "188 195 149 180 90 181 56 195" : "160 147 80 146"}Z" fill="${hair}"/><ellipse cx="120" cy="110" rx="44" ry="57" fill="${skin}"/><path d="M76 100Q65 45 119 41Q170 42 166 98Q155 81 144 65Q125 90 77 83Z" fill="${hair}"/><path d="M93 107Q102 102 110 106M131 106Q141 102 149 107" fill="none" stroke="${hair}" stroke-width="3" stroke-linecap="round"/><ellipse cx="103" cy="113" rx="3" ry="3.4" fill="#343331"/><ellipse cx="139" cy="113" rx="3" ry="3.4" fill="#343331"/><path d="M120 117L116 132L123 133" fill="none" stroke="#a87960" stroke-opacity=".6" stroke-width="2"/><path d="M109 145Q120 150 132 144" fill="none" stroke="#9d6a5c" stroke-width="2.5" stroke-linecap="round"/><path d="M94 180L121 213L146 180L165 240H75Z" fill="${bg}" opacity=".7"/><circle cx="120" cy="213" r="5" fill="#d0bd88"/><path d="M46 226L75 196M194 226L165 196" stroke="${bg}" stroke-width="2" opacity=".45"/></svg>`;
  const result = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  avatarCache.set(n, result);
  return result;
}
function photoStyle(p) {
  const c = p.crop || { x: 0, y: 0, zoom: 1 };
  return `object-position:${50 + c.x / 2}% ${50 + c.y / 2}%;transform:scale(${c.zoom})`;
}
function thumb(p, cls = "") {
  return `<span class="thumb-wrap ${cls}" style="display:inline-flex;border-radius:50%;overflow:hidden;flex-shrink:0"><img src="${esc(avatar(p))}" alt="${esc(p.name)}" style="${photoStyle(p)}"></span>`;
}
function toast(message, error = false) {
  const t = $("#toast");
  t.textContent = message;
  t.style.background = error ? "#e5b4aa" : "";
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(
    () => t.classList.remove("show"),
    error ? 6500 : 3300,
  );
}
function status(text, error = false) {
  $("#save-status").textContent = text;
  $("#save-status").classList.toggle("error", error);
}
function persist(label = "보기 변경", historical = false) {
  const snapshot = Kin.clone(project),
    serial = ++saveSerial;
  pendingSnapshot = snapshot;
  status("◌ 저장 중");
  saveQueue = saveQueue.then(async () => {
    try {
      const result = await api("save", snapshot, label, historical);
      if (project.id === snapshot.id) {
        historyState = result.history;
        project.revision = Math.max(project.revision || 0, result.revision);
        renderHistory();
      }
      if (serial === saveSerial) {
        saveError = null;
        pendingSnapshot = null;
        status("● 저장됨");
      }
    } catch (e) {
      saveError = e;
      if (serial === saveSerial) {
        status("! 저장 실패 · Ctrl+S로 재시도", true);
        toast(e.message, true);
      }
    }
  });
  return saveQueue;
}
async function flush() {
  await saveQueue;
  if (saveError) throw saveError;
}
function commit(label, fn, { calculate = true } = {}) {
  const before = Kin.clone(project);
  try {
    fn();
    if(mode==="unified" || Object.keys(project.views.unified?.positions||{}).length) Unified.ensure(project);
    Kin.validate(project);
    persist(label, true);
    if (calculate) calculateRelations();
    renderAll();
    return true;
  } catch (e) {
    project = before;
    if ($("#modal").open) formError(e);
    else toast(e.message, true);
    return false;
  }
}
function renderHistory() {
  $("#undo").disabled = !historyState.undo;
  $("#redo").disabled = !historyState.redo;
  $("#undo").title = historyState.undo
    ? "실행 취소: " + historyState.undo + " (Ctrl+Z)"
    : "실행 취소";
  $("#redo").title = historyState.redo
    ? "다시 실행: " + historyState.redo
    : "다시 실행";
}
async function applyLoad(data) {
  project = data.project;
  assets = data.assets;
  historyState = data.history;
  selected = project.focus || project.people[0]?.id || null;
  mode = project.mode || "network";
  groupFilter = project.ui?.groupFilter || null;
  filters = new Set(project.ui?.filters || Object.keys(Kin.TYPES));
  dimUnrelated = project.ui?.dimUnrelated === true;
  query = "";
  $("#search").value = "";
  pathSelection = null;
  calc = null;
  showInferred = !!project.ui?.showInferred;
  ensurePositions();
  project.views.unified ||= {positions:{},viewport:null};
  if (project.families?.length)
    project.views.family.anchors = Families.projectUnits(project).placement;
  view = project.views[mode].viewport || { x: 0, y: 0, scale: 1 };
  renderAll();
  calculateRelations();
  if (!project.views[mode].viewport)
    requestAnimationFrame(() => {
      if (mode === "family" && familyList().length)
        locateFamily(familyList()[0].id);
      else if(mode==='unified')frameUnifiedStart();
      else fitGraph(false);
    });
  projects = await api("list");
}
function ensurePositions() {
  const positions = project.views.network.positions;
  for (const p of project.people)
    if (!positions[p.id])
      positions[p.id] = Kin.localPosition(
        p,
        positions[project.focus],
        positions,
      );
  if (!person(project.focus)) project.focus = project.people[0]?.id || null;
}
function calculateRelations() {
  if (calcWorker) calcWorker.terminate();
  calc = null;
  calcToken++;
  const token = calcToken;
  if (!project.focus) {
    renderDetails();
    return;
  }
  calcWorker = new Worker("worker.js");
  calcWorker.onmessage = ({ data }) => {
    if (token !== calcToken) return;
    if (data.error) {
      toast("관계 계산: " + data.error, true);
      return;
    }
    calc = data.value;
    renderDetails();
    renderGraph();
  };
  calcWorker.onerror = (e) => {
    toast("관계 계산 중 오류가 발생했습니다.", true);
    console.error(e);
  };
  calcWorker.postMessage({
    type: "infer",
    token,
    project,
    focus: project.focus,
    options: { ...project.settings, limit: 100000 },
  });
}
function filteredPeople() {
  return project.people.filter(
    (p) =>
      (!groupFilter || p.groups.includes(groupFilter)) &&
      (!query ||
        [
          p.name,
          p.subtitle,
          p.notes,
          ...p.groups.map(
            (id) => project.groups.find((g) => g.id === id)?.name,
          ),
        ]
          .join(" ")
          .toLocaleLowerCase()
          .includes(query)),
  );
}
function renderAll() {
  $("#project-title").textContent = project.name;
  $("#canvas-title").textContent = project.name;
  $("#canvas-description").textContent =
    project.description || "";
  $("#people-count").textContent = project.people.length;
  $("#focus-label").textContent = person(project.focus)
    ? person(project.focus).name + " 기준"
    : "기준 인물 선택";
  $$(".mode-switch button").forEach((b) =>
    b.classList.toggle("active", b.dataset.mode === mode),
  );
  $("#filter-count").textContent =
    filters.size < Object.keys(Kin.TYPES).length ? "· " + filters.size : "";
  $("#mode-note").textContent =
    mode === "family"
      ? "참조 카드는 같은 인물입니다 · 순환은 연결 지점에서 멈춥니다"
      : "드래그한 카드는 그 자리에 고정됩니다";
  renderSidebar();
  renderHistory();
  renderGraph();
  renderDetails();
  renderPath();
}
function renderSidebar() {
  $("#groups").innerHTML =
    `<button class="group-row ${!groupFilter ? "active" : ""}" data-action="filter-group" data-id=""><span class="swatch" style="background:#a5b6a4"></span>모든 인물<span class="number">${project.people.length}</span></button>` +
    project.groups
      .map(
        (g) =>
          `<button class="group-row ${groupFilter === g.id ? "active" : ""}" data-action="filter-group" data-id="${esc(g.id)}"><span class="swatch" style="background:${safeColor(g.color)}"></span>${esc(g.name)}<span class="number">${project.people.filter((p) => p.groups.includes(g.id)).length}</span></button>`,
      )
      .join("");
  const pp = filteredPeople();
  $("#visible-count").textContent =
    query || groupFilter ? pp.length + "명" : "";
  $("#person-list").innerHTML =
    pp
      .map(
        (p) =>
          `<button class="person-row ${p.id === selected ? "active" : ""}" data-action="select-person" data-id="${esc(p.id)}">${thumb(p)}<span><strong>${esc(p.name)}</strong><small>${esc(p.subtitle || "소개 미등록")}</small></span>${p.id === project.focus ? '<i class="ref-dot"></i>' : ""}</button>`,
      )
      .join("") ||
    '<p class="muted" style="padding:12px">일치하는 인물이 없습니다.</p>';
}
function safeColor(c) {
  return /^#[0-9a-f]{6}$/i.test(c) ? c : "#a8bca6";
}
function getProjection() {
  if(mode==='unified') {
    const model=pathSelection?{...project,ui:{...project.ui,foldedFamilies:[],familyBranch:'',familyOwner:''}}:project;
    return Unified.projection(model);
  }
  if (project.families?.length) {
    const model = pathSelection
      ? {
          ...project,
          ui: {
            ...project.ui,
            foldedFamilies: [],
            familyBranch: "",
            familyOwner: "",
          },
        }
      : project;
    return Families.projectUnits(model, { network: mode === "network" });
  }
  const legacy = Families.legacyProjection(project, {
    network: mode === "network",
  });
  if (legacy) return legacy;
  if (mode === "network")
    return {
      nodes: project.people.map((p) => ({
        id: p.id,
        person: p.id,
        ...project.views.network.positions[p.id],
      })),
      edges: project.relations.map((r) => ({
        id: r.id,
        from: r.from,
        to: r.to,
      })),
      truncated: false,
    };
  return Kin.familyProjection(
    project,
    project.familyRoot || project.focus,
    project.settings.familyDepth || 4,
    600,
  );
}
function getRelated() {
  const ids = new Set([selected, project.focus]);
  for (const r of project.relations)
    if (r.from === selected || r.to === selected) {
      ids.add(r.from);
      ids.add(r.to);
    }
  if (selected === project.focus && calc)
    for (const r of calc.results) ids.add(r.person);
  return ids;
}
function svgPhoto(p, x, y, size, key) {
  const c = p.crop || { x: 0, y: 0, zoom: 1 },
    s = size * c.zoom,
    dx = (size - s) / 2 - ((c.x / 100) * (s - size)) / 2,
    dy = (size - s) / 2 - ((c.y / 100) * (s - size)) / 2;
  return `<defs><clipPath id="${key}"><circle cx="${x + size / 2}" cy="${y + size / 2}" r="${size / 2}"/></clipPath></defs><image href="${esc(avatar(p))}" x="${x + dx}" y="${y + dy}" width="${s}" height="${s}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${key})"/>`;
}
function edgePath(a, b, offset, self = false) {
  if (self)
    return `M ${a.x + CARD_W} ${a.y + 40} C ${a.x + CARD_W + 90} ${a.y - 65},${a.x - 40} ${a.y - 65},${a.x + 10} ${a.y + 8}`;
  const ax = a.x + CARD_W / 2,
    ay = a.y + CARD_H / 2,
    bx = b.x + CARD_W / 2,
    by = b.y + CARD_H / 2,
    dx = bx - ax,
    dy = by - ay;
  const scaleA = Math.min(
      CARD_W / 2 / (Math.abs(dx) || 1),
      CARD_H / 2 / (Math.abs(dy) || 1),
    ),
    sx = ax + dx * scaleA,
    sy = ay + dy * scaleA,
    tx = bx - dx * scaleA,
    ty = by - dy * scaleA;
  if (mode === "family") {
    const points = Families.route(
      { x: sx, y: sy },
      { x: tx, y: ty },
      (projection?.nodes || []).map((n) => ({
        x: n.x,
        y: n.y,
        w: CARD_W,
        h: CARD_H,
      })),
      [
        { x: sx, y: (sy + ty) / 2 + offset },
        { x: tx, y: (sy + ty) / 2 + offset },
      ],
    );
    return points.map((p, i) => (i ? "L" : "M") + p.x + " " + p.y).join(" ");
  }
  const dist = Math.max(1, Math.hypot(dx, dy)),
    cx = (sx + tx) / 2 - (dy / dist) * offset,
    cy = (sy + ty) / 2 + (dx / dist) * offset;
  return `M ${sx} ${sy} Q ${cx} ${cy} ${tx} ${ty}`;
}
function renderGraph() {
  if (!project) return;
  projection = getProjection();
  renderedEdges = [];
  const visible = new Set(filteredPeople().map((p) => p.id)),
    related = getRelated(),
    proof = pathSelection?.proofs[pathIndex],
    pathIds = new Set(proof?.people || []),
    pathEdges = new Set(proof?.edges || []);
  const nodes = projection.nodes.filter((n) => visible.has(n.person)),
    map = new Map(nodes.map((n) => [n.id, n]));
  let html = "";
  for (const [type, t] of Object.entries(Kin.TYPES))
    html += `<defs><marker id="arrow-${type}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10" fill="${t.color}"/></marker></defs>`;
  if (projection.junctions)
    html += drawFamilyGeometry(projection, visible, pathEdges, proof);
  const pairCount = new Map(),
    pairIndex = new Map();
  for (const e of projection.edges) {
    const key = [e.from, e.to].sort().join("|");
    pairCount.set(key, (pairCount.get(key) || 0) + 1);
  }
  for (const e of projection.edges) {
    const r = project.relations.find((r) => r.id === e.id);
    if (!r) continue;
    const inPath = pathEdges.has(r.id);
    if (!filters.has(r.type) && !inPath) continue;
    let a = map.get(e.from),
      b = map.get(e.to);
    if (!a || !b) continue;
    if (e.reverse) [a, b] = [b, a];
    const key = [e.from, e.to].sort().join("|"),
      index = pairIndex.get(key) || 0;
    pairIndex.set(key, index + 1);
    const offset = (index - ((pairCount.get(key) || 1) - 1) / 2) * 42;
    const active = inPath || r.from === selected || r.to === selected,
      opacity = proof
        ? inPath
          ? 1
          : 0.09
        : dimUnrelated && selected && !active
          ? 0.2
          : 0.65,
      color = inPath ? "#d5e9b5" : Kin.TYPES[r.type].color;
    const d = edgePath(a, b, a.id > b.id ? -offset : offset, a.id === b.id),
      edgeLabel =
        r.type === "custom" ? r.label || "관계" : Kin.TYPES[r.type].name;
    const edgeIndex = renderedEdges.length;
    renderedEdges.push({ a, b, offset: a.id > b.id ? -offset : offset });
    html += `<g class="edge" data-edge="${esc(r.id)}" data-render-edge="${edgeIndex}" opacity="${opacity}"><path d="${d}" stroke="transparent" stroke-width="16" fill="none"/><path d="${d}" stroke="${color}" stroke-width="${inPath ? 3 : active ? 1.8 : 1.3}" fill="none" ${r.type === "parent" ? `marker-end="url(#arrow-${r.type})"` : ""} ${["friend", "colleague"].includes(r.type) ? 'stroke-dasharray="5 5"' : ""}/><title>${esc(person(r.from).name)} → ${esc(person(r.to).name)}: ${esc(edgeLabel)}</title></g>`;
  }
  if (showInferred && calc) {
    for (const r of calc.results.filter((r) => r.kind === "inferred")) {
      const a = nodes.find((n) => n.person === project.focus),
        b = nodes.find((n) => n.person === r.person);
      if (a && b)
        html += `<path d="${edgePath(a, b, 30)}" stroke="#bdb39d" stroke-width="1" stroke-dasharray="2 6" opacity=".3" fill="none"><title>${esc(r.label)} · 자동 계산</title></path>`;
    }
  }
  if (mode === "family" && !projection.junctions) {
    const levels = [
      ...new Set(nodes.filter((n) => n.level !== null).map((n) => n.level)),
    ];
    for (const l of levels) {
      const ns = nodes.filter((n) => n.level === l),
        x = Math.min(...ns.map((n) => n.x)) - 32,
        y = Math.min(...ns.map((n) => n.y)) - 21;
      html += `<text x="${x}" y="${y}" fill="#52665f" font-size="9" font-family="Segoe UI,Malgun Gothic,sans-serif">${l === 0 ? "기준 세대" : l < 0 ? `${-l}세대 위` : `${l}세대 아래`}</text>`;
    }
    const shelf = nodes.find((n) => n.shelf);
    if (shelf)
      html += `<text x="${shelf.x}" y="${shelf.y - 21}" fill="#52665f" font-size="9">다른 연결 · 세대 미지정</text>`;
  }
  for (const [i, n] of nodes.entries()) {
    const p = person(n.person),
      isSelected = p.id === selected,
      isFocus = p.id === project.focus,
      onPath = pathIds.has(p.id),
      opacity = proof
        ? onPath
          ? 1
          : 0.22
        : dimUnrelated && selected && !related.has(p.id)
          ? 0.32
          : 1;
    const group = project.groups.find((g) => p.groups.includes(g.id)),
      color = group ? safeColor(group.color) : "#9bacad",
      labels =
        calc?.results.filter((r) => r.person === p.id).map((r) => r.label) ||
        [],
      unique = [...new Set(labels)],
      label =
        p.id === project.focus
          ? "관계의 기준"
          : unique.slice(0, 2).join(" · ") +
            (unique.length > 2 ? " 외 " + (unique.length - 2) + "개" : ""),
      stroke = onPath
        ? "#c9e3ab"
        : isSelected
          ? "#b7cbae"
          : isFocus
            ? "#809a78"
            : "#3b484b";
    html += `<g class="node" data-node="${esc(n.id)}" data-person="${esc(p.id)}" transform="translate(${n.x},${n.y})" opacity="${opacity}" tabindex="0" role="button" aria-label="${esc(p.name)} 상세 정보"><rect class="card-bg" width="${CARD_W}" height="${CARD_H}" rx="11" fill="${isSelected ? "#2c3931" : "#232c30"}" stroke="${stroke}" stroke-width="${isSelected || onPath ? 1.7 : 1}" filter="url(#card-shadow)"/><rect x="16" y="15" width="3" height="18" rx="1.5" fill="${color}" opacity=".8"/>${svgPhoto(p, 70, 13, 48, "photo-" + i)}<circle cx="94" cy="37" r="25.5" fill="none" stroke="${isFocus ? "#afc4a4" : "#4a5b51"}" stroke-width="1.3"/>${isFocus ? '<circle cx="114" cy="19" r="6" fill="#b8cba6" stroke="#2c3931" stroke-width="2"/>' : ""}<text x="94" y="82" text-anchor="middle" font-size="14" fill="#e7eee3" font-weight="500">${esc(p.name.length > 13 ? p.name.slice(0, 12) + "…" : p.name)}</text><text x="94" y="99" text-anchor="middle" font-size="8" fill="#8d9d9e">${esc((p.subtitle || p.gender || "").slice(0, 24))}</text><line x1="16" y1="108" x2="172" y2="108" stroke="#405049" stroke-opacity=".55"/><text x="94" y="122" text-anchor="middle" font-size="8" fill="${isFocus ? "#b6cba9" : "#9cac9f"}">${esc(n.cycle ? "↩ 순환 연결" : n.reference ? "↗ 동일 인물 · " + label : (label || "관계 미표시").slice(0, 30))}</text>${n.pinned ? '<text x="164" y="29" text-anchor="middle" fill="#a4b39a" font-size="11">⌖</text>' : ""}<title>${esc(p.name)}${n.reference ? " · 동일 인물의 참조 카드" : ""}${n.pinned ? " · 위치 고정" : ""}</title></g>`;
  }
  $("#world").innerHTML = html;
  drawConnectionHandles();
  transformWorld();
  $("#canvas-empty").hidden = project.people.length > 0;
  $("#legend").innerHTML = Object.entries(Kin.TYPES)
    .filter(
      ([k]) => filters.has(k) && project.relations.some((r) => r.type === k),
    )
    .slice(0, 6)
    .map(
      ([k, t]) =>
        `<span><i style="background:${t.color}"></i>${esc(k === "parent" ? "부모·자녀" : t.name)}</span>`,
    )
    .join("");
  $("#graph-stats").textContent =
    `${nodes.length} 카드 · ${project.relations.length} 관계${projection.truncated ? " · 일부 펼침" : ""}`;
  renderMinimap(nodes);
  renderFamilyJump();
}
function transformWorld() {
  $("#world").setAttribute(
    "transform",
    `translate(${view.x} ${view.y}) scale(${view.scale})`,
  );
  $("#zoom-value").textContent = Math.round(view.scale * 100) + "%";
  sizeEditorPorts();
}
function bounds(nodes) {
  if (!nodes.length) return { x: 0, y: 0, w: 600, h: 400 };
  let x = Math.min(...nodes.map((n) => n.x)),
    y = Math.min(...nodes.map((n) => n.y));
  return {
    x,
    y,
    w: Math.max(...nodes.map((n) => n.x)) + CARD_W - x,
    h: Math.max(...nodes.map((n) => n.y)) + CARD_H - y,
  };
}
function renderMinimap(nodes) {
  const b = bounds(nodes);
  $("#minimap").setAttribute(
    "viewBox",
    `${b.x - 30} ${b.y - 30} ${b.w + 60} ${b.h + 60}`,
  );
  $("#minimap").innerHTML = nodes
    .map(
      (n) =>
        `<rect x="${n.x}" y="${n.y}" width="${CARD_W}" height="${CARD_H}" rx="12" fill="${n.person === selected ? "#bacba9" : "#54675b"}" opacity="${n.person === selected ? 1 : 0.7}"/>`,
    )
    .join("");
}
function frameUnifiedStart(){
  const nodes=projection?.nodes||[];
  if(!nodes.length){fitGraph(false);return;}
  const top=Math.min(...nodes.map(n=>n.y));
  const first=nodes.filter(n=>n.y<=top+250).slice(0,6);
  const b=bounds(first),rect=$("#canvas").getBoundingClientRect();
  const scale=Math.max(.1,Math.min(1.05,(rect.width-80)/(b.w+25),(rect.height-95)/(b.h+25)));
  view={scale,x:(rect.width-b.w*scale)/2-b.x*scale,y:40-b.y*scale};
  transformWorld();
}
function fitGraph(save = true) {
  const nodes = (projection || getProjection()).nodes.filter((n) =>
      filteredPeople().some((p) => p.id === n.person),
    ),
    b = bounds(nodes),
    rect = $("#canvas").getBoundingClientRect();
  const scale = Math.max(
    0.1,
    Math.min(
      1.1,
      (rect.width - 110) / (b.w + 40),
      (rect.height - 105) / (b.h + 40),
    ),
  );
  view = {
    scale,
    x: (rect.width - b.w * scale) / 2 - b.x * scale,
    y: (rect.height - b.h * scale) / 2 - b.y * scale - 12,
  };
  transformWorld();
  if (save) saveView();
}
function saveView() {
  project.views[mode].viewport = { ...view };
  persist("화면 이동", false);
}
function zoom(factor, x, y) {
  const r = $("#canvas").getBoundingClientRect();
  x = x ?? r.width / 2;
  y = y ?? r.height / 2;
  const old = view.scale;
  view.scale = Math.max(0.08, Math.min(2.5, old * factor));
  view.x = x - ((x - view.x) * view.scale) / old;
  view.y = y - ((y - view.y) * view.scale) / old;
  transformWorld();
}
function centerPerson(id) {
  const n = projection.nodes.find((n) => n.person === id);
  if (!n) return;
  const rect = $("#canvas").getBoundingClientRect();
  view.x = rect.width / 2 - (n.x + CARD_W / 2) * view.scale;
  view.y = rect.height / 2 - (n.y + CARD_H / 2) * view.scale;
  transformWorld();
  saveView();
}
function selectPerson(id, center = false) {
  if (!person(id)) return;
  selected = id;
  document.body.classList.remove("detail-hidden");
  expandedRelations = false;
  pathSelection = null;
  renderAll();
  if (center) centerPerson(id);
}
function setFocus(id) {
  if (!person(id)) return;
  project.ui = {
    ...project.ui,
    familyBranch: "",
    familyOwner: project.ui?.familyOwner ? id : "",
  };
  project.focus = id;
  selected = id;
  expandedRelations = false;
  pathSelection = null;
  calculateRelations();
  renderAll();
  persist("기준 인물 변경", false);
  toast(person(id).name + " 기준으로 관계를 해석합니다.");
}
function renderDetails() {
  const p = person(selected),
    el = $("#details");
  if (!p) {
    el.innerHTML = `<div class="detail-placeholder"><div class="symbol">✳</div><h3>한 사람, 수많은 이야기</h3><p>인물 카드를 선택하면<br>프로필과 연결된 관계를 살펴볼 수 있어요.</p><button class="secondary" data-action="add-person">＋ 인물 등록</button></div>`;
    return;
  }
  const direct = project.relations.filter(
      (r) => r.from === p.id || r.to === p.id,
    ),
    asFocus = p.id === project.focus,
    results =
      calc?.results.filter(
        (r) => r.kind === "inferred" && (asFocus || r.person === p.id),
      ) || [],
    shown = expandedRelations ? results : results.slice(0, 6),
    relations = direct.slice(0, expandedRelations ? direct.length : 8);
  el.innerHTML = `<div class="detail-top"><span>인물 상세</span><div><button data-action="edit-person" data-id="${esc(p.id)}" title="프로필 편집">✎</button><button data-action="hide-detail" title="패널 접기">×</button></div></div><div style="width:86px;height:86px;margin:5px auto 13px;border-radius:50%;border:4px solid #344239;overflow:hidden"><img style="width:100%;height:100%;object-fit:cover;${photoStyle(p)}" src="${esc(avatar(p))}" alt="${esc(p.name)}"></div><h2 class="profile-name">${esc(p.name)}</h2><div class="profile-subtitle">${esc(p.subtitle || "소개 미등록")}</div><div class="badges">${p.groups
    .map((id) => project.groups.find((g) => g.id === id))
    .filter(Boolean)
    .map((g) => `<span class="badge">${esc(g.name)}</span>`)
    .join(
      "",
    )}</div><div class="profile-actions"><button class="primary" data-action="add-relation" data-id="${esc(p.id)}">＋ 관계 추가</button><button class="secondary" data-action="set-focus" data-id="${esc(p.id)}" title="이 인물을 기준으로 관계 해석">◎ 기준</button></div>${asFocus ? '<div class="ref-banner">◎ 이 인물을 기준으로 관계를 보고 있어요.</div>' : ""}<div class="profile-meta"><span>성별</span><span>${esc(p.gender || "미지정")}</span><span>직접 관계</span><span>${direct.length}개 연결</span><span>기준 인물</span><span>${esc(person(project.focus)?.name || "없음")}</span></div>${p.notes ? `<div class="detail-section"><div class="section-caption">이야기 <button class="text-button" data-action="edit-person" data-id="${esc(p.id)}">편집</button></div><div class="notes">${esc(p.notes)}</div></div>` : ""}<div class="detail-section"><div class="section-caption">직접 등록한 관계 <small>${direct.length}개의 연결</small></div>${
    relations
      .map((r) => {
        const other = person(r.from === p.id ? r.to : r.from);
        return `<button class="relation-item" data-action="edit-relation" data-id="${esc(r.id)}">${thumb(other)}<span><span class="rel-name">${esc(other.name)}</span><span class="rel-type" style="color:${Kin.TYPES[r.type].color}">${esc(Kin.labelRelation(r, p.id))}${r.type === "parent" ? " · " + parentNames[r.parentKind || "unspecified"] : ""}</span></span><span class="rel-badge">직접 ↗</span></button>`;
      })
      .join("") || '<p class="micro">아직 연결된 관계가 없습니다.</p>'
  }</div><div class="detail-section"><div class="section-caption">자동 계산된 친족 관계 <small>${esc(person(project.focus)?.name || "")} 기준</small></div>${
    !calc
      ? '<p class="micro">관계를 계산하고 있습니다…</p>'
      : shown
          .map((r) => {
            const other = person(r.person),
              idx = calc.results.indexOf(r);
            return `<button class="relation-item inferred" data-action="show-proof" data-index="${idx}">${thumb(other)}<span><span class="rel-name">${esc(other.name)}</span><span class="rel-type">${esc(r.label)}</span></span><span class="rel-badge">경로 ${r.count}${calc.truncated ? "+" : ""} ›</span></button>`;
          })
          .join("") ||
        '<p class="micro">현재 규칙과 탐색 범위에서 발견된 추가 친족 관계가 없습니다.</p>'
  }${!expandedRelations && (results.length > 6 || direct.length > 8) ? '<button class="text-button" data-action="expand-relations">관계 목록 모두 펼치기 ↓</button>' : ""}<div class="micro" style="margin-top:12px">${calc ? `최대 ${calc.depth}단계 · ${calc.states.toLocaleString()}개 경로 상태 탐색${calc.truncated ? " · 계산량 제한으로 일부만 탐색됨" : ""}<br>탐색한 근거 경로를 12개씩 펼쳐볼 수 있습니다.` : "계산 준비 중"}</div><button class="text-button" data-action="calculation-settings">탐색 범위 및 계산 설정 ↗</button>${calc?.cycles.length ? `<button class="text-button" data-action="show-cycles">순환 경로 ${calc.cycles.length}개 확인 ↗</button>` : ""}</div><div class="detail-footer-actions"><button data-action="pin-selected">⌖ ${isSelectedPinned() ? "위치 고정 해제" : "위치 고정"}</button><button data-action="merge-person" data-id="${esc(p.id)}">인물 병합</button><button data-action="delete-person" data-id="${esc(p.id)}">인물 삭제</button></div>`;
  renderFamilyDetails(p, el);
  simplifyDetails(el,p);
}
function isSelectedPinned() {
  return projection?.nodes
    .filter((n) => n.person === selected)
    .every((n) => n.pinned);
}
function renderPath() {
  const panel = $("#path-panel");
  if (!pathSelection) {
    panel.hidden = true;
    return;
  }
  const proof = pathSelection.proofs[pathIndex];
  if (!proof) {
    panel.hidden = true;
    return;
  }
  panel.hidden = false;
  panel.innerHTML = `<div class="path-head"><span>관계의 근거 <strong style="margin-left:10px">${esc(pathSelection.label)}</strong></span><button data-action="close-proof">×</button></div><div class="path-steps">${proof.people.map((id, i) => `${i ? `<span class="path-arrow">${esc(proof.steps[i - 1] || "연결")} →</span>` : ""}<button class="path-person" data-action="center-only" data-id="${esc(id)}">${esc(person(id)?.name || id)}</button>`).join("")}</div><div class="path-proof-tabs">${pathSelection.proofs.length > 12 && pathIndex >= 12 ? '<button data-action="proof-index" data-index="' + (pathIndex - 12) + '">이전 경로</button>' : ""}${pathSelection.proofs.length > 1 ? pathSelection.proofs.map((p, i) => (i < Math.floor(pathIndex / 12) * 12 || i >= Math.floor(pathIndex / 12) * 12 + 12 ? "" : `<button class="${pathIndex === i ? "active" : ""}" data-action="proof-index" data-index="${i}">경로 ${i + 1}</button>`)).join("") : ""}${pathSelection.proofs.length > Math.floor(pathIndex / 12) * 12 + 12 ? '<button data-action="proof-index" data-index="' + (Math.floor(pathIndex / 12) * 12 + 12) + '">다음 경로</button>' : ""}<span class="micro">${proof.birthEvent ? "출생 사건 " + esc(proof.birthEvent) + " · " : ""}${[...new Set(proof.parentKinds || [])].map((k) => parentNames[k] + " 부모 관계").join(" · ") || "직접 등록한 관계를 따라 계산했습니다."}</span></div>`;
}
function showProof(result) {
  pathSelection = result;
  pathIndex = 0;
  groupFilter = null;
  query = "";
  $("#search").value = "";
  renderAll();
}
function modal(title, body, footer = "") {
  modalState = {};
  $("#modal-content").innerHTML =
    `<div class="modal-header"><h2>${esc(title)}</h2><button data-action="close-modal" aria-label="닫기">×</button></div><div class="modal-body"><div id="form-error" class="form-error" hidden></div>${body}</div>${footer ? `<div class="modal-footer">${footer}</div>` : ""}`;
  if (!$("#modal").open) $("#modal").showModal();
}
function closeModal() {
  $("#modal").close();
  modalState = {};
}
function formError(e) {
  const el = $("#form-error");
  if (el) {
    el.textContent = typeof e === "string" ? e : e.message;
    el.hidden = false;
    el.scrollIntoView({ block: "nearest" });
  } else toast(e.message || e, true);
}
function field(label, name, value = "", type = "text", extra = "") {
  return `<div class="form-row"><label for="${name}">${label}</label><input id="${name}" type="${type}" value="${esc(value)}" ${extra}></div>`;
}
function options(items, value) {
  return items
    .map(
      ([v, l]) =>
        `<option value="${esc(v)}" ${v === value ? "selected" : ""}>${esc(l)}</option>`,
    )
    .join("");
}
function selectField(label, id, items, value) {
  return `<div class="form-row"><label for="${id}">${label}</label><select id="${id}">${options(items, value)}</select></div>`;
}
function personForm(id, relationAnchor = null) {
  const p = id
    ? person(id)
    : {
        id: Kin.id(),
        name: "",
        subtitle: "",
        gender: "미지정",
        notes: "",
        groups: [],
        photo: "",
        avatar: Math.floor(Math.random() * 8),
        crop: { x: 0, y: 0, zoom: 1 },
      };
  modal(
    id ? "인물 프로필 편집" : "새로운 인물",
    `<div class="photo-editor"><div class="photo-preview"><img id="photo-preview" src="${esc(avatar(p))}" style="${photoStyle(p)}"></div><div><div class="photo-buttons"><button class="secondary" data-action="pick-photo">사진 선택</button><button class="secondary" data-action="reset-photo">기본 초상화</button></div><div class="crop-controls"><span>확대</span><input id="crop-zoom" type="range" min="1" max="3" step=".05" value="${p.crop?.zoom || 1}"><span>좌우</span><input id="crop-x" type="range" min="-100" max="100" value="${p.crop?.x || 0}"><span>상하</span><input id="crop-y" type="range" min="-100" max="100" value="${p.crop?.y || 0}"></div></div></div>${field("이름 *", "person-name", p.name, "text", 'maxlength="100" placeholder="인물의 이름을 입력하세요"')}${field("한 줄 소개", "person-subtitle", p.subtitle, "text", 'maxlength="180" placeholder="직업, 별명, 소속 세계…"')}${field("생년월일 (선택)", "person-birthday", p.birthDate || "", "date")}${selectField(
      "성별 / 프로필 표현",
      "person-gender",
      ["미지정", "여성", "남성", "논바이너리", "기타"].map((x) => [x, x]),
      p.gender,
    )}<div class="form-row"><label>소속 그룹 · 여러 개 선택 가능</label><div class="check-list">${project.groups.map((g) => `<label class="check-label"><input type="checkbox" name="person-group" value="${esc(g.id)}" ${p.groups.includes(g.id) ? "checked" : ""}>${esc(g.name)}</label>`).join("") || '<span class="micro">왼쪽 컬렉션 관리에서 그룹을 만들 수 있습니다.</span>'}</div></div><div class="form-row"><label for="person-notes">이야기와 메모</label><textarea id="person-notes" rows="4" placeholder="이 인물에 대해 기록해 보세요.">${esc(p.notes)}</textarea></div>${relationAnchor ? `<div class="notice">${esc(person(relationAnchor).name)}과 새 인물을 함께 연결합니다.</div><div style="margin-top:18px">${relationFields({ from: relationAnchor, to: p.id, type: "parent", parentKind: "unspecified" }, true)}</div>` : ""}`,
    `<button class="secondary" data-action="close-modal">취소</button><button class="primary" data-action="save-person">${id ? "변경 저장" : "인물 등록"}</button>`,
  );
  modalState = {
    type: "person",
    person: Kin.clone(p),
    editing: !!id,
    relationAnchor,
  };
  if(!id&&!relationAnchor)simplifyAddPerson();
  $("#person-name").focus();
}
function relationFields(r, newPerson = false) {
  const source = person(r.from)?.name || "선택 인물";
  return `${
    !newPerson
      ? selectField(
          "연결할 인물",
          "rel-target",
          project.people.map((p) => [p.id, p.name]),
          r.to,
        )
      : ""
  }<div class="form-grid">${selectField(
    "관계 종류",
    "rel-type",
    Object.entries(Kin.TYPES).map(([k, v]) => [k, v.name]),
    r.type,
  )}${selectField(
    "부모 관계 방향",
    "rel-direction",
    [
      ["forward", `${source} → 자녀`],
      ["reverse", `부모 → ${source}`],
    ],
    "forward",
  )}</div><div id="parent-kind-wrap">${selectField("부모 관계의 성격", "rel-parent-kind", Object.entries(parentNames), r.parentKind || "unspecified")}</div><div id="custom-label-wrap" ${r.type !== "custom" ? "hidden" : ""}>${field("관계 이름", "rel-label", r.label || "")}</div><div class="form-row"><label for="rel-notes">관계 메모</label><textarea id="rel-notes" rows="2">${esc(r.notes || "")}</textarea></div><div id="relation-family-options"></div><div id="relation-preview" class="notice">관계 종류와 방향을 선택해 주세요.</div>`;
}
function relationForm(anchor, id = null) {
  const owned = id && project.relations.find((r) => r.id === id)?.familyId;
  if (owned) {
    openFamily(owned, "", id);
    return;
  }
  if (!project.people.length) {
    personForm();
    return;
  }
  const old = id ? project.relations.find((r) => r.id === id) : null,
    r = old
      ? Kin.clone(old)
      : {
          id: Kin.id(),
          from: anchor || selected || project.focus,
          to:
            project.people.find(
              (p) => p.id !== (anchor || selected || project.focus),
            )?.id ||
            anchor ||
            selected ||
            project.focus,
          type: "parent",
          parentKind: "unspecified",
          notes: "",
        };
  modal(
    old ? "관계 편집" : "관계 추가",
    `<div class="notice" style="margin-bottom:20px">${esc(person(r.from).name)}에서 연결합니다. 여러 종류의 관계를 함께 등록할 수 있습니다.</div>${!old ? `<button class="secondary" data-action="family-create" data-id="${esc(r.from)}" style="width:100%;margin-bottom:9px">부모와 자녀를 가족 단위로 연결</button><button class="secondary" data-action="relation-new-person" data-id="${esc(r.from)}" style="width:100%;margin-bottom:20px">＋ 새 인물을 만들고 연결</button>` : ""}${field("연결할 인물 검색", "rel-search", "", "search", 'placeholder="이름 또는 ID"')}${relationFields(r)}`,
    `${old ? `<button class="secondary danger" style="margin-right:auto" data-action="delete-relation" data-id="${esc(r.id)}">관계 삭제</button><button class="secondary" data-action="direct-proof" data-id="${esc(r.id)}">경로 보기</button>` : '<button class="secondary" data-action="close-modal">취소</button>'}<button class="primary" data-action="save-relation">저장</button>`,
  );
  modalState = { type: "relation", relation: r, editing: !!old };
  updateRelationPreview();
}
function readRelation(from, to, id) {
  const type = $("#rel-type").value,
    reverse = type === "parent" && $("#rel-direction").value === "reverse";
  return {
    id: id || Kin.id(),
    from: reverse ? to : from,
    to: reverse ? from : to,
    type,
    parentKind: type === "parent" ? $("#rel-parent-kind").value : "",
    label: $("#rel-label").value.trim().slice(0, 100),
    notes: $("#rel-notes").value.slice(0, 20000),
  };
}
function updateRelationPreview() {
  if (!$("#rel-type")) return;
  refreshRelationFamilyOptions();
  const type = $("#rel-type").value;
  $("#rel-direction").disabled = type !== "parent";
  $("#parent-kind-wrap").hidden = type !== "parent";
  $("#custom-label-wrap").hidden = type !== "custom";
  const a =
      person(modalState.relation?.from || modalState.relationAnchor)?.name ||
      "선택 인물",
    b =
      modalState.type === "person"
        ? $("#person-name").value || "새 인물"
        : person($("#rel-target").value)?.name || "상대 인물";
  $("#relation-preview").textContent =
    type === "parent"
      ? $("#rel-direction").value === "forward"
        ? `${a}은(는) ${b}의 부모입니다.`
        : `${b}은(는) ${a}의 부모입니다.`
      : `${a}와(과) ${b}: ${type === "custom" ? $("#rel-label").value || "기타 관계" : Kin.TYPES[type].name}`;
}
function savePerson(another = false) {
  try {
    const p = Kin.clone(modalState.person);
    p.name = $("#person-name").value.trim();
    if (!p.name) throw Error("이름을 입력해 주세요.");
    p.subtitle = $("#person-subtitle").value.trim();
    p.gender = $("#person-gender").value;
    p.birthDate = $("#person-birthday").value;
    p.notes = $("#person-notes").value.slice(0, 100000);
    p.groups = $$('input[name="person-group"]:checked').map((x) => x.value);
    p.crop = {
      zoom: +$("#crop-zoom").value,
      x: +$("#crop-x").value,
      y: +$("#crop-y").value,
    };
    const editing = modalState.editing,
      anchor = modalState.relationAnchor,
      relation = anchor ? readRelation(anchor, p.id) : null;
    if (relation?.type === "custom" && !relation.label)
      throw Error("관계 이름을 입력해 주세요.");
    const success = commit(editing ? "프로필 수정" : "인물 추가", () => {
      if (editing)
        project.people[project.people.findIndex((n) => n.id === p.id)] = p;
      else {
        project.people.push(p);
        project.views.network.positions[p.id] = Kin.localPosition(
          p,
          project.views.network.positions[anchor || selected],
          project.views.network.positions,
        );
      }
      if (relation) appendConnection(relation);
      if (!project.focus) project.focus = p.id;
      selected = p.id;
    });
    if (!success) return;
    closeModal();
    if(!editing)revealNewCard(p.id);
    if(another){personForm();return;}
    toast(
      editing
        ? "프로필을 저장했습니다."
        : "인물 카드를 추가했습니다.",
    );
  } catch (e) {
    formError(e);
  }
}
function saveRelation() {
  try {
    const r = readRelation(
      modalState.relation.from,
      $("#rel-target").value,
      modalState.relation.id,
    );
    if (r.type === "custom" && !r.label)
      throw Error("관계 이름을 입력해 주세요.");
    const editing = modalState.editing;
    const success = commit(editing ? "관계 수정" : "관계 추가", () => {
      if (editing)
        project.relations[project.relations.findIndex((x) => x.id === r.id)] =
          r;
      else appendConnection(r);
    });
    if (!success) return;
    closeModal();
    toast("관계를 저장하고 친족 관계를 갱신했습니다.");
  } catch (e) {
    formError(e);
  }
}
function confirmModal(title, message, action, id, label = "삭제") {
  modal(
    title,
    `<p class="help-text">${message}</p><div class="notice">실행 취소로 되돌릴 수 있습니다.</div>`,
    `<button class="secondary" data-action="close-modal">취소</button><button class="secondary danger" data-action="${action}" data-id="${esc(id)}">${label}</button>`,
  );
}
async function projectLibrary() {
  await flush();
  projects = await api("list");
  modal(
    "나의 프로젝트 서재",
    projects
      .map(
        (p) =>
          `<button class="project-card ${p.id === project.id ? "current" : ""}" data-action="open-project" data-id="${esc(p.id)}"><span>✳</span><span><strong>${esc(p.name)}</strong><small>${p.people}명의 인물 · ${p.relations}개의 관계</small></span><span>${p.id === project.id ? "열려 있음" : "↗"}</span></button>`,
      )
      .join("") +
      '<div class="modal-actions"><button class="primary" data-action="new-project">＋ 새 프로젝트</button><button class="secondary" data-action="import-project">백업 가져오기</button><button class="secondary" data-action="new-demo">예시 추가</button><button class="secondary" data-action="family-sample">P1~P10 가족 예제</button></div>',
  );
}
function newProjectForm() {
  modal(
    "새로운 이야기 시작하기",
    field(
      "프로젝트 이름",
      "new-project-name",
      "",
      "text",
      'maxlength="100" placeholder="나만의 세계에 이름을 붙여 주세요"',
    ) +
      '<p class="muted">각 프로젝트의 인물과 관계는 독립적으로 보관됩니다.</p>',
    `<button class="secondary" data-action="close-modal">취소</button><button class="primary" data-action="create-project">프로젝트 만들기</button>`,
  );
  $("#new-project-name").focus();
}
function projectSettings() {
  modal(
    "프로젝트 설정",
    field(
      "프로젝트 이름",
      "settings-name",
      project.name,
      "text",
      'maxlength="100"',
    ) +
      field(
        "프로젝트 소개",
        "settings-description",
        project.description || "",
        "text",
        'maxlength="250"',
      ) +
      '<p class="micro">프로젝트를 삭제하려면 먼저 백업을 내보내는 것을 권장합니다.</p>',
    `<button class="secondary danger" style="margin-right:auto" data-action="delete-project-dialog">프로젝트 삭제</button><button class="primary" data-action="save-project-settings">저장</button>`,
  );
}
function filtersModal() {
  modal(
    "관계도 필터",
    `<p class="muted" style="margin-top:0">표시할 연결선을 선택하세요. 숨겨도 저장된 관계와 친족 계산은 유지됩니다.</p>${Object.entries(
      Kin.TYPES,
    )
      .map(
        ([k, t]) =>
          `<label class="filter-row"><span class="swatch" style="background:${t.color}"></span>${t.name}<input type="checkbox" name="edge-filter" value="${k}" ${filters.has(k) ? "checked" : ""}></label>`,
      )
      .join(
        "",
      )}<div class="side-divider"></div><label class="filter-row">관련 없는 인물 흐리게<input id="dim-toggle" type="checkbox" ${dimUnrelated ? "checked" : ""}></label><label class="filter-row">자동 친족 관계도 점선으로 표시<input id="inferred-toggle" type="checkbox" ${showInferred ? "checked" : ""}></label>`,
    `<button class="secondary" data-action="reset-filters">모두 표시</button><button class="primary" data-action="apply-filters">적용</button>`,
  );
}
function calculationSettings() {
  modal(
    "친족 관계 계산 설정",
    `<div class="notice">반복되는 인물을 만난 경로는 종료합니다. 발견한 모든 관계 종류를 표시하고, 찾은 근거 경로는 12개씩 펼쳐볼 수 있습니다.</div><div style="margin-top:20px">${selectField(
      "최대 탐색 깊이",
      "calc-depth",
      [2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => [String(n), `${n}단계`]),
      String(project.settings.depth || 6),
    )}</div><label class="filter-row">입양·양육 부모 관계 포함<input type="checkbox" id="calc-adoptive" ${project.settings.includeAdoptive !== false ? "checked" : ""}></label>${selectField(
      "선택한 계보 분기에서 펼칠 깊이",
      "family-depth",
      [2, 3, 4, 5, 6, 7, 8].map((n) => [String(n), `${n}세대`]),
      String(project.settings.familyDepth || 4),
    )}<p class="micro">한 번에 최대 100,000개 경로 상태를 탐색합니다. 한도에 도달하면 일부 탐색 상태를 표시합니다. 가족 단위의 전체 계보는 모든 가족을 표시합니다. 규칙에 없는 긴 관계는 자동 호칭을 만들지 않습니다.</p>`,
    `<button class="primary" data-action="save-calculation">적용하고 다시 계산</button>`,
  );
}
function focusPicker() {
  modal(
    "관계의 기준 인물",
    `<p class="muted">기준을 바꾸면 호칭이 바뀝니다. 카드의 위치는 유지됩니다.</p>${project.people.map((p) => `<button class="person-row ${p.id === project.focus ? "active" : ""}" data-action="pick-focus" data-id="${esc(p.id)}">${thumb(p)}<span><strong>${esc(p.name)}</strong><small>${esc(p.subtitle)}</small></span></button>`).join("")}`,
  );
}
function groupSettings() {
  modal(
    "컬렉션 관리",
    `<p class="muted">한 인물을 여러 그룹에 넣을 수 있습니다. 그룹 소속으로 친족 관계를 추정하지 않습니다.</p><div id="group-edit-list">${project.groups.map((g) => `<div class="group-edit" data-group="${esc(g.id)}"><input type="color" value="${safeColor(g.color)}" aria-label="그룹 색상"><input type="text" value="${esc(g.name)}" maxlength="50" aria-label="그룹 이름"><button data-action="remove-group-row" title="그룹 제거">×</button></div>`).join("")}</div><button class="secondary" data-action="add-group-row">＋ 그룹 추가</button>`,
    `<button class="secondary" data-action="close-modal">취소</button><button class="primary" data-action="save-groups">저장</button>`,
  );
}
function mergeForm(id) {
  const source = person(id);
  modal(
    "중복 인물 병합",
    `<div class="notice">${esc(source.name)}의 관계와 소속을 대상 인물로 옮깁니다. 메모는 합치고 기존 프로필은 내부 병합 이력에 보존합니다. 대상의 이름과 사진이 우선합니다. 중복 관계와 자기 자신으로 향하는 관계도 삭제하지 않습니다.</div><div style="margin-top:20px">${selectField(
      "이 인물에 합치기",
      "merge-target",
      project.people.filter((p) => p.id !== id).map((p) => [p.id, p.name]),
      project.people.find((p) => p.id !== id)?.id,
    )}</div><div id="merge-preview" class="micro"></div>`,
    `<button class="secondary" data-action="close-modal">취소</button><button class="primary" data-action="do-merge" data-id="${esc(id)}" ${project.people.length < 2 ? "disabled" : ""}>병합하기</button>`,
  );
  modalState.source = id;
  updateMergePreview();
}
function updateMergePreview() {
  if (!$("#merge-target")) return;
  const id = modalState.source,
    target = $("#merge-target").value,
    self = project.relations.filter(
      (r) => [r.from, r.to].includes(id) && [r.from, r.to].includes(target),
    ).length;
  $("#merge-preview").textContent =
    `${project.relations.filter((r) => r.from === id || r.to === id).length}개의 관계를 옮깁니다. 이 중 ${self}개는 자기 자신과의 관계가 됩니다. 실행 취소로 전체 복원할 수 있습니다.`;
}
function layoutMenu() {
  modal(
    "관계도 배치",
    `<p class="muted">드래그한 카드의 고정 상태를 존중합니다. 모든 배치 변경은 실행 취소할 수 있습니다.</p><button class="menu-row" data-action="layout-all">✧ 전체 정리 <small>고정 위치는 그대로 유지</small></button><button class="menu-row" data-action="layout-local">⌘ 선택 인물 주변만 정리 <small>직접 연결된 이웃만 조정</small></button><button class="menu-row" data-action="layout-focus">◎ 기준 인물 중심으로 재배치 <small>가계도 가지를 다시 구성</small></button><button class="menu-row" data-action="unlock-all">⌖ 모든 위치 고정 해제 <small>좌표는 유지</small></button>`,
  );
}
async function layout(kind) {
  closeModal();
  if (!project.people.length) return;
  const focus = project.focus,
    only =
      kind === "local"
        ? [
            selected,
            ...project.relations
              .filter((r) => r.from === selected || r.to === selected)
              .flatMap((r) => [r.from, r.to]),
          ]
        : null;
  if(mode==='unified'){
    commit('통합 가계도 정렬',()=>Unified.ensure(project,true,only?new Set(only):null),{calculate:false});
    if(kind==='focus')centerPerson(focus);else if(kind!=='local')fitGraph();
    return;
  }
  if (mode === "family" && project.families?.length) {
    arrangeFamilies(kind);
    return;
  }
  if (mode === "family") {
    commit(
      "가계도 정렬",
      () => {
        if (kind === "focus") project.familyRoot = focus;
        const old = project.views.family.positions;
        project.views.family.positions = Object.fromEntries(
          Object.entries(old).filter(
            ([id, p]) =>
              p.pinned ||
              (kind === "local" &&
                !only.some((personId) =>
                  projection.nodes.some(
                    (n) => n.id === id && n.person === personId,
                  ),
                )),
          ),
        );
      },
      { calculate: false },
    );
    fitGraph();
    return;
  }
  if (layoutWorker) layoutWorker.terminate();
  $("#layout-status").hidden = false;
  const capturedId = project.id,
    signature = JSON.stringify(project.views.network.positions),
    relationSignature = JSON.stringify(project.relations);
  layoutWorker = new Worker("worker.js");
  layoutWorker.onmessage = ({ data }) => {
    $("#layout-status").hidden = true;
    layoutWorker.terminate();
    layoutWorker = null;
    if (data.error) {
      toast(data.error, true);
      return;
    }
    if (
      project.id !== capturedId ||
      JSON.stringify(project.views.network.positions) !== signature ||
      JSON.stringify(project.relations) !== relationSignature
    ) {
      toast("그동안 변경된 배치를 보존했습니다. 다시 정렬해 주세요.");
      return;
    }
    commit(
      kind === "local" ? "주변 정렬" : "전체 정렬",
      () => {
        project.views.network.positions = data.value;
      },
      { calculate: false },
    );
    if (kind !== "local") fitGraph();
  };
  layoutWorker.onerror = () => {
    $("#layout-status").hidden = true;
    toast("정렬을 완료할 수 없습니다.", true);
  };
  layoutWorker.postMessage({
    type: "layout",
    project,
    positions: project.views.network.positions,
    options: { only, focus: kind === "focus" ? focus : null },
  });
}
function exportMenu() {
  modal(
    "내보내기와 백업",
    `<button class="menu-row" data-action="export-project">▧ 프로젝트 백업 <small>인물·관계·원본 사진·배치 포함</small></button><button class="menu-row" data-action="import-project">↙ 프로젝트 가져오기 <small>기존 데이터를 유지하고 새로 복원</small></button><button class="menu-row" data-action="export-svg">↗ 관계도 전체 SVG <small>현재 필터 적용 · 확대 가능한 이미지</small></button><button class="menu-row" data-action="export-png">▣ 관계도 전체 PNG <small>최대 8,192px · 현재 필터 적용</small></button><button class="menu-row" data-action="export-viewport">⊡ 현재 화면 PNG <small>보고 있는 캔버스 영역</small></button>`,
  );
}
async function exportImage(format, current = false) {
  closeModal();
  toast("이미지를 만들고 있습니다…");
  const svg = $("#canvas").cloneNode(true);
  svg.removeAttribute("tabindex");
  svg.removeAttribute("style");
  const nodes = projection.nodes.filter((n) =>
      filteredPeople().some((p) => p.id === n.person),
    ),
    b = bounds(nodes);
  let w, h;
  svg.querySelectorAll("[data-editor-only]").forEach(el=>el.remove());
  const world = svg.querySelector("#world");
  if (current) {
    const rect = $("#canvas").getBoundingClientRect();
    w = rect.width;
    h = rect.height;
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  } else {
    w = b.w + 100;
    h = b.h + 120;
    world.setAttribute("transform", `translate(${50 - b.x} ${50 - b.y})`);
    svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  }
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  svg.setAttribute("font-family", "Segoe UI, Malgun Gothic, sans-serif");
  svg.setAttribute("width", w);
  svg.setAttribute("height", h);
  svg
    .querySelectorAll("[tabindex],[role],[data-node],[data-person],[data-edge]")
    .forEach((el) => {
      for (const a of [
        "tabindex",
        "role",
        "data-node",
        "data-person",
        "data-edge",
      ])
        el.removeAttribute(a);
    });
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("width", "100%");
  bg.setAttribute("height", "100%");
  bg.setAttribute("fill", "#13191c");
  svg.insertBefore(bg, svg.firstChild);
  const xml = new XMLSerializer().serializeToString(svg);
  let data = xml;
  if (format === "png") {
    const scale = Math.min(
        2,
        8192 / w,
        8192 / h,
        Math.sqrt(32000000 / (w * h)),
      ),
      canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * scale));
    canvas.height = Math.max(1, Math.round(h * scale));
    const image = new Image(),
      url = URL.createObjectURL(new Blob([xml], { type: "image/svg+xml" }));
    try {
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () =>
          reject(
            Error("이미지 변환에 실패했습니다. SVG 내보내기를 사용해 주세요."),
          );
        image.src = url;
      });
      canvas
        .getContext("2d")
        .drawImage(image, 0, 0, canvas.width, canvas.height);
      data = canvas.toDataURL("image/png");
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const dest = await api(
    "export-image",
    project.name + (current ? " · 현재 화면" : ""),
    format,
    data,
  );
  if (dest) toast("관계도 이미지를 저장했습니다.");
}
function help() {
  modal(
    "인연 사용 안내",
    `<div class="help-text"><p><strong>인물을 등록하고 관계를 연결하세요.</strong><br>＋ 새로운 인물에서 사진과 이름을 등록합니다. 카드를 선택한 뒤 관계 추가를 누르면 기존 인물 또는 새 인물과 연결할 수 있습니다.</p><p><strong>기준 인물과 선택 인물은 다릅니다.</strong><br>카드를 클릭하면 상세 정보가 열립니다. ‘◎ 기준’을 누르면 그 사람을 중심으로 호칭을 해석합니다. 위치는 유지됩니다.</p><p><strong>캔버스를 자유롭게 탐색하세요.</strong><br>빈 곳을 드래그하면 화면이 이동합니다. 휠로 확대·축소하고 카드를 드래그하면 위치가 고정됩니다. 관계 선을 클릭하면 편집할 수 있습니다. 자동 관계를 누르면 성립 경로가 강조됩니다.</p><p><strong>가계도와 관계망을 오가세요.</strong><br>가계도의 ‘동일 인물’ 카드는 원본 인물을 가리킵니다. 순환은 참조 카드에서 종료됩니다. 다른 가지는 기준 변경 후 ‘기준 인물 중심으로 재배치’로 펼칠 수 있습니다.</p><p><strong>자동 저장과 복구</strong><br>모든 편집은 SQLite에 저장됩니다. Ctrl+Z / Ctrl+Shift+Z로 최근 60개 편집을 되돌립니다. 프로젝트 백업에는 사진이 포함됩니다. 앱을 옮길 때 백업 파일을 가져오세요.</p><p><strong>계산의 범위</strong><br>부모·자녀, 배우자, 형제자매의 명시적인 규칙으로 계산합니다. 친구·동료 관계로 친족을 추정하지 않습니다. 부모 관계의 성격을 경로에서 확인할 수 있습니다. 탐색 한도에 도달하면 일부 탐색됨을 표시합니다.</p><p><strong>단축키</strong><br>Ctrl+S 저장 · Ctrl+Z 실행 취소 · Ctrl+Shift+Z 다시 실행 · / 검색 · F 전체 보기 · Escape 경로 닫기</p><p class="micro">SIMLINE 2.2 · 인터넷 연결 없이 동작합니다.<br>저장 위치: ${esc(dataPath)}</p></div>`,
    `<button class="secondary" data-action="data-folder">데이터 폴더 열기</button><button class="primary" data-action="close-modal">시작하기</button>`,
  );
}

document.addEventListener("click", async (e) => {
  const button = e.target.closest("[data-action]");
  if (!button || button.disabled) return;
  const action = button.dataset.action,
    id = button.dataset.id;
  try {
    switch (action) {
      case "add-person":
        personForm();
        break;
      case "edit-person":
        personForm(id);
        break;
      case "save-person":
        savePerson();
        break;
      case "pick-photo": {
        const img = await api("image");
        if (!img || modalState.type !== "person") break;
        assets[img.id] = img.data;
        modalState.person.photo = img.id;
        modalState.person.crop = { x: 0, y: 0, zoom: 1 };
        $("#crop-zoom").value = 1;
        $("#crop-x").value = 0;
        $("#crop-y").value = 0;
        updatePhotoPreview();
        break;
      }
      case "reset-photo":
        modalState.person.photo = "";
        modalState.person.avatar = ((modalState.person.avatar || 0) + 1) % 8;
        $("#crop-zoom").value = 1;
        $("#crop-x").value = 0;
        $("#crop-y").value = 0;
        updatePhotoPreview();
        break;
      case "select-person":
        selectPerson(id, true);
        break;
      case "center-only":
        centerPerson(id);
        break;
      case "set-focus":
        setFocus(id);
        break;
      case "focus-picker":
        focusPicker();
        break;
      case "pick-focus":
        closeModal();
        setFocus(id);
        break;
      case "hide-detail":
        document.body.classList.add("detail-hidden");
        break;
      case "add-relation":
        relationForm(id || selected);
        break;
      case "edit-relation":
        relationForm(null, id);
        break;
      case "save-relation":
        saveRelation();
        break;
      case "relation-new-person":
        personForm(null, id);
        updateRelationPreview();
        break;
      case "delete-relation":
        confirmModal(
          "관계 삭제",
          "이 직접 관계를 삭제하면 관련된 친족 계산도 갱신됩니다.",
          "do-delete-relation",
          id,
        );
        break;
      case "do-delete-relation":
        commit("관계 삭제", () => {
          project.relations = project.relations.filter((r) => r.id !== id);
          pathSelection = null;
        });
        closeModal();
        toast("관계를 삭제했습니다. 실행 취소할 수 있습니다.");
        break;
      case "delete-person":
        confirmModal(
          "인물 삭제",
          `<strong>${esc(person(id).name)}</strong>과 연결된 ${project.relations.filter((r) => r.from === id || r.to === id).length}개의 직접 관계를 함께 삭제합니다.`,
          "do-delete-person",
          id,
        );
        break;
      case "do-delete-person":
        commit("인물 삭제", () => {
          Families.reassign(project, id, null);
          project.people = project.people.filter((p) => p.id !== id);
          project.relations = project.relations.filter(
            (r) => r.from !== id && r.to !== id,
          );
          delete project.views.network.positions[id];
          if (project.focus === id)
            project.focus = project.people[0]?.id || null;
          if (project.familyRoot === id) project.familyRoot = project.focus;
          selected = project.focus;
          pathSelection = null;
        });
        closeModal();
        break;
      case "merge-person":
        mergeForm(id);
        break;
      case "do-merge": {
        const target = $("#merge-target").value;
        const success = commit("인물 병합", () => {
          project = Kin.mergePeople(project, id, target);
          selected = target;
          pathSelection = null;
        });
        if (!success) break;
        closeModal();
        toast("인물을 병합했습니다. 실행 취소로 복원할 수 있습니다.");
        break;
      }
      case "direct-proof": {
        const r = project.relations.find((r) => r.id === id);
        closeModal();
        showProof({
          label: Kin.TYPES[r.type].name,
          proofs: [
            {
              people: [r.from, r.to],
              edges: [r.id],
              steps: [Kin.labelRelation(r, r.from)],
              parentKinds:
                r.type === "parent" ? [r.parentKind || "unspecified"] : [],
            },
          ],
        });
        break;
      }
      case "show-proof":
        showProof(calc.results[+button.dataset.index]);
        break;
      case "proof-index":
        pathIndex = +button.dataset.index;
        renderGraph();
        renderPath();
        break;
      case "close-proof":
        pathSelection = null;
        renderGraph();
        renderPath();
        break;
      case "show-cycles":
        if (calc?.cycles.length)
          showProof({
            label: "순환 연결 · 반복 지점에서 탐색 종료",
            proofs: calc.cycles,
          });
        break;
      case "expand-relations":
        expandedRelations = true;
        renderDetails();
        break;
      case "filter-group":
        groupFilter = id || null;
        project.ui = { ...project.ui, groupFilter };
        persist("컬렉션 필터", false);
        pathSelection = null;
        renderSidebar();
        renderGraph();
        renderPath();
        break;
      case "filters":
        filtersModal();
        break;
      case "reset-filters":
        $$('input[name="edge-filter"]').forEach((x) => (x.checked = true));
        break;
      case "apply-filters":
        filters = new Set(
          $$('input[name="edge-filter"]:checked').map((x) => x.value),
        );
        dimUnrelated = $("#dim-toggle").checked;
        showInferred = $("#inferred-toggle").checked;
        project.ui = {
          ...project.ui,
          filters: [...filters],
          dimUnrelated,
          showInferred,
        };
        persist("관계도 필터", false);
        closeModal();
        renderAll();
        break;
      case "calculation-settings":
        calculationSettings();
        break;
      case "save-calculation": {
        const depth = +$("#calc-depth").value,
          adoptive = $("#calc-adoptive").checked,
          familyDepth = +$("#family-depth").value;
        commit("계산 설정 변경", () => {
          project.settings = {
            ...project.settings,
            depth,
            includeAdoptive: adoptive,
            familyDepth,
          };
        });
        closeModal();
        break;
      }
      case "mode": {
        if (mode === button.dataset.mode) break;
        project.views[mode].viewport = { ...view };
        mode = button.dataset.mode;
        project.mode = mode;
        if (mode === "family" && !project.familyRoot)
          project.familyRoot = project.focus;
        view = project.views[mode].viewport || { x: 0, y: 0, scale: 1 };
        pathSelection = null;
        renderAll();
        if (!project.views[mode].viewport) {if(mode==='unified')frameUnifiedStart();else fitGraph(false);}
        saveView();
        break;
      }
      case "zoom-in":
        zoom(1.18);
        saveView();
        break;
      case "zoom-out":
        zoom(1 / 1.18);
        saveView();
        break;
      case "fit":
        fitGraph();
        break;
      case "layout-menu":
        layoutMenu();
        break;
      case "layout-all":
        await layout("all");
        break;
      case "layout-local":
        await layout("local");
        break;
      case "layout-focus":
        await layout("focus");
        break;
      case "unlock-all":
        commit(
          "위치 고정 해제",
          () => {
            for (const m of ["network", "family", "unified"])
              for (const p of Object.values(project.views[m].positions))
                p.pinned = false;
          },
          { calculate: false },
        );
        closeModal();
        break;
      case "pin-selected": {
        const unpin = isSelectedPinned();
        commit(
          unpin ? "위치 고정 해제" : "위치 고정",
          () => {
            for (const n of projection.nodes.filter(
              (n) => n.person === selected,
            ))
              project.views[mode].positions[n.id] = {
                x: n.x,
                y: n.y,
                pinned: !unpin,
              };
          },
          { calculate: false },
        );
        break;
      }
      case "undo":
      case "redo":
        await flush();
        if (historyState[action]) {
          const data = await api(action, project.id);
          await applyLoad(data);
          toast(
            action === "undo"
              ? "작업을 되돌렸습니다."
              : "작업을 다시 적용했습니다.",
          );
        }
        break;
      case "projects":
        await projectLibrary();
        break;
      case "new-project":
        newProjectForm();
        break;
      case "create-project": {
        const name = $("#new-project-name").value.trim();
        if (!name) {
          formError("프로젝트 이름을 입력해 주세요.");
          break;
        }
        await flush();
        await applyLoad(await api("create", name, false));
        closeModal();
        break;
      }
      case "new-demo":
        await flush();
        await applyLoad(await api("create", "달빛 아래의 사람들", true));
        closeModal();
        break;
      case "open-project":
        await flush();
        await applyLoad(await api("load", id));
        closeModal();
        break;
      case "project-settings":
        projectSettings();
        break;
      case "save-project-settings": {
        const name = $("#settings-name").value.trim(),
          description = $("#settings-description").value.trim();
        if (!name) {
          formError("이름을 입력해 주세요.");
          break;
        }
        commit(
          "프로젝트 설정",
          () => {
            project.name = name;
            project.description = description;
          },
          { calculate: false },
        );
        closeModal();
        break;
      }
      case "delete-project-dialog":
        modal(
          "프로젝트 삭제",
          `<p class="help-text">‘${esc(project.name)}’ 프로젝트를 삭제합니다. 프로젝트 삭제는 실행 취소할 수 없습니다. 필요한 경우 먼저 백업하세요.</p>`,
          `<button class="secondary" data-action="export-project">백업 내보내기</button><button class="secondary" data-action="close-modal">취소</button><button class="secondary danger" data-action="do-delete-project">프로젝트 삭제</button>`,
        );
        break;
      case "do-delete-project":
        await flush();
        await applyLoad(await api("delete-project", project.id));
        closeModal();
        break;
      case "group-settings":
        groupSettings();
        break;
      case "add-group-row":
        $("#group-edit-list").insertAdjacentHTML(
          "beforeend",
          `<div class="group-edit" data-group="${Kin.id()}"><input type="color" value="#9db59a" aria-label="그룹 색상"><input type="text" value="" placeholder="새 그룹 이름" maxlength="50" aria-label="그룹 이름"><button data-action="remove-group-row">×</button></div>`,
        );
        break;
      case "remove-group-row":
        button.closest(".group-edit").remove();
        break;
      case "save-groups": {
        const groups = $$(".group-edit").map((el) => ({
          id: el.dataset.group,
          name: el.querySelector("input[type=text]").value.trim(),
          color: el.querySelector("input[type=color]").value,
        }));
        if (groups.some((g) => !g.name)) {
          formError("그룹 이름을 입력해 주세요.");
          break;
        }
        commit(
          "그룹 편집",
          () => {
            project.groups = groups;
            const ids = new Set(groups.map((g) => g.id));
            for (const p of project.people)
              p.groups = p.groups.filter((id) => ids.has(id));
            if (!ids.has(groupFilter)) groupFilter = null;
          },
          { calculate: false },
        );
        closeModal();
        break;
      }
      case "export-menu":
        exportMenu();
        break;
      case "export-project":
        await flush();
        if (await api("export-project", project.id))
          toast("사진을 포함한 프로젝트 백업을 저장했습니다.");
        break;
      case "import-project":
        await flush();
        {
          const data = await api("import-project");
          if (data) {
            await applyLoad(data);
            closeModal();
            toast("새 프로젝트로 복원했습니다.");
          }
        }
        break;
      case "export-svg":
        await exportImage("svg");
        break;
      case "export-png":
        await exportImage("png");
        break;
      case "export-viewport":
        await exportImage("png", true);
        break;
      case "help":
        help();
        break;
      case "data-folder":
        await api("data-folder");
        break;
      case "close-modal":
        closeModal();
        break;
    }
  } catch (e) {
    if ($("#modal").open) formError(e);
    else toast(e.message, true);
    console.error(e);
  }
});
function updatePhotoPreview() {
  modalState.person.crop = {
    zoom: +$("#crop-zoom").value,
    x: +$("#crop-x").value,
    y: +$("#crop-y").value,
  };
  $("#photo-preview").src = avatar(modalState.person);
  $("#photo-preview").setAttribute("style", photoStyle(modalState.person));
}
document.addEventListener("input", (e) => {
  if (["crop-x", "crop-y", "crop-zoom"].includes(e.target.id))
    updatePhotoPreview();
  if (
    [
      "person-name",
      "rel-type",
      "rel-direction",
      "rel-target",
      "rel-label",
    ].includes(e.target.id)
  )
    updateRelationPreview();
  if (e.target.id === "merge-target") updateMergePreview();
});
$("#search").addEventListener("input", (e) => {
  query = e.target.value.trim().toLocaleLowerCase();
  renderSidebar();
  renderGraph();
});
$("#modal").addEventListener("click", (e) => {
  if (e.target === $("#modal")) {
    const r = $("#modal").getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      closeModal();
  }
});
$("#canvas").addEventListener("pointerdown", (e) => {
  if (e.button !== 0 && e.button !== 1) return;
  const node = e.target.closest(".node"),
    edge = e.target.closest(".edge");
  const sharedProof=e.target.closest('[data-shared-proof]');
  if(sharedProof&&!node){
    const ids=JSON.parse(sharedProof.dataset.sharedProof);
    const records=ids.map(id=>project.relations.find(r=>r.id===id)).filter(Boolean);
    if(records.length)showProof({label:Kin.TYPES[records[0].type].name,proofs:records.map(r=>({people:[r.from,r.to],edges:[r.id],steps:[Kin.labelRelation(r,r.from)],parentKinds:r.parentKind?[r.parentKind]:[]}))});
    return;
  }
  const unitTarget = e.target.closest("[data-family-open]");
  if (unitTarget && !node) {
    if (projection.legacy && !familyById(unitTarget.dataset.familyOpen)) previewLegacy();
    else openFamily(unitTarget.dataset.familyOpen);
    return;
  }
  if (edge && !node) {
    relationForm(null, edge.dataset.edge);
    return;
  }
  const rect = $("#canvas").getBoundingClientRect();
  drag = {
    startX: e.clientX,
    startY: e.clientY,
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
    view: { ...view },
    node: node?.dataset.node,
    person: node?.dataset.person,
    moved: false,
    position: node
      ? { ...projection.nodes.find((n) => n.id === node.dataset.node) }
      : null,
  };
  $("#canvas").setPointerCapture(e.pointerId);
  $("#canvas").classList.add("dragging");
  e.preventDefault();
});
$("#canvas").addEventListener("pointermove", (e) => {
  if (!drag) return;
  const dx = e.clientX - drag.startX,
    dy = e.clientY - drag.startY;
  if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
  if (!drag.moved) return;
  if (drag.node) {
    const p = drag.position,
      next = {
        x: Math.round(p.x + dx / view.scale),
        y: Math.round(p.y + dy / view.scale),
        pinned: true,
      };
    project.views[mode].positions[drag.node] = next;
    if (projection.junctions) {
      renderGraph();
      return;
    }
    const element = document.querySelector(
      `[data-node="${CSS.escape(drag.node)}"]`,
    );
    element?.setAttribute("transform", `translate(${next.x},${next.y})`);
    for (const [index, edge] of renderedEdges.entries()) {
      if (edge.a.id !== drag.node && edge.b.id !== drag.node) continue;
      const a = edge.a.id === drag.node ? { ...edge.a, ...next } : edge.a,
        b = edge.b.id === drag.node ? { ...edge.b, ...next } : edge.b,
        d = edgePath(a, b, edge.offset, a.id === b.id);
      document
        .querySelectorAll(`[data-render-edge="${index}"] path`)
        .forEach((path) => path.setAttribute("d", d));
    }
  } else {
    view.x = drag.view.x + dx;
    view.y = drag.view.y + dy;
    transformWorld();
  }
});
$("#canvas").addEventListener("pointerup", (e) => {
  if (!drag) return;
  const d = drag;
  drag = null;
  $("#canvas").classList.remove("dragging");
  if (d.node) {
    if (d.moved) {
      const now = freeDropPosition(
        d.node,
        project.views[mode].positions[d.node],
      );
      project.views[mode].positions[d.node] = {
        x: d.position.x,
        y: d.position.y,
        pinned: !!d.position.pinned,
      };
      commit(
        "카드 이동",
        () => {
          project.views[mode].positions[d.node] = now;
        },
        { calculate: false },
      );
    } else selectPerson(d.person);
  } else if (d.moved) saveView();
});
$("#canvas").addEventListener("pointercancel", () => {
  if (drag?.node) {
    project.views[mode].positions[drag.node] = {
      x: drag.position.x,
      y: drag.position.y,
      pinned: !!drag.position.pinned,
    };
    renderGraph();
  }
  drag = null;
  $("#canvas").classList.remove("dragging");
});
let wheelTimer;
$("#canvas").addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const r = $("#canvas").getBoundingClientRect();
    zoom(Math.exp(-e.deltaY * 0.0014), e.clientX - r.left, e.clientY - r.top);
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(saveView, 350);
  },
  { passive: false },
);
$("#canvas").addEventListener("dblclick", (e) => {
  const n = e.target.closest(".node");
  if (n) personForm(n.dataset.person);
});
$("#canvas").addEventListener("keydown", (e) => {
  const n = e.target.closest(".node");
  if (n && ["Enter", " "].includes(e.key)) {
    e.preventDefault();
    selectPerson(n.dataset.person);
  }
});
$("#minimap").addEventListener("click", () => fitGraph());
document.addEventListener("keydown", async (e) => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
  if (e.key === "Escape" && !$("#modal").open) {
    pathSelection = null;
    renderPath();
    renderGraph();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    persist("수동 저장", false);
    await saveQueue;
    if (!saveError) toast("모든 변경을 저장했습니다.");
    return;
  }
  if (typing || $("#modal").open) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    $("#" + (e.shiftKey ? "redo" : "undo")).click();
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
    e.preventDefault();
    $("#redo").click();
  }
  if (e.key === "/") {
    e.preventDefault();
    $("#search").focus();
  }
  if (e.key.toLowerCase() === "f") {
    e.preventDefault();
    fitGraph();
  }
});
window.desktop.onClose(async () => {
  try {
    if (wheelTimer) {
      clearTimeout(wheelTimer);
      saveView();
    }
    await flush();
    await api("close");
  } catch (e) {
    modal(
      "저장하지 못한 변경이 있습니다",
      `<p class="help-text">${esc(e.message)}<br>창을 닫기 전에 Ctrl+S로 저장을 다시 시도해 주세요. 저장 공간과 데이터 폴더 접근 권한을 확인하세요.</p>`,
      `<button class="primary" data-action="close-modal">편집으로 돌아가기</button>`,
    );
  }
});
window.addEventListener("error", (e) => {
  console.error(e.error);
  toast("화면 처리 중 오류가 발생했습니다: " + e.message, true);
});
window.addEventListener("unhandledrejection", (e) => {
  console.error(e.reason);
  toast(e.reason?.message || "작업을 완료하지 못했습니다.", true);
});
async function boot() {
  try {
    const data = await api("bootstrap");
    if(data.sourceQA){document.title="SIMLINE · 소스 QA";$("#qa-reload").hidden=false;}
    projects = data.projects;
    dataPath = data.dataPath;
    await applyLoad(data);
  } catch (e) {
    document.body.innerHTML = `<div style="padding:60px"><h1>프로젝트를 열 수 없습니다</h1><p>${esc(e.message)}</p><p>앱을 다시 실행하거나 데이터 백업을 확인해 주세요.</p></div>`;
  }
}
// Startup follows registration of the family editor in family-ui.js.
