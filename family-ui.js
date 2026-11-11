"use strict";

let editFamilyDraft = null;
let addedProfiles = [];
let originFamilyId = null;
let originRelationId = null;

function familyList() {
  return project.families || [];
}
function familyById(id) {
  return familyList().find((family) => family.id === id);
}
function personName(id) {
  return person(id)?.name || id;
}
function buttonHTML(action, label, id = "", style = "secondary") {
  return `<button class="${style}" data-action="${action}" data-id="${esc(id)}">${esc(label)}</button>`;
}
function profileChoice(profile) {
  return `${profile.name} [${profile.id}]`;
}
function familyChoices() {
  return [...project.people, ...addedProfiles];
}
function readChoice(value, optional = false) {
  value = value.trim();
  if (!value && optional) return "";
  const people = familyChoices();
  const exact = people.find(
    (p) => profileChoice(p) === value || p.id === value,
  );
  if (exact) return exact.id;
  const matching = people.filter((p) => p.name === value);
  if (matching.length === 1) return matching[0].id;
  throw Error(
    "목록에서 인물을 선택하세요. 이름이 같으면 ID가 표시된 항목을 선택하세요.",
  );
}
function choiceText(id) {
  const p = familyChoices().find((p) => p.id === id);
  return p ? profileChoice(p) : "";
}
function choiceInput(id, label, value = "") {
  return `<div class="form-row"><label for="${id}">${esc(label)}</label><input id="${id}" list="family-people" value="${esc(choiceText(value))}" placeholder="이름 또는 ID 검색" autocomplete="off"></div>`;
}
function choicesDatalist() {
  return `<datalist id="family-people">${familyChoices()
    .map((p) => `<option value="${esc(profileChoice(p))}"></option>`)
    .join("")}</datalist>`;
}
function familyDescription(family) {
  const parents = family.parents.map(personName).join(" · ");
  const children = Families.childrenOf(family).map(personName).join(", ");
  return `${parents || "부모 미등록"} → ${children || "자녀 미등록"}`;
}
function previewLegacy() {
  const model = Families.legacyUnits(project);
  modal(
    "기존 관계에서 가족 단위 만들기",
    '<p class="muted">이미 등록한 부모와 배우자 연결을 다음 가족으로 묶습니다. 각 자녀의 출생 사건은 별도로 만들며 쌍둥이는 가족 편집에서 묶을 수 있습니다.</p>' +
      model.units
        .map((f) => "<p>" + esc(familyDescription(f)) + "</p>")
        .join(""),
    buttonHTML("close-modal", "취소") +
      buttonHTML("family-adopt", "가족 단위로 저장", "", "primary"),
  );
}
function familyMenu(onlyMine = false) {
  const families = familyList().filter(
    (f) => !onlyMine || Families.membersOf(f).includes(project.focus),
  );
  const rows = families
    .map(
      (f) => `<article class="family-record">
    <button class="family-record-title" data-action="family-edit" data-id="${esc(f.id)}"><strong>${esc(f.name)}</strong><span>${esc(familyDescription(f))}</span></button>
    <div class="family-tools">${buttonHTML("family-locate", "이동", f.id)}${buttonHTML("family-fold", (project.ui?.foldedFamilies || []).includes(f.id) ? "펼치기" : "접기", f.id)}${buttonHTML("family-branch", "이 계보만", f.id)}</div>
  </article>`,
    )
    .join("");
  modal(
    "가족 단위",
    `<div class="family-tools">${buttonHTML("families", "전체 가족")}${buttonHTML("family-mine", personName(project.focus) + "의 가족")}${buttonHTML("family-owner", "참여 가족만 그리기")}${buttonHTML("family-all", "전체 계보 표시")}</div>
    ${!familyList().length && Families.legacyUnits(project).units.length ? buttonHTML("family-adopt-preview", "기존 직접 관계로 가족 단위 만들기") : ""}${rows || '<p class="muted">등록된 가족 단위가 없습니다. 부모와 자녀를 선택해 첫 가족을 만드세요.</p>'}`,
    `${buttonHTML("family-create", "＋ 가족 만들기", selected || "", "primary")}`,
  );
}
function newFamily(parentId) {
  let seq = familyList().length + 1;
  while (familyById("F" + seq)) seq++;
  return {
    id: "F" + seq,
    name: "F" + seq,
    parents: parentId ? [parentId] : [],
    union: "spouse",
    parentKind: "unspecified",
    start: "",
    end: "",
    births: [],
  };
}
function openFamily(id, parentId = "", relationId = null) {
  originRelationId = relationId;
  const existing = familyById(id);
  originFamilyId = existing?.id || null;
  editFamilyDraft = existing ? Kin.clone(existing) : newFamily(parentId);
  addedProfiles = [];
  drawFamilyEditor();
}
function captureFamilyFields() {
  const f = editFamilyDraft;
  f.name = $("#family-name").value.trim();
  f.parents = [$("#parent-one").value, $("#parent-two").value]
    .map((value) => readChoice(value, true))
    .filter(Boolean);
  f.union = $("#family-union").value;
  f.parentKind = $("#family-parent-kind").value;
  f.start = $("#family-start").value;
  f.end = $("#family-end").value;
  for (const input of $$("#modal [data-birth-date]")) {
    const event = f.births.find((b) => b.id === input.dataset.birthDate);
    if (event) event.date = input.value;
  }
}
function drawFamilyEditor() {
  const f = editFamilyDraft;
  const births = f.births
    .map((b, index) => {
      const members = b.children
        .map(
          (id) =>
            `<span class="child-pill">${esc(familyChoices().find((p) => p.id === id)?.name || id)}<button data-action="birth-remove-child" data-event="${esc(b.id)}" data-id="${esc(id)}" title="이 사건에서 제외">×</button></span>`,
        )
        .join("");
      return `<section class="birth-event"><div class="family-event-heading"><strong>출생 사건 ${index + 1}${b.children.length === 2 ? " · 쌍둥이" : b.children.length > 2 ? " · 다태아" : ""}</strong><button class="text-button" data-action="birth-remove" data-id="${esc(b.id)}">사건 제외</button></div>
      <label>출생일 (선택)<input type="date" data-birth-date="${esc(b.id)}" value="${esc(b.date)}"></label><div class="child-pills">${members}</div>
      <div class="inline-add"><input list="family-people" data-birth-input="${esc(b.id)}" placeholder="같은 사건에 자녀 검색"><button class="secondary" data-action="birth-add-child" data-id="${esc(b.id)}">자녀 연결</button></div></section>`;
    })
    .join("");
  modal(
    originFamilyId ? "가족 편집" : "가족 만들기",
    `${choicesDatalist()}<p class="micro">가족 ID ${esc(f.id)}</p>${field("가족 이름", "family-name", f.name, "text", 'maxlength="100"')}
    <div class="form-grid">${choiceInput("parent-one", "첫 번째 부모", f.parents[0])}${choiceInput("parent-two", "두 번째 부모 (선택)", f.parents[1])}</div>
    <div class="form-grid">${selectField(
      "두 구성원의 관계",
      "family-union",
      [
        ["spouse", "배우자"],
        ["former", "이전 배우자"],
        ["none", "공동 부모"],
      ],
      f.union,
    )}${selectField("부모 관계의 성격", "family-parent-kind", Object.entries(parentNames), f.parentKind)}</div>
    <div class="form-grid">${field("관계 시작일 (선택)", "family-start", f.start, "date")}${field("종료일 (선택)", "family-end", f.end, "date")}</div>
    <div class="family-event-heading"><strong>자녀와 출생 사건</strong>${buttonHTML("birth-add", "＋ 출생 사건")}</div>
    <p class="micro">쌍둥이는 같은 출생 사건에 연결하세요. 다른 시기에 태어난 자녀는 새 출생 사건에 연결하세요.</p>
    ${births}
    <details class="family-quick-add"><summary>등록되지 않은 자녀 만들기</summary>
      ${field("새 자녀 이름", "new-child-name", "", "text", 'maxlength="100"')}
      ${selectField("출생 사건", "new-child-event", [["", "새 출생 사건"], ...f.births.map((b, i) => [b.id, "출생 사건 " + (i + 1)])], "")}
      <div class="family-tools">${buttonHTML("new-child-photo", "얼굴 사진 선택")}${buttonHTML("new-child-add", "작성 중인 가족에 추가")}</div><span id="child-photo-status" class="micro"></span>
    </details>`,
    `${originRelationId ? buttonHTML("direct-proof", "관계 경로", originRelationId) : ""}${originFamilyId ? buttonHTML("family-delete-dialog", "가족 삭제", f.id, "secondary danger") : ""}${buttonHTML("close-modal", "취소")}${buttonHTML("family-save", "가족 저장", "", "primary")}`,
  );
  modalState.childPhoto = "";
}
function saveFamily() {
  captureFamilyFields();
  const family = Kin.clone(editFamilyDraft);
  const validPeople = new Set([
    ...family.parents,
    ...Families.childrenOf(family),
  ]);
  if (addedProfiles.some((p) => !validPeople.has(p.id)))
    throw Error("새로 만든 자녀를 출생 사건에 연결한 뒤 저장하세요.");
  const success = commit(originFamilyId ? "가족 편집" : "가족 추가", () => {
    for (const p of addedProfiles) {
      project.people.push(p);
      const pos = project.views.network.positions;
      pos[p.id] = Kin.localPosition(p, pos[family.parents[0]], pos);
    }
    Families.save(project, family);
    project.views.family.anchors = Families.projectUnits(project).placement;
    if (!project.focus)
      project.focus = family.parents[0] || Families.childrenOf(family)[0];
    selected = selected || project.focus;
    pathSelection = null;
  });
  if (success) {
    closeModal();
    toast(family.name + " 가족을 저장했습니다.");
  }
}
function renderFamilyDetails(profile, container) {
  const own = familyList().filter((f) =>
    Families.membersOf(f).includes(profile.id),
  );
  const direct = project.relations.filter(
    (e) => e.from === profile.id || e.to === profile.id,
  );
  const matches = (type, direction) => [
    ...new Set(
      direct
        .filter(
          (e) => e.type === type && (!direction || e[direction] === profile.id),
        )
        .map((e) => (e.from === profile.id ? e.to : e.from)),
    ),
  ];
  const chips = (ids) =>
    ids
      .map((id) =>
        buttonHTML("select-person", personName(id), id, "person-link"),
      )
      .join(" ") || "—";
  const familyRows = own
    .map((f) =>
      buttonHTML(
        "family-edit",
        f.name + " · " + (f.parents.includes(profile.id) ? "부모" : "자녀"),
        f.id,
        "family-chip",
      ),
    )
    .join(" ");
  const births = own.flatMap((f) =>
    f.births
      .filter((b) => b.children.includes(profile.id) && b.children.length > 1)
      .map(
        (b) =>
          `${f.name} · ${b.children.length === 2 ? "쌍둥이" : "다태아"} · ${b.children.map(personName).join(", ")}`,
      ),
  );
  const section = document.createElement("section");
  section.className = "detail-section family-profile";
  section.innerHTML = `<div class="section-caption">가족과 계보 ${buttonHTML("family-create", "＋ 가족", profile.id, "text-button")}</div>
    <div class="profile-meta"><span>인물 ID</span><span class="identity">${esc(profile.id)}</span>
    ${profile.birthDate ? `<span>생년월일</span><span>${esc(profile.birthDate)}</span>` : ""}
    <span>배우자</span><span>${chips(matches("spouse"))}</span><span>이전 배우자</span><span>${chips(matches("former"))}</span>
    <span>부모</span><span>${chips(matches("parent", "to"))}</span><span>자녀</span><span>${chips(matches("parent", "from"))}</span></div>
    <div class="family-chips">${familyRows || '<span class="micro">참여 가족 없음</span>'}</div>
    ${births.map((b) => `<p class="micro">${esc(b)}</p>`).join("")}
    <details class="descendants"><summary>직계 후손 ${Families.descendants(project, profile.id).length}명</summary>${chips(Families.descendants(project, profile.id))}</details>`;
  const anchor = container.querySelector(".profile-meta");
  anchor?.after(section);
}
function showFamily(id, branch = false) {
  if (!familyById(id)) return;
  closeModal();
  if (mode !== "family" && mode !== "unified") {
    project.views[mode].viewport = { ...view };
    mode = "family";
    project.mode = mode;
  }
  project.ui = {
    ...project.ui,
    familyOwner: "",
    familyBranch: branch ? id : "",
  };
  project.ui.foldedFamilies = (project.ui.foldedFamilies || []).filter(
    (f) => f !== id,
  );
  renderAll();
  if (branch) fitGraph(false);
  else locateFamily(id);
  saveView();
}
function locateFamily(id) {
  const u = projection.junctions?.find((u) => u.id === id);
  if (!u) return;
  if(mode==='unified'){
    const area=bounds([...u.parents,...u.children]);
    u.x=area.x-20;u.y=area.y-20;u.width=area.w+40;u.height=area.h+40;
  }
  const size = $("#canvas").getBoundingClientRect(),
    scale = Math.min(
      1.15,
      (size.width - 80) / u.width,
      (size.height - 65) / u.height,
    );
  view = {
    scale: Math.max(0.1, scale),
    x: size.width / 2 - (u.x + u.width / 2) * scale,
    y: size.height / 2 - (u.y + u.height / 2) * scale,
  };
  transformWorld();
}
function arrangeFamilies(kind) {
  const pinned = project.views.family.positions;
  const localIds = new Set(
    familyList()
      .filter((f) => Families.membersOf(f).includes(selected))
      .map((f) => f.id),
  );
  commit(
    "가족 단위 정렬",
    () => {
      const viewData = project.views.family;
      for (const n of projection.nodes)
        if (
          !pinned[n.id]?.pinned &&
          (kind !== "local" || localIds.has(n.unitId))
        )
          delete pinned[n.id];
      if (kind === "local")
        for (const id of localIds) delete (viewData.anchors || {})[id];
      else viewData.anchors = {};
      viewData.anchors = Families.projectUnits(project).placement;
      if (kind === "focus") project.familyRoot = project.focus;
    },
    { calculate: false },
  );
  if (kind === "focus") {
    const f =
      familyList().find((f) => f.parents.includes(project.focus)) ||
      familyList().find((f) => Families.membersOf(f).includes(project.focus));
    if (f) {
      locateFamily(f.id);
      saveView();
      return;
    }
  }
  if (kind !== "local") fitGraph();
}
function drawFamilyGeometry(graph, visible, pathEdges, proof) {
  let html = "";
  const allRelations = new Map(project.relations.map((r) => [r.id, r]));
  const shownUnit = (id) =>
    !id ||
    graph.junctions
      .find((u) => u.id === id)
      ?.parents.concat(graph.junctions.find((u) => u.id === id).children)
      .some((n) => visible.has(n.person));
  if (mode === "family")
    for (const u of graph.junctions) {
      if (!shownUnit(u.id)) continue;
      const f = u.record;
      const text = `${u.name}  ·  ${u.folded ? "자녀 접힘" : f.births.length + "개 출생 사건"}${f.births.some((b) => b.children.length === 2) ? "  ·  쌍둥이" : ""}`;
      html += `<g data-family-open="${esc(u.id)}" style="cursor:pointer"><rect x="${u.x - 4}" y="${u.y - 3}" width="${u.width + 8}" height="${u.height}" rx="14" pointer-events="none" fill="#192124" stroke="#344641" stroke-dasharray="4 5"/><text x="${u.x + 16}" y="${u.y + 21}" fill="#c5d5c6" font-size="14">${esc(text)}</text></g>`;
    }
  let blocked = 0;
  for (const s of graph.segments) {
    const highlighted = s.owned.some((id) => pathEdges.has(id));
    if (!shownUnit(s.unitId)) continue;
    if (s.type !== "reference" && !filters.has(s.type) && !highlighted)
      continue;
    const related = s.owned.map((id) => allRelations.get(id)).filter(Boolean);
    if (
      related.length &&
      !related.some((e) => visible.has(e.from) && visible.has(e.to))
    )
      continue;
    if (s.type === "reference" && !visible.has(s.person)) continue;
    if (s.blocked) {
      blocked++;
      continue;
    }
    const color = highlighted
      ? "#ebf7bf"
      : s.type === "reference"
        ? "#879da5"
        : Kin.TYPES[s.type].color;
    const d = s.points
      .map((p, i) => (i ? "L" : "M") + p.x + " " + p.y)
      .join(" ");
    const isRelated = related.some(
      (e) => e.from === selected || e.to === selected,
    );
    const relationIds=related.filter(r=>r.type===s.type).map(r=>r.id);
    const attr = mode==="unified"&&relationIds.length ? `data-shared-proof="${esc(JSON.stringify(relationIds))}" style="cursor:pointer" data-link-kind="${esc(s.type)}" data-link-family="${esc(s.unitId||"")}"` : s.unitId
      ? `data-family-open="${esc(s.unitId)}"`
      : `data-edge="${esc(s.owned[0])}" class="edge"`;
    html += `<g ${attr}><path d="${d}" stroke="transparent" stroke-width="10" fill="none"/><path data-routed="true" d="${d}" stroke="${color}" stroke-width="${highlighted ? 3.5 : s.type === "reference" ? 1.4 : 2}" opacity="${proof && !highlighted ? 0.18 : isRelated || highlighted ? 1 : 0.65}" fill="none" ${s.type === "reference" || s.type === "former" ? 'stroke-dasharray="6 4"' : ""}/><title>${esc(s.type === "reference" ? personName(s.person) + " · 같은 인물의 다음 가족" : familyById(s.unitId)?.name || Kin.TYPES[s.type].name)}</title></g>`;
  }
  for (const u of graph.junctions) {
    if (!shownUnit(u.id)) continue;
    html += `<g data-junction="${esc(u.id)}" data-family-open="${esc(u.id)}" style="cursor:pointer"><circle cx="${u.center.x}" cy="${u.center.y}" r="6" fill="#192520" stroke="#c6d8af" stroke-width="2"/><title>${esc(u.name)} 가족 연결점</title>${mode==="unified"?`<text x="${u.center.x+8}" y="${u.center.y-9}" fill="#b6c5b7" font-size="10">${esc(u.name.slice(0,14))}</text>`:""}</g>`;
  }
  if (blocked)
    $("#mode-note").textContent =
      `카드 겹침으로 연결선 ${blocked}개 대기 · 위치를 조정하세요`;
  return html;
}
function pathFinder() {
  addedProfiles = [];
  modal(
    "두 인물 사이의 경로",
    `${choicesDatalist()}${choiceInput("path-from", "출발 인물", project.focus)}${choiceInput("path-to", "도착 인물", selected !== project.focus ? selected : project.people.find((p) => p.id !== selected)?.id)}
    ${selectField(
      "탐색할 최대 연결 수",
      "path-depth",
      [2, 3, 4, 5, 6, 8, 10].map((n) => [String(n), n + "단계"]),
      "6",
    )}
    <p class="micro">직접 등록한 가족·친구·동료 관계를 모두 탐색합니다. 짧은 경로부터 최대 50개를 표시합니다.</p><div id="path-search-results"></div>`,
    buttonHTML("path-search", "경로 찾기", "", "primary"),
  );
}
function searchPaths() {
  const from = readChoice($("#path-from").value),
    to = readChoice($("#path-to").value);
  if (from === to) throw Error("서로 다른 두 인물을 선택하세요.");
  const result = Families.findPaths(project, from, to, +$("#path-depth").value);
  const relations = new Map(project.relations.map((e) => [e.id, e]));
  modalState.foundPaths = result.paths.map((p) => ({
    ...p,
    steps: p.edges.map((id, i) =>
      Kin.labelRelation(relations.get(id), p.people[i]),
    ),
    parentKinds: p.edges
      .map((id) => relations.get(id).parentKind)
      .filter(Boolean),
  }));
  $("#path-search-results").innerHTML =
    `<p class="micro">${result.paths.length}개 경로${result.partial ? " · 탐색 한도에 도달해 일부만 표시" : ""}</p>` +
    modalState.foundPaths
      .map(
        (p, i) =>
          `<button class="path-result" data-action="path-display" data-index="${i}">${p.people.map((id, j) => (j ? " <small>— " + esc(p.steps[j - 1]) + " →</small> " : "") + esc(personName(id))).join("")}</button>`,
      )
      .join("");
}
document.addEventListener("input", (event) => {
  if (event.target.id === "rel-search") {
    const q = event.target.value.toLocaleLowerCase();
    const select = $("#rel-target"),
      current = select.value;
    const list = project.people.filter((p) =>
      (p.name + " " + p.id).toLocaleLowerCase().includes(q),
    );
    select.innerHTML = options(
      list.map((p) => [p.id, p.name + " · " + p.id]),
      current,
    );
    updateRelationPreview();
  }
});
document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const { action, id } = button.dataset;
  try {
    switch (action) {
      case "family-adopt-preview":
        previewLegacy();
        break;
      case "family-adopt":
        if (
          commit("기존 관계를 가족으로 정리", () =>
            Families.adoptLegacy(project, Families.legacyUnits(project)),
          )
        )
          familyMenu();
        break;
      case "families":
        familyMenu();
        break;
      case "family-mine":
        familyMenu(true);
        break;
      case "family-create":
        openFamily(null, id || selected);
        break;
      case "family-edit":
        openFamily(id);
        break;
      case "family-locate":
        showFamily(id);
        break;
      case "family-branch":
        showFamily(id, true);
        break;
      case "family-owner":
        closeModal();
        project.views[mode].viewport = { ...view };
        project.mode = mode = mode === "unified" ? "unified" : "family";
        project.ui = {
          ...project.ui,
          familyOwner: project.focus,
          familyBranch: "",
        };
        renderAll();
        fitGraph();
        break;
      case "family-all":
        closeModal();
        project.ui = {
          ...project.ui,
          familyBranch: "",
          familyOwner: "",
          foldedFamilies: [],
        };
        renderAll();
        fitGraph();
        break;
      case "family-fold": {
        const folded = new Set(project.ui?.foldedFamilies || []);
        if (folded.has(id)) folded.delete(id);
        else folded.add(id);
        project.ui = { ...project.ui, foldedFamilies: [...folded] };
        persist("가족 접기", false);
        renderAll();
        familyMenu();
        break;
      }
      case "birth-add":
        captureFamilyFields();
        editFamilyDraft.births.push({ id: Kin.id(), children: [], date: "" });
        drawFamilyEditor();
        break;
      case "birth-remove":
        captureFamilyFields();
        editFamilyDraft.births = editFamilyDraft.births.filter(
          (e) => e.id !== id,
        );
        drawFamilyEditor();
        break;
      case "birth-remove-child": {
        captureFamilyFields();
        const birth = editFamilyDraft.births.find(
          (b) => b.id === button.dataset.event,
        );
        birth.children = birth.children.filter((k) => k !== id);
        drawFamilyEditor();
        break;
      }
      case "birth-add-child": {
        captureFamilyFields();
        const input = $(`[data-birth-input="${CSS.escape(id)}"]`),
          child = readChoice(input.value);
        if (Families.childrenOf(editFamilyDraft).includes(child))
          throw Error("이 가족에 이미 등록된 자녀입니다.");
        editFamilyDraft.births.find((b) => b.id === id).children.push(child);
        drawFamilyEditor();
        break;
      }
      case "new-child-photo": {
        const asset = await api("image");
        if (asset) {
          assets[asset.id] = asset.data;
          modalState.childPhoto = asset.id;
          $("#child-photo-status").textContent = "사진 선택됨";
        }
        break;
      }
      case "new-child-add": {
        captureFamilyFields();
        const name = $("#new-child-name").value.trim();
        if (!name) throw Error("새 자녀의 이름을 입력하세요.");
        const p = {
          id: Kin.id(),
          name,
          subtitle: "",
          notes: "",
          gender: "미지정",
          groups: [],
          photo: modalState.childPhoto || "",
        };
        const eventId = $("#new-child-event").value;
        if (eventId)
          editFamilyDraft.births
            .find((b) => b.id === eventId)
            .children.push(p.id);
        else
          editFamilyDraft.births.push({
            id: Kin.id(),
            children: [p.id],
            date: "",
          });
        addedProfiles.push(p);
        drawFamilyEditor();
        break;
      }
      case "family-save":
        saveFamily();
        break;
      case "family-delete-dialog":
        confirmModal(
          "가족 단위 삭제",
          `${esc(familyById(id).name)}에 등록한 관계와 출생 사건을 삭제합니다. 참여 인물은 보존됩니다.`,
          "family-delete",
          id,
        );
        break;
      case "family-delete":
        if (
          commit("가족 단위 삭제", () => {
            Families.remove(project, id);
            pathSelection = null;
          })
        )
          closeModal();
        break;
      case "paths":
        pathFinder();
        break;
      case "path-search":
        searchPaths();
        break;
      case "path-display": {
        const proofs = modalState.foundPaths,
          idx = +button.dataset.index;
        closeModal();
        showProof({ label: "두 인물 사이의 관계", proofs });
        pathIndex = idx;
        renderGraph();
        renderPath();
        break;
      }
      case "family-sample":
        await flush();
        await applyLoad(await api("create", "일곱 가족의 계보", "families"));
        closeModal();
        break;
    }
  } catch (error) {
    if ($("#modal").open) formError(error);
    else toast(error.message, true);
  }
});
function refreshRelationFamilyOptions() {
  const host = $("#relation-family-options");
  if (!host) return;
  const type = $("#rel-type").value;
  if (type !== "parent" || modalState.editing) {
    host.innerHTML = "";
    host.dataset.owner = "";
    return;
  }
  const origin = modalState.relation?.from || modalState.relationAnchor;
  const target = modalState.person?.id || $("#rel-target")?.value;
  const parentId = $("#rel-direction").value === "forward" ? origin : target;
  if (host.dataset.owner === parentId) return;
  host.dataset.owner = parentId;
  const candidates = familyList().filter((f) => f.parents.includes(parentId));
  host.innerHTML = selectField(
    "자녀가 속할 가족 단위",
    "rel-family",
    [
      ["@new", "새 가족 · 선택한 부모 한 명"],
      ...candidates.map((f) => [
        f.id,
        f.name + " · " + f.parents.map(personName).join(" / "),
      ]),
      ["@loose", "개별 부모 관계로 기록"],
    ],
    "@new",
  );
}
function appendConnection(relation) {
  if (
    !["spouse", "former", "parent"].includes(relation.type) ||
    $("#rel-family")?.value === "@loose"
  ) {
    project.relations.push(relation);
    return;
  }
  const existing =
    relation.type === "parent" && familyById($("#rel-family")?.value);
  const f = existing ? Kin.clone(existing) : newFamily(relation.from);
  if (relation.type === "parent") {
    if (Families.childrenOf(f).includes(relation.to))
      throw Error(
        "이 가족에 이미 등록된 자녀입니다. 다른 가족을 선택하거나 개별 관계로 기록하세요.",
      );
    f.births.push({ id: Kin.id(), date: "", children: [relation.to] });
    if (!existing) {
      f.parentKind = relation.parentKind;
      f.union = "none";
    } else {
      const e = Families.facts(f).find(
        (e) =>
          e.from === relation.from &&
          e.to === relation.to &&
          e.type === "parent",
      );
      if (e) f.parentKinds = { ...f.parentKinds, [e.id]: relation.parentKind };
    }
  } else {
    f.parents = [relation.from, relation.to];
    f.union = relation.type;
  }
  if (relation.notes) {
    const edge = Families.facts(f).find(
      (e) =>
        e.type === relation.type &&
        e.from === relation.from &&
        e.to === relation.to,
    );
    if (edge)
      f.relationNotes = { ...f.relationNotes, [edge.id]: relation.notes };
  }
  Families.save(project, f);
  project.views.family.anchors = Families.projectUnits(project).placement;
}
function freeDropPosition(cardId, proposed) {
  const others = projection.nodes.filter((n) => n.id !== cardId);
  const isFree = (p) =>
    others.every(
      (n) =>
        Math.abs(p.x - n.x) >= CARD_W + 6 || Math.abs(p.y - n.y) >= CARD_H + 6,
    );
  if (isFree(proposed)) return { ...proposed };
  const choices = others
    .flatMap((n) => [
      { x: n.x - CARD_W - 10, y: proposed.y },
      { x: n.x + CARD_W + 10, y: proposed.y },
      { x: proposed.x, y: n.y - CARD_H - 10 },
      { x: proposed.x, y: n.y + CARD_H + 10 },
    ])
    .filter(isFree)
    .sort(
      (a, b) =>
        Math.hypot(a.x - proposed.x, a.y - proposed.y) -
        Math.hypot(b.x - proposed.x, b.y - proposed.y),
    );
  return { ...(choices[0] || proposed), pinned: true };
}
function renderFamilyJump() {
  const bar = $("#family-jump");
  bar.hidden = !["family","unified"].includes(mode) || !familyList().length;
  if (bar.hidden) return;
  bar.innerHTML =
    '<select id="family-jump-select" aria-label="가족으로 이동"><option value="">가족으로 이동</option>' +
    familyList()
      .map(
        (f) => '<option value="' + esc(f.id) + '">' + esc(f.name) + "</option>",
      )
      .join("") +
    "</select>" +
    buttonHTML("family-all", "전체 계보", "", "text-button");
}
document.addEventListener("change", (event) => {
  if (event.target.id === "family-jump-select" && event.target.value) {
    const id = event.target.value;
    showFamily(id);
  }
});
// The canvas editor starts the app after registering its drag handlers.
