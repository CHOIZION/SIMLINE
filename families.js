(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Families = api;
})(globalThis, function () {
  "use strict";
  const unique = (values) => [...new Set(values)];
  const parentsOf = (family) => family.parents;
  const childrenOf = (family) =>
    family.births.flatMap((event) => event.children);
  const membersOf = (family) =>
    unique([...parentsOf(family), ...childrenOf(family)]);
  const key = (...parts) => parts.map(encodeURIComponent).join(":");
  const safeId = (id) =>
    typeof id === "string" &&
    id.length > 0 &&
    id.length < 160 &&
    !["__proto__", "constructor", "prototype"].includes(id);
  function facts(family) {
    const children = childrenOf(family);
    const rows = [];
    if (family.parents.length === 2 && family.union !== "none") {
      rows.push({
        id: key("family", family.id, "union"),
        type: family.union,
        from: family.parents[0],
        to: family.parents[1],
      });
    }
    for (const parent of unique(family.parents)) {
      for (const child of unique(children)) {
        rows.push({
          id: key("family", family.id, "parent", parent, child),
          type: "parent",
          from: parent,
          to: child,
          parentKind: family.parentKind,
        });
      }
    }
    return rows.map((row) => ({
      ...row,
      ...(row.type === "parent"
        ? { parentKind: family.parentKinds?.[row.id] || family.parentKind }
        : {}),
      id: family.relationIds?.[row.id] || row.id,
      familyId: family.id,
      notes: family.relationNotes?.[row.id] || "",
    }));
  }
  function checkFamily(family, people) {
    if (
      !family ||
      !safeId(family.id) ||
      typeof family.name !== "string" ||
      !family.name.trim()
    )
      throw Error("가족 이름 또는 식별자가 올바르지 않습니다.");
    if (
      !Array.isArray(family.parents) ||
      family.parents.length > 2 ||
      family.parents.some((id) => !people.has(id))
    )
      throw Error("가족 구성원 참조를 확인하세요.");
    if (
      !["spouse", "former", "none"].includes(family.union) ||
      !["biological", "adoptive", "guardian", "unspecified"].includes(
        family.parentKind,
      )
    )
      throw Error("가족의 관계 종류가 올바르지 않습니다.");
    if (!Array.isArray(family.births))
      throw Error("출생 사건 목록을 확인하세요.");
    const events = new Set(),
      children = new Set();
    for (const event of family.births) {
      if (
        !safeId(event.id) ||
        events.has(event.id) ||
        !Array.isArray(event.children) ||
        !event.children.length
      )
        throw Error("출생 사건에 자녀를 지정하세요.");
      events.add(event.id);
      for (const id of event.children) {
        if (!people.has(id) || children.has(id))
          throw Error(
            "한 가족 안에서 자녀는 한 출생 사건에만 등록할 수 있습니다.",
          );
        children.add(id);
      }
    }
    if (!family.parents.length && !children.size)
      throw Error("가족 구성원 또는 자녀가 필요합니다.");
  }
  function validate(project) {
    if (project.families === undefined) return;
    if (!Array.isArray(project.families))
      throw Error("가족 목록 형식이 올바르지 않습니다.");
    const people = new Set(project.people.map((p) => p.id)),
      ids = new Set(),
      expected = new Map();
    for (const f of project.families) {
      checkFamily(f, people);
      if (ids.has(f.id)) throw Error("가족 ID가 중복되었습니다.");
      ids.add(f.id);
      for (const e of facts(f)) expected.set(e.id, e);
    }
    for (const e of project.relations.filter((e) => e.familyId)) {
      const needed = expected.get(e.id);
      if (
        !needed ||
        ["familyId", "type", "from", "to", "parentKind"].some(
          (k) => needed[k] !== e[k],
        )
      )
        throw Error("가족 단위와 직접 관계가 일치하지 않습니다.");
      expected.delete(e.id);
    }
    if (expected.size) throw Error("가족의 관계 정보가 누락되었습니다.");
  }
  function save(project, family) {
    checkFamily(family, new Set(project.people.map((p) => p.id)));
    project.families ||= [];
    const index = project.families.findIndex((f) => f.id === family.id);
    if (index < 0) project.families.push(family);
    else project.families[index] = family;
    project.relations = project.relations
      .filter((e) => e.familyId !== family.id)
      .concat(facts(family));
  }
  function remove(project, id) {
    project.families = (project.families || []).filter((f) => f.id !== id);
    project.relations = project.relations.filter((e) => e.familyId !== id);
    if (project.ui?.familyBranch === id) project.ui.familyBranch = "";
  }
  function reassign(project, source, target) {
    for (const f of [...(project.families || [])]) {
      if (!membersOf(f).includes(source)) continue;
      const move = (id) => (id === source ? target : id);
      f.parents = f.parents.map(move).filter(Boolean);
      const enrolled = new Set();
      for (const birth of f.births) {
        birth.children = birth.children.map(move).filter((id) => {
          if (!id || enrolled.has(id)) return false;
          enrolled.add(id);
          return true;
        });
      }
      f.births = f.births.filter((b) => b.children.length);
      if (!membersOf(f).length) remove(project, f.id);
      else save(project, f);
    }
  }
  function fixture(Kin) {
    const p = Kin.emptyProject("일곱 가족의 계보");
    p.mode = "family";
    p.focus = "P1";
    p.familyRoot = "P1";
    p.description = "인물 10명 · 일곱 가족 단위 · P7과 P8의 공동 출생 사건";
    for (let i = 1; i <= 10; i++) {
      p.people.push({
        id: "P" + i,
        name: "P" + i,
        groups: [],
        notes: "",
        photo: "",
        subtitle: "",
        gender: "미지정",
        avatar: (i - 1) % 8,
      });
      p.views.network.positions["P" + i] = {
        x:
          i === 1 ? 0 : Math.round(480 * Math.cos(((i - 2) * 2 * Math.PI) / 9)),
        y:
          i === 1 ? 0 : Math.round(350 * Math.sin(((i - 2) * 2 * Math.PI) / 9)),
        pinned: false,
      };
    }
    const units = [
      [2, [3]],
      [3, [4]],
      [4, [5]],
      [5, [6]],
      [6, [7, 8]],
      [7, [9]],
      [8, [10]],
    ];
    units.forEach(([partner, kids], i) =>
      save(p, {
        id: "F" + (i + 1),
        name: "F" + (i + 1),
        parents: ["P1", "P" + partner],
        union: "spouse",
        parentKind: "biological",
        start: "",
        end: "",
        births: [
          { id: "B" + (i + 1), date: "", children: kids.map((n) => "P" + n) },
        ],
      }),
    );
    return p;
  }
  function descendants(project, source) {
    const children = new Map();
    for (const e of project.relations.filter((e) => e.type === "parent")) {
      if (!children.has(e.from)) children.set(e.from, []);
      children.get(e.from).push(e.to);
    }
    const queue = [source],
      seen = new Set(queue);
    for (let i = 0; i < queue.length; i++)
      for (const child of children.get(queue[i]) || [])
        if (!seen.has(child)) {
          seen.add(child);
          queue.push(child);
        }
    return queue.slice(1);
  }
  function familyGraph(project) {
    const units = project.families || [],
      next = new Map(units.map((f) => [f.id, new Set()])),
      dependent = new Map(units.map((f) => [f.id, 0])),
      byParent = new Map();
    for (const f of units)
      for (const id of f.parents) {
        if (!byParent.has(id)) byParent.set(id, []);
        byParent.get(id).push(f.id);
      }
    for (const f of units)
      for (const kid of childrenOf(f))
        for (const id of byParent.get(kid) || []) {
          if (id !== f.id && !next.get(f.id).has(id)) {
            next.get(f.id).add(id);
            dependent.set(id, dependent.get(id) + 1);
          }
        }
    const queue = units.filter((f) => !dependent.get(f.id)).map((f) => f.id),
      levels = new Map(queue.map((id) => [id, 0]));
    for (let i = 0; i < queue.length; i++)
      for (const id of next.get(queue[i])) {
        levels.set(id, Math.max(levels.get(id) || 0, levels.get(queue[i]) + 1));
        dependent.set(id, dependent.get(id) - 1);
        if (!dependent.get(id)) queue.push(id);
      }
    const remaining = units.filter((f) => dependent.get(f.id) > 0);
    const base = Math.max(0, ...levels.values()) + 1;
    remaining.forEach((f, i) => levels.set(f.id, base + i));
    return { levels, next };
  }
  function branchIds(graph, root, maxDepth = Infinity) {
    if (!root) return null;
    const queue = [root], levels = new Map([[root, 0]]);
    for (let i = 0; i < queue.length; i++) {
      const current = queue[i], level = levels.get(current);
      if (level >= maxDepth) continue;
      for (const next of graph.next.get(current) || []) {
        if (levels.has(next)) continue;
        levels.set(next, level + 1);
        queue.push(next);
      }
    }
    return new Set(queue);
  }
  // Return true only for an orthogonal segment crossing a rectangle's interior.
  function crosses(a, b, box) {
    const right = box.x + box.w,
      bottom = box.y + box.h;
    if (a.x === b.x)
      return (
        a.x > box.x &&
        a.x < right &&
        Math.max(a.y, b.y) > box.y &&
        Math.min(a.y, b.y) < bottom
      );
    if (a.y === b.y)
      return (
        a.y > box.y &&
        a.y < bottom &&
        Math.max(a.x, b.x) > box.x &&
        Math.min(a.x, b.x) < right
      );
    return true;
  }
  function route(start, end, boxes, preferred = []) {
    const clear = (a, b) => !boxes.some((box) => crosses(a, b, box));
    const clean = (points) =>
      points.filter(
        (p, i) => !i || p.x !== points[i - 1].x || p.y !== points[i - 1].y,
      );
    function usable(points) {
      return points.every((p, i) => !i || clear(points[i - 1], p));
    }
    const candidates = [
      preferred,
      [{ x: start.x, y: end.y }],
      [{ x: end.x, y: start.y }],
    ];
    for (const via of candidates) {
      const points = clean([start, ...via, end]);
      if (usable(points)) return points;
    }
    // Visibility graph on obstacle boundaries. Each grid edge is checked before use.
    const xs = unique([
      start.x,
      end.x,
      ...boxes.flatMap((b) => [b.x - 8, b.x + b.w + 8]),
    ]).sort((a, b) => a - b);
    const ys = unique([
      start.y,
      end.y,
      ...boxes.flatMap((b) => [b.y - 8, b.y + b.h + 8]),
    ]).sort((a, b) => a - b);
    const first = ys.indexOf(start.y) * xs.length + xs.indexOf(start.x),
      last = ys.indexOf(end.y) * xs.length + xs.indexOf(end.x);
    const toPoint = (k) => ({
      x: xs[k % xs.length],
      y: ys[Math.floor(k / xs.length)],
    });
    const prev = new Map([[first, null]]),
      queue = [first];
    for (let n = 0; n < queue.length && n < 80000; n++) {
      const here = queue[n],
        x = here % xs.length,
        y = Math.floor(here / xs.length);
      if (here === last) {
        const points = [];
        for (let k = last; k !== null; k = prev.get(k)) points.push(toPoint(k));
        return points.reverse();
      }
      for (const [nx, ny] of [
        [x + 1, y],
        [x - 1, y],
        [x, y + 1],
        [x, y - 1],
      ]) {
        if (nx < 0 || ny < 0 || nx >= xs.length || ny >= ys.length) continue;
        const k = ny * xs.length + nx;
        if (!prev.has(k) && clear(toPoint(here), toPoint(k))) {
          prev.set(k, here);
          queue.push(k);
        }
      }
    }
    return [];
  }
  function projectUnits(project, options = {}) {
    const units = project.families || [],
      graph = familyGraph(project);
    const branch = branchIds(graph, project.ui?.familyBranch, project.settings.familyDepth || 4);
    const folded = new Set(
      options.network && !options.sharedCouple ? [] : project.ui?.foldedFamilies || [],
    );
    const owner = project.ui?.familyOwner;
    const selected = units.filter(
      (f) =>
        (!branch || branch.has(f.id)) &&
        (!owner || membersOf(f).includes(owner)),
    );
    const nodes = [],
      edges = [],
      junctions = [],
      segments = [],
      rects = [],
      seen = new Set(),
      byPerson = new Map();
    const network = options.network === true;
    const positions = project.views.family.positions;
    const anchors = project.views.family.anchors || {};
    const levelColumns = new Map(),
      usedSpaces = [];
    const unitWidth = (f) =>
      Math.max(2, f.parents.length, childrenOf(f).length) * 224 + 60;
    function node(familyId, role, id, x, y, level) {
      if (network && byPerson.has(id)) return byPerson.get(id);
      const cardId = network ? id : key("unit", familyId, role, id);
      const n = {
        id: cardId,
        person: id,
        x,
        y,
        level,
        unitId: familyId,
        reference: seen.has(id),
        ...(network ? project.views.network.positions[id] : positions[cardId]),
      };
      nodes.push(n);
      seen.add(id);
      if (!byPerson.has(id)) byPerson.set(id, n);
      return n;
    }
    const placement = {};
    // Reserve existing units first. Adding a unit never moves its neighbours.
    for (const f of units) {
      if (!anchors[f.id]) continue;
      const a = anchors[f.id];
      usedSpaces.push({ id: f.id, x: a.x, y: a.y, w: unitWidth(f), h: 420 });
    }
    for (const f of units) {
      const level = graph.levels.get(f.id) || 0,
        width = unitWidth(f);
      let a = anchors[f.id];
      if (!a) {
        const y = level * 455;
        let x = levelColumns.get(level) || 0;
        while (
          usedSpaces.some(
            (b) =>
              x < b.x + b.w + 40 &&
              x + width + 40 > b.x &&
              y < b.y + b.h &&
              y + 420 > b.y,
          )
        )
          x += 100;
        a = { x, y };
        usedSpaces.push({ id: f.id, x, y, w: width, h: 420 });
        levelColumns.set(level, x + width + 55);
      }
      placement[f.id] = { x: a.x, y: a.y };
      if (!selected.includes(f)) continue;
      const center = a.x + width / 2,
        parents = f.parents.map((id, i) =>
          node(
            f.id,
            "parent" + i,
            id,
            center + (i - (f.parents.length - 1) / 2) * 224 - 94,
            a.y + 36,
            level,
          ),
        );
      const kids = childrenOf(f),
        children = folded.has(f.id)
          ? []
          : kids.map((id, i) =>
              node(
                f.id,
                "child",
                id,
                center + (i - (kids.length - 1) / 2) * 224 - 94,
                a.y + 256,
                level + 1,
              ),
            );
      const unit = {
        id: f.id,
        name: f.name,
        record: f,
        x: a.x,
        y: a.y,
        width,
        height: folded.has(f.id) ? 236 : 412,
        center: { x: center, y: a.y + 202 },
        parents,
        children,
        folded: folded.has(f.id),
        count: kids.length,
      };
      junctions.push(unit);
    }
    if (!branch && !owner) {
      const enrolled = new Set(units.flatMap(membersOf)),
        maxX = Math.max(0, ...usedSpaces.map((b) => b.x + b.w)) + 92;
      let index = 0;
      for (const p of project.people)
        if (!enrolled.has(p.id)) {
          node(
            "loose",
            "person",
            p.id,
            maxX + (index % 3) * 224,
            Math.floor(index / 3) * 180,
            null,
          );
          index++;
        }
    }
    for (const n of nodes) rects.push({ x: n.x, y: n.y, w: 188, h: 132 });
    const relations = new Map(project.relations.map((e) => [e.id, e]));
    function line(from, to, via, owned, type, unitId) {
      const points = route(from, to, rects, via);
      segments.push({ points, owned, type, unitId, blocked: !points.length });
    }
    for (const u of junctions) {
      // Find a free junction if a hand-placed card covers its default position.
      while (
        rects.some(
          (b) =>
            u.center.x >= b.x - 3 &&
            u.center.x <= b.x + b.w + 3 &&
            u.center.y >= b.y - 3 &&
            u.center.y <= b.y + b.h + 3,
        )
      )
        u.center.x += 24;
      const f = units.find((f) => f.id === u.id),
        factsForUnit = facts(f),
        children = childrenOf(f);
      const union = factsForUnit.find((e) => e.type !== "parent");
      if (u.parents.length === 2) {
        const [a, b] = u.parents;
        const horizontal =
          Math.abs(b.x - a.x) / 188 >= Math.abs(b.y - a.y) / 132;
        const start = horizontal
          ? { x: a.x + (b.x >= a.x ? 188 : 0), y: a.y + 66 }
          : { x: a.x + 94, y: a.y + (b.y >= a.y ? 132 : 0) };
        const end = horizontal
          ? { x: b.x + (b.x >= a.x ? 0 : 188), y: b.y + 66 }
          : { x: b.x + 94, y: b.y + (b.y >= a.y ? 0 : 132) };
        const offset = a.id === b.id ? 36 : 0;
        if (offset) {
          start.x = a.x + 188;
          start.y = a.y + 40;
          end.x = a.x + 188;
          end.y = a.y + 90;
        }
        const via = offset
          ? [
              { x: start.x + offset, y: start.y },
              { x: end.x + offset, y: end.y },
            ]
          : horizontal
            ? [
                { x: (start.x + end.x) / 2, y: start.y },
                { x: (start.x + end.x) / 2, y: end.y },
              ]
            : [
                { x: start.x, y: (start.y + end.y) / 2 },
                { x: end.x, y: (start.y + end.y) / 2 },
              ];
        const shared = options.sharedCouple?.(u, units, rects);
        const points = shared?.points || route(start, end, rects, via);
        if (points.length > 1) {
          const lengths = points
            .slice(1)
            .map(
              (p, i) =>
                Math.abs(p.x - points[i].x) + Math.abs(p.y - points[i].y),
            );
          let remaining = shared?.cut ?? lengths.reduce((a, b) => a + b, 0) / 2,
            cut = 0;
          while (cut < lengths.length - 1 && remaining > lengths[cut])
            remaining -= lengths[cut++];
          const a0 = points[cut],
            b0 = points[cut + 1],
            ratio = remaining / (lengths[cut] || 1);
          u.center = {
            x: a0.x + (b0.x - a0.x) * ratio,
            y: a0.y + (b0.y - a0.y) * ratio,
          };
          for (const [index, half] of [
            [0, [...points.slice(0, cut + 1), u.center]],
            [1, [u.center, ...points.slice(cut + 1)]],
          ]) {
            const owned = factsForUnit
              .filter(
                (e) =>
                  e.type === "parent" && e.from === u.parents[index].person,
              )
              .map((e) => e.id);
            if (union) owned.push(union.id);
            segments.push({
              points: half,
              owned,
              type: union?.type || "parent",
              unitId: u.id,
            });
          }
        } else
          segments.push({
            points: [],
            owned: [],
            type: "parent",
            unitId: u.id,
            blocked: true,
          });
      } else if (u.parents.length) {
        const n = u.parents[0],
          start = { x: n.x + 94, y: n.y + 132 };
        u.center = { x: start.x, y: start.y + 24 };
        if (rects.some((b) => crosses(start, u.center, b))) u.center = start;
        line(
          start,
          u.center,
          [],
          factsForUnit.map((e) => e.id),
          "parent",
          u.id,
        );
      }
      for (const n of u.children) {
        const dx = n.x + 94 - u.center.x,
          dy = n.y + 66 - u.center.y;
        const sideEntry =
          !options.sharedCouple && (network || n.pinned || u.parents.some((p) => p.pinned)) &&
          Math.abs(dx) / 188 > Math.abs(dy) / 132;
        let end, via;
        if (sideEntry) {
          end = { x: dx >= 0 ? n.x : n.x + 188, y: n.y + 66 };
          const x = (u.center.x + end.x) / 2;
          via = [
            { x, y: u.center.y },
            { x, y: end.y },
          ];
        } else {
          end =
            n.y >= u.center.y
              ? { x: n.x + 94, y: n.y }
              : { x: n.x + 94, y: n.y + 132 };
          const y =
            n.y >= u.center.y
              ? Math.max(u.center.y + 18, n.y - 28)
              : Math.min(u.center.y - 18, end.y + 28);
          via = [
            { x: u.center.x, y },
            { x: end.x, y },
          ];
        }
        line(
          u.center,
          end,
          via,
          factsForUnit
            .filter((e) => e.type === "parent" && e.to === n.person)
            .map((e) => e.id),
          "parent",
          u.id,
        );
      }
    }
    if (!network) {
      const origins = new Map();
      for (const u of junctions)
        for (const child of u.children) {
          if (!origins.has(child.person)) origins.set(child.person, []);
          origins.get(child.person).push({ unit: u.id, card: child });
        }
      for (const u of junctions)
        for (const parent of u.parents)
          for (const from of origins.get(parent.person) || []) {
            if (from.unit === u.id) continue;
            const a = { x: from.card.x + 94, y: from.card.y + 132 },
              b = { x: parent.x + 94, y: parent.y };
            const middle = (a.y + b.y) / 2;
            line(
              a,
              b,
              [
                { x: a.x, y: middle },
                { x: b.x, y: middle },
              ],
              [],
              "reference",
              u.id,
            );
            segments.at(-1).person = parent.person;
          }
    }
    for (const r of relations.values()) {
      if (r.familyId) continue;
      const a = byPerson.get(r.from),
        b = byPerson.get(r.to);
      if (!a || !b) continue;
      const start = { x: a.x + 188, y: a.y + 48 },
        end = { x: b.x + 188, y: b.y + 78 };
      const right = Math.max(start.x, end.x) + 20;
      line(
        start,
        end,
        [
          { x: right, y: start.y },
          { x: right, y: end.y },
        ],
        [r.id],
        r.type,
        null,
      );
    }
    return { nodes, edges, junctions, segments, placement, truncated: false };
  }
  function findPaths(project, from, to, depth = 6) {
    const adjacency = new Map(project.people.map((p) => [p.id, []]));
    for (const e of project.relations) {
      adjacency.get(e.from)?.push({ next: e.to, id: e.id });
      if (e.from !== e.to)
        adjacency.get(e.to)?.push({ next: e.from, id: e.id });
    }
    const paths = [],
      queue = [{ people: [from], edges: [] }];
    let work = 0,
      partial = false;
    outer: for (let i = 0; i < queue.length; i++) {
      const path = queue[i];
      if (path.edges.length >= depth) continue;
      for (const step of adjacency.get(path.people.at(-1)) || []) {
        if (++work > 50000 || paths.length >= 50) {
          partial = true;
          break outer;
        }
        if (path.people.includes(step.next)) continue;
        const newPath = {
          people: [...path.people, step.next],
          edges: [...path.edges, step.id],
        };
        if (step.next === to) paths.push(newPath);
        else queue.push(newPath);
      }
    }
    return { paths, partial };
  }
  function legacyUnits(project) {
    const units = [],
      consumed = new Set(),
      groups = new Map(),
      people = new Map(project.people.map((p) => [p.id, p.name]));
    const manual = project.relations.filter((r) => !r.familyId);
    const byChild = new Map();
    for (const r of manual.filter((r) => r.type === "parent")) {
      if (!byChild.has(r.to)) byChild.set(r.to, []);
      byChild.get(r.to).push(r);
    }
    const coupleEdges = manual.filter(
      (r) => r.type === "spouse" || r.type === "former",
    );
    function create(parents, couple) {
      let number = units.length + 1;
      while (
        [...(project.families || []), ...units].some(
          (f) => f.id === "L" + number,
        )
      )
        number++;
      const family = {
        id: "L" + number,
        name: parents.map((id) => people.get(id)).join(" · "),
        parents,
        union: couple?.type || "none",
        parentKind: "unspecified",
        births: [],
        start: "",
        end: "",
        relationIds: {},
        relationNotes: {},
        parentKinds: {},
      };
      if (couple) {
        const id = key("family", family.id, "union");
        family.relationIds[id] = couple.id;
        family.relationNotes[id] = couple.notes || "";
        family.parents = [couple.from, couple.to];
        consumed.add(couple.id);
      }
      units.push(family);
      return family;
    }
    for (const [child, rows] of byChild) {
      const parents = unique(rows.map((r) => r.from)).sort();
      if (parents.length > 2 || parents.length !== rows.length) continue;
      const group = JSON.stringify(parents);
      if (!groups.has(group)) {
        const spouse =
          parents.length === 2 &&
          coupleEdges.find(
            (r) =>
              !consumed.has(r.id) &&
              parents.includes(r.from) &&
              parents.includes(r.to) &&
              r.from !== r.to,
          );
        groups.set(group, create(parents, spouse));
      }
      const family = groups.get(group);
      family.births.push({
        id: "B" + (family.births.length + 1),
        children: [child],
        date: "",
      });
      for (const r of rows) {
        const id = key("family", family.id, "parent", r.from, child);
        family.relationIds[id] = r.id;
        family.relationNotes[id] = r.notes || "";
        family.parentKinds[id] = r.parentKind || "unspecified";
        consumed.add(r.id);
      }
    }
    for (const r of coupleEdges)
      if (!consumed.has(r.id)) create([r.from, r.to], r);
    return { units, consumed };
  }
  function adoptLegacy(project, model) {
    project.relations = project.relations.filter(
      (r) => !model.consumed.has(r.id),
    );
    for (const f of model.units) save(project, f);
  }
  function legacyProjection(project, options) {
    const model = legacyUnits(project);
    if (!model.units.length) return null;
    const temporary = {
      ...project,
      families: [...model.units],
      relations: project.relations
        .filter((r) => !model.consumed.has(r.id))
        .concat(model.units.flatMap(facts)),
    };
    const result = projectUnits(temporary, options);
    result.legacy = true;
    return result;
  }
  return {
    legacyUnits,
    adoptLegacy,
    legacyProjection,
    childrenOf,
    membersOf,
    facts,
    validate,
    save,
    remove,
    reassign,
    fixture,
    descendants,
    familyGraph,
    branchIds,
    projectUnits,
    crosses,
    route,
    findPaths,
  };
});
