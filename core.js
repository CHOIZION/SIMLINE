(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Kin = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  const Family =
    typeof module !== "undefined" && module.exports
      ? require("./families.js")
      : globalThis.Families;
  const TYPES = {
    former: {
      name: "이전 배우자",
      forward: "이전 배우자",
      reverse: "이전 배우자",
      color: "#a893ac",
    },
    parent: {
      name: "부모 → 자녀",
      forward: "자녀",
      reverse: "부모",
      color: "#8ebda6",
      directed: true,
    },
    spouse: {
      name: "배우자",
      forward: "배우자",
      reverse: "배우자",
      color: "#c8a2da",
    },
    sibling: {
      name: "형제자매",
      forward: "형제자매",
      reverse: "형제자매",
      color: "#87add8",
    },
    lover: { name: "연인", forward: "연인", reverse: "연인", color: "#e397a5" },
    friend: {
      name: "친구",
      forward: "친구",
      reverse: "친구",
      color: "#d5b779",
    },
    colleague: {
      name: "동료",
      forward: "동료",
      reverse: "동료",
      color: "#8ebbc8",
    },
    rival: {
      name: "라이벌",
      forward: "라이벌",
      reverse: "라이벌",
      color: "#d48b76",
    },
    custom: {
      name: "기타 관계",
      forward: "관계",
      reverse: "관계",
      color: "#aaadbf",
    },
  };
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const id = () => globalThis.crypto.randomUUID();
  function emptyProject(name = "새로운 이야기") {
    return {
      schema: 1,
      id: id(),
      name,
      description: "",
      people: [],
      relations: [],
      groups: [],
      families: [],
      views: {
        network: { positions: {}, viewport: null },
        family: { positions: {}, viewport: null },
        unified: { positions: {}, viewport: null },
      },
      focus: null,
      mode: "network",
      settings: { depth: 6, includeAdoptive: true },
      revision: 0,
    };
  }
  function validate(p) {
    if (
      !p ||
      p.schema !== 1 ||
      typeof p.id !== "string" ||
      typeof p.name !== "string" ||
      !p.name.trim()
    )
      throw Error("지원하지 않는 프로젝트 형식입니다.");
    if (
      !Array.isArray(p.people) ||
      !Array.isArray(p.relations) ||
      !Array.isArray(p.groups)
    )
      throw Error("프로젝트 목록 형식이 올바르지 않습니다.");
    if (p.people.length > 50000 || p.relations.length > 250000)
      throw Error(
        "가져오기 한도(인물 50,000명 / 관계 250,000개)를 초과했습니다.",
      );
    const ids = new Set(),
      rids = new Set(),
      gids = new Set();
    const safeId = (s) =>
      typeof s === "string" &&
      s.length > 0 &&
      s.length < 500 &&
      !["__proto__", "constructor", "prototype"].includes(s);
    for (const g of p.groups) {
      if (!g || !safeId(g.id) || typeof g.name !== "string" || gids.has(g.id))
        throw Error("그룹 정보가 잘못되었습니다.");
      gids.add(g.id);
    }
    for (const n of p.people) {
      if (
        !n ||
        !safeId(n.id) ||
        ids.has(n.id) ||
        typeof n.name !== "string" ||
        !n.name.trim()
      )
        throw Error("인물 ID 또는 이름이 잘못되었습니다.");
      if (!Array.isArray(n.groups) || n.groups.some((g) => !gids.has(g)))
        throw Error("존재하지 않는 그룹을 참조합니다.");
      for (const k of ["subtitle", "gender", "notes", "photo"])
        if (n[k] !== undefined && typeof n[k] !== "string")
          throw Error("인물 프로필 형식이 잘못되었습니다.");
      if (
        n.avatar !== undefined &&
        (!Number.isInteger(n.avatar) || n.avatar < 0 || n.avatar > 7)
      )
        throw Error("기본 초상화 번호가 잘못되었습니다.");
      if (
        n.crop &&
        (!["x", "y", "zoom"].every((k) => Number.isFinite(n.crop[k])) ||
          n.crop.zoom < 1 ||
          n.crop.zoom > 3 ||
          Math.abs(n.crop.x) > 100 ||
          Math.abs(n.crop.y) > 100)
      )
        throw Error("사진 자르기 값이 잘못되었습니다.");
      if (
        n.externalId !== undefined &&
        (typeof n.externalId !== "string" || n.externalId.length > 200)
      )
        throw Error("외부 연동 ID 형식이 잘못되었습니다.");
      if (
        n.sims4 !== undefined &&
        (!n.sims4 || typeof n.sims4 !== "object" || Array.isArray(n.sims4))
      )
        throw Error("심즈 4 연동 메타데이터 형식이 잘못되었습니다.");
      ids.add(n.id);
    }
    for (const r of p.relations) {
      if (
        !r ||
        !safeId(r.id) ||
        rids.has(r.id) ||
        !ids.has(r.from) ||
        !ids.has(r.to) ||
        !Object.hasOwn(TYPES, r.type)
      )
        throw Error(
          "관계가 존재하지 않는 인물을 참조하거나 형식이 잘못되었습니다.",
        );
      if (r.label !== undefined && typeof r.label !== "string")
        throw Error("관계 이름이 잘못되었습니다.");
      rids.add(r.id);
    }
    if (p.mode && !["network", "family", "unified"].includes(p.mode))
      throw Error("보기 모드가 올바르지 않습니다.");
    if (
      !p.settings ||
      (p.settings.depth !== undefined &&
        (!Number.isInteger(p.settings.depth) ||
          p.settings.depth < 2 ||
          p.settings.depth > 10))
    )
      throw Error("계산 설정이 올바르지 않습니다.");
    if (!p.views || !p.views.network || !p.views.family)
      throw Error("보기 정보가 누락되었습니다.");
    for (const mode of ["network", "family", ...(p.views.unified ? ["unified"] : [])]) {
      const v = p.views[mode];
      if (!v.positions || typeof v.positions !== "object")
        throw Error("위치 정보가 잘못되었습니다.");
      for (const pos of Object.values(v.positions))
        if (
          !pos ||
          !Number.isFinite(pos.x) ||
          !Number.isFinite(pos.y) ||
          Math.abs(pos.x) > 1e7 ||
          Math.abs(pos.y) > 1e7
        )
          throw Error("유효하지 않은 카드 좌표입니다.");
      if (
        v.viewport &&
        (!["x", "y", "scale"].every((k) => Number.isFinite(v.viewport[k])) ||
          v.viewport.scale < 0.05 ||
          v.viewport.scale > 5)
      )
        throw Error("화면 확대 값이 잘못되었습니다.");
    }
    Family.validate(p);
    return p;
  }
  function labelRelation(r, from) {
    return r.type === "custom"
      ? r.label || "관계"
      : TYPES[r.type][r.from === from ? "forward" : "reverse"];
  }
  function patterns(depth) {
    const m = new Map();
    const add = (s, label) => {
      if (s.length <= depth) m.set(s, label);
    };
    for (let n = 1; n <= depth; n++) {
      add(
        "U".repeat(n),
        ["", "부모", "조부모", "증조부모", "고조부모"][n] || `${n}세대 위 조상`,
      );
      add(
        "D".repeat(n),
        ["", "자녀", "손자녀", "증손자녀", "현손자녀"][n] ||
          `${n}세대 아래 후손`,
      );
    }
    for (let u = 1; u < depth; u++)
      for (let d = 1; d <= depth - u; d++) {
        let label =
          u === 1 && d === 1
            ? "형제자매"
            : u === 2 && d === 1
              ? "부모의 형제자매"
              : u === 1 && d === 2
                ? "조카"
                : u === 2 && d === 2
                  ? "사촌"
                  : u === 1 && d === 3
                    ? "형제자매의 손자녀"
                    : u === 3 && d === 1
                      ? "조부모의 형제자매"
                      : `공통 조상 친족 (위 ${u} · 아래 ${d})`;
        add("U".repeat(u) + "D".repeat(d), label);
      }
    add("S", "형제자매");
    add("SD", "조카");
    add("SDD", "형제자매의 손자녀");
    add("US", "부모의 형제자매");
    add("USD", "사촌");
    add("UUS", "조부모의 형제자매");
    add("M", "배우자");
    add("MU", "배우자의 부모");
    add("MUU", "배우자의 조부모");
    add("MD", "배우자의 자녀");
    add("MDD", "배우자의 손자녀");
    add("UM", "부모의 배우자");
    add("UUM", "조부모의 배우자");
    add("DM", "자녀의 배우자");
    add("DDM", "손자녀의 배우자");
    add("MS", "배우자의 형제자매");
    add("MUD", "배우자의 형제자매");
    add("SM", "형제자매의 배우자");
    add("UDM", "형제자매의 배우자");
    return m;
  }
  function infer(project, focus, options = {}) {
    const depth = Math.max(2, Math.min(10, options.depth || 6)),
      limit = options.limit || 50000;
    const rules = patterns(depth),
      prefixes = new Set([""]);
    for (const s of rules.keys())
      for (let n = 1; n <= s.length; n++) prefixes.add(s.slice(0, n));
    const adj = new Map(project.people.map((p) => [p.id, []])),
      found = new Map(),
      cycles = [];
    for (const r of project.relations) {
      if (!adj.has(r.from) || !adj.has(r.to)) continue;
      if (r.from === focus || r.to === focus) {
        const other = r.from === focus ? r.to : r.from;
        const label = labelRelation(r, focus),
          key = other + "|" + label + "|direct";
        if (!found.has(key))
          found.set(key, {
            person: other,
            label,
            kind: "direct",
            proofs: [],
            count: 0,
          });
        const item = found.get(key);
        item.proofs.push({
          people: [focus, other],
          edges: [r.id],
          steps: [label],
          parentKinds:
            r.type === "parent" ? [r.parentKind || "unspecified"] : [],
        });
        item.count++;
      }
      let codes =
        r.type === "parent"
          ? ["D", "U"]
          : r.type === "sibling"
            ? ["S", "S"]
            : r.type === "spouse"
              ? ["M", "M"]
              : null;
      if (!codes) continue;
      if (
        r.type === "parent" &&
        options.includeAdoptive === false &&
        ["adoptive", "guardian"].includes(r.parentKind)
      )
        continue;
      adj
        .get(r.from)
        .push({
          to: r.to,
          code: codes[0],
          edge: r.id,
          pk: r.type === "parent" ? r.parentKind || "unspecified" : null,
        });
      if (r.from !== r.to)
        adj
          .get(r.to)
          .push({
            to: r.from,
            code: codes[1],
            edge: r.id,
            pk: r.type === "parent" ? r.parentKind || "unspecified" : null,
          });
    }
    for (const f of project.families || [])
      for (const birth of f.births) {
        if (!birth.children.includes(focus) || birth.children.length < 2)
          continue;
        const label =
          birth.children.length === 2 ? "쌍둥이 형제자매" : "다태아 형제자매";
        const unitFacts = Family.facts(f);
        for (const sibling of birth.children.filter((id) => id !== focus)) {
          const key = JSON.stringify([sibling, label, "inferred"]);
          if (!found.has(key))
            found.set(key, {
              person: sibling,
              label,
              kind: "inferred",
              proofs: [],
              count: 0,
            });
          const item = found.get(key);
          const proof = {
            birthEvent: f.name + " · " + birth.id,
            people: [focus, sibling],
            edges: [],
            steps: ["동일 출생 사건"],
            parentKinds: [],
          };
          for (const parent of new Set(f.parents)) {
            const first = unitFacts.find(
              (r) => r.type === "parent" && r.from === parent && r.to === focus,
            );
            const second = unitFacts.find(
              (r) =>
                r.type === "parent" && r.from === parent && r.to === sibling,
            );
            if (!first || !second || [focus, sibling].includes(parent))
              continue;
            proof.people = [focus, parent, sibling];
            proof.edges = [first.id, second.id];
            proof.steps = ["부모", "자녀"];
            proof.parentKinds = [first.parentKind, second.parentKind];
            break;
          }
          item.count++;
          item.proofs.push(proof);
        }
      }
    const profiles = new Map(project.people.map((p) => [p.id, p]));
    const bioParents = new Map();
    for (const e of project.relations)
      if (e.type === "parent" && e.parentKind === "biological") {
        if (!bioParents.has(e.to)) bioParents.set(e.to, new Set());
        bioParents.get(e.to).add(e.from);
      }
    const queue = [
      {
        at: focus,
        pattern: "",
        people: [focus],
        edges: [],
        steps: [],
        parentKinds: [],
      },
    ];
    let cursor = 0,
      states = 0,
      truncated = false,
      depthLimited = false;
    const stepName = { U: "부모", D: "자녀", S: "형제자매", M: "배우자" };
    outer: while (cursor < queue.length) {
      const q = queue[cursor++];
      for (const n of adj.get(q.at) || []) {
        if (q.edges.includes(n.edge)) continue;
        const pattern = q.pattern + n.code;
        if (!prefixes.has(pattern)) continue;
        if (++states > limit) {
          truncated = true;
          break outer;
        }
        if (q.people.includes(n.to)) {
          if (cycles.length < 24)
            cycles.push({
              people: [...q.people, n.to],
              edges: [...q.edges, n.edge],
              steps: [...q.steps, stepName[n.code]],
              parentKinds: q.parentKinds,
            });
          continue;
        }
        const state = {
          at: n.to,
          pattern,
          people: [...q.people, n.to],
          edges: [...q.edges, n.edge],
          steps: [...q.steps, stepName[n.code]],
          parentKinds: n.pk ? [...q.parentKinds, n.pk] : q.parentKinds,
        };
        if (pattern.length > 1 && rules.has(pattern)) {
          const labels = [rules.get(pattern)];
          if (
            pattern === "UD" &&
            state.parentKinds.every((k) => k === "biological")
          ) {
            const first = bioParents.get(focus) || new Set(),
              second = bioParents.get(n.to) || new Set();
            const shared = [...first].filter((id) => second.has(id));
            if (first.size === 2 && second.size === 2 && shared.length === 1) {
              const gender = profiles.get(shared[0])?.gender;
              labels.push(
                gender === "남성"
                  ? "이복형제자매"
                  : gender === "여성"
                    ? "이부형제자매"
                    : "한쪽 부모를 공유하는 형제자매",
              );
            }
          }
          if (pattern === "US" || pattern === "UUD") {
            const parent = profiles.get(state.people[1]),
              relative = profiles.get(n.to);
            if (relative.gender === "여성" && parent.gender === "여성")
              labels.push("이모");
            if (relative.gender === "여성" && parent.gender === "남성")
              labels.push("고모");
            if (relative.gender === "남성") {
              labels.push(parent.gender === "여성" ? "외삼촌" : "삼촌");
              if (
                parent.gender === "남성" &&
                parent.birthDate &&
                relative.birthDate &&
                parent.birthDate !== relative.birthDate
              )
                labels.push(
                  parent.birthDate < relative.birthDate ? "숙부" : "백부",
                );
            }
          }
          for (const label of labels) {
            const key = JSON.stringify([n.to, label, "inferred"]);
            if (!found.has(key))
              found.set(key, {
                person: n.to,
                label,
                kind: "inferred",
                proofs: [],
                count: 0,
              });
            const item = found.get(key);
            item.count++;
            item.proofs.push(state);
          }
        }
        if (pattern.length < depth) queue.push(state);
        else if (
          (adj.get(n.to) || []).some((e) => !state.people.includes(e.to))
        )
          depthLimited = true;
      }
    }
    return {
      focus,
      depth,
      states: Math.min(states, limit),
      truncated,
      depthLimited,
      cycles,
      results: [...found.values()].sort(
        (a, b) =>
          (a.kind === "direct" ? 0 : 1) - (b.kind === "direct" ? 0 : 1) ||
          a.proofs[0].edges.length - b.proofs[0].edges.length ||
          a.label.localeCompare(b.label, "ko"),
      ),
    };
  }
  function localPosition(
    p,
    anchor,
    positions,
    cardWidth = 188,
    cardHeight = 130,
  ) {
    const existing = Object.values(positions),
      base = anchor || { x: 0, y: 0 };
    for (let ring = 1; ring < 100; ring++)
      for (let i = 0; i < 8 * ring; i++) {
        const a = (i / (8 * ring)) * Math.PI * 2,
          x = base.x + Math.cos(a) * ring * (cardWidth + 70),
          y = base.y + Math.sin(a) * ring * (cardHeight + 70);
        if (
          existing.every(
            (v) =>
              Math.abs(v.x - x) > cardWidth + 28 ||
              Math.abs(v.y - y) > cardHeight + 28,
          )
        )
          return { x: Math.round(x), y: Math.round(y), pinned: false };
      }
    return { x: base.x + existing.length * 250, y: base.y, pinned: false };
  }
  function networkLayout(project, positions = {}, options = {}) {
    const ids = project.people.map((x) => x.id),
      map = new Map(
        ids.map((n, i) => [
          n,
          {
            ...(positions[n] || {
              x: Math.cos(i * 2.399) * Math.sqrt(i + 1) * 250,
              y: Math.sin(i * 2.399) * Math.sqrt(i + 1) * 190,
            }),
            id: n,
          },
        ]),
      );
    const movable = options.only ? new Set(options.only) : new Set(ids),
      focus = options.focus;
    if (
      focus &&
      map.has(focus) &&
      !map.get(focus).pinned &&
      movable.has(focus)
    ) {
      map.get(focus).x = 0;
      map.get(focus).y = 0;
    }
    const nodes = [...map.values()],
      springs = project.relations.filter(
        (r) => r.from !== r.to && map.has(r.from) && map.has(r.to),
      );
    const iterations = nodes.length > 500 ? 35 : 110;
    for (let t = 0; t < iterations; t++) {
      const delta = new Map(ids.map((n) => [n, { x: 0, y: 0 }]));
      // Spatial grid limits collision work for large projects.
      const grid = new Map();
      for (const a of nodes) {
        let k = Math.floor(a.x / 330) + "," + Math.floor(a.y / 240);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(a);
      }
      for (const a of nodes) {
        const gx = Math.floor(a.x / 330),
          gy = Math.floor(a.y / 240),
          d = delta.get(a.id);
        for (let ix = gx - 1; ix <= gx + 1; ix++)
          for (let iy = gy - 1; iy <= gy + 1; iy++)
            for (const b of grid.get(ix + "," + iy) || []) {
              if (a === b) continue;
              let dx = a.x - b.x,
                dy = a.y - b.y;
              if (Math.abs(dx) < 242 && Math.abs(dy) < 190) {
                if (Math.abs(dx) + Math.abs(dy) < 0.1) {
                  dx = a.id < b.id ? 1 : -1;
                  dy = 1;
                }
                const ox = 242 - Math.abs(dx),
                  oy = 190 - Math.abs(dy);
                if (ox < oy * 1.3) d.x += Math.sign(dx) * ox * 0.24;
                else d.y += Math.sign(dy) * oy * 0.24;
              }
            }
      }
      for (const r of springs) {
        const a = map.get(r.from),
          b = map.get(r.to),
          dx = b.x - a.x,
          dy = b.y - a.y,
          len = Math.max(1, Math.hypot(dx, dy)),
          f = (len - 310) * 0.018;
        delta.get(a.id).x += (dx / len) * f;
        delta.get(a.id).y += (dy / len) * f;
        delta.get(b.id).x -= (dx / len) * f;
        delta.get(b.id).y -= (dy / len) * f;
      }
      for (const a of nodes) {
        if (a.pinned || !movable.has(a.id) || focus === a.id) continue;
        const d = delta.get(a.id);
        a.x += Math.max(-28, Math.min(28, d.x));
        a.y += Math.max(-24, Math.min(24, d.y));
      }
    }
    return Object.fromEntries(
      nodes.map((n) => [
        n.id,
        { x: Math.round(n.x), y: Math.round(n.y), pinned: !!n.pinned },
      ]),
    );
  }
  function familyProjection(project, focus, depth = 4, maxNodes = 300) {
    if (!project.people.length)
      return { nodes: [], edges: [], truncated: false };
    focus = project.people.some((p) => p.id === focus)
      ? focus
      : project.people[0].id;
    const nodes = [],
      edges = [],
      seenPeople = new Set(),
      pos = project.views.family.positions || {},
      cols = new Map();
    function add(person, key, level, path, via) {
      if (nodes.length >= maxNodes) return null;
      const repeat = path.includes(person),
        index = cols.get(level) || 0;
      cols.set(level, index + 1);
      const n = {
        id: key,
        person,
        level,
        reference: seenPeople.has(person),
        cycle: repeat,
        ...(pos[key] || { x: index * 248, y: level * 215, pinned: false }),
      };
      nodes.push(n);
      seenPeople.add(person);
      if (via) edges.push({ ...via, to: key });
      return n;
    }
    const root = add(focus, "root:" + focus, 0, [], null),
      queue = [
        { node: root, path: [focus], steps: 0, direction: null, used: [] },
      ];
    let cursor = 0,
      truncated = false;
    while (cursor < queue.length) {
      const q = queue[cursor++];
      if (q.steps >= depth) continue;
      for (const r of project.relations) {
        if (r.type !== "parent") continue;
        const up = r.to === q.node.person,
          down = r.from === q.node.person;
        if (!up && !down) continue;
        const direction = up ? "up" : "down";
        // Walk up to ancestors, then down into sibling/cousin branches. Never
        // turn upward again after descending or immediately reverse an edge.
        if (
          q.used.includes(r.id) ||
          (q.direction === "down" && direction === "up")
        )
          continue;
        const person = up ? r.from : r.to,
          key = q.node.id + "/" + r.id + ":" + direction;
        const n = add(person, key, q.node.level + (up ? -1 : 1), q.path, {
          id: r.id,
          from: q.node.id,
          reverse: up,
        });
        if (!n) {
          truncated = true;
          break;
        }
        if (!n.cycle)
          queue.push({
            node: n,
            path: [...q.path, person],
            steps: q.steps + 1,
            direction,
            used: [...q.used, r.id],
          });
      }
    }
    // Place partners alongside a known occurrence, without inferring a marriage
    // from co-parenthood. This is a display placement, not a stored generation.
    for (const r of project.relations.filter((r) => r.type === "spouse")) {
      const a = nodes.find((n) => n.person === r.from),
        b = nodes.find((n) => n.person === r.to);
      if (a && !b)
        add(r.to, "partner:" + r.id + ":" + r.to, a.level, [], {
          id: r.id,
          from: a.id,
          reverse: false,
        });
      else if (b && !a)
        add(r.from, "partner:" + r.id + ":" + r.from, b.level, [], {
          id: r.id,
          from: b.id,
          reverse: true,
        });
    }
    for (const n of nodes)
      if (!pos[n.id]) n.x -= ((cols.get(n.level) || 1) - 1) * 124;
    // Put additional relatives and disconnected people in a side shelf without inventing generations.
    let shelf = 0;
    const maxCol = Math.max(0, ...nodes.map((n) => n.x)) + CARD_FAMILY_SPACING;
    for (const p of project.people)
      if (!seenPeople.has(p.id)) {
        if (nodes.length >= maxNodes) {
          truncated = true;
          break;
        }
        const key = "other:" + p.id;
        nodes.push({
          id: key,
          person: p.id,
          level: null,
          reference: false,
          cycle: false,
          shelf: true,
          ...(pos[key] || {
            x: maxCol + (shelf % 3) * 248,
            y: Math.floor(shelf / 3) * 205,
            pinned: false,
          }),
        });
        shelf++;
      }
    const first = new Map();
    for (const n of nodes) if (!first.has(n.person)) first.set(n.person, n.id);
    for (const r of project.relations)
      if (
        first.has(r.from) &&
        first.has(r.to) &&
        !edges.some((e) => e.id === r.id)
      )
        edges.push({
          id: r.id,
          from: first.get(r.from),
          to: first.get(r.to),
          reverse: false,
        });
    return { nodes, edges, truncated };
  }
  const CARD_FAMILY_SPACING = 348;
  function mergePeople(project, source, target) {
    if (source === target) throw Error("서로 다른 인물을 선택해 주세요.");
    const p = clone(project),
      a = p.people.find((n) => n.id === source),
      b = p.people.find((n) => n.id === target);
    if (!a || !b) throw Error("병합할 인물을 찾을 수 없습니다.");
    for (const f of p.families || []) {
      const birthA = f.births.find((b) => b.children.includes(source)),
        birthB = f.births.find((b) => b.children.includes(target));
      if (birthA && birthB && birthA.id !== birthB.id)
        throw Error(
          f.name +
            "의 두 출생 사건에 서로 다른 기록이 있습니다. 가족 편집에서 출생 사건을 확인한 뒤 병합하세요.",
        );
    }
    b.groups = [...new Set([...a.groups, ...b.groups])];
    b.notes = [b.notes, a.notes ? `[${a.name}에서 병합]\n${a.notes}` : ""]
      .filter(Boolean)
      .join("\n\n");
    if (!b.photo) b.photo = a.photo;
    if (!b.subtitle) b.subtitle = a.subtitle;
    b.mergedProfiles = [...(b.mergedProfiles || []), clone(a)];
    for (const r of p.relations) {
      if (r.from === source) r.from = target;
      if (r.to === source) r.to = target;
    }
    p.people = p.people.filter((n) => n.id !== source);
    delete p.views.network.positions[source];
    if (p.focus === source) p.focus = target;
    Family.reassign(p, source, target);
    return p;
  }
  function demo() {
    const p = emptyProject("달빛 아래의 사람들");
    p.description = "서로 다른 세계에서 이어지는, 우리만의 이야기";
    p.groups = [
      { id: "g1", name: "실버문 가문", color: "#b5a4d3" },
      { id: "g2", name: "새벽 원정대", color: "#8ebda6" },
      { id: "g3", name: "별빛 길드", color: "#d5b779" },
    ];
    const raw = [
      ["a", "엘리안", "실버문의 수호자", "남성", ["g1", "g2"], 0, -350, -220],
      ["b", "세레나", "별빛을 읽는 마법사", "여성", ["g1", "g3"], 1, 0, -220],
      ["c", "로웬", "북부의 여행자", "남성", ["g2"], 2, 350, -220],
      ["d", "리리아", "새벽의 연금술사", "여성", ["g1", "g2"], 3, -350, 50],
      ["e", "카엘", "잊힌 왕국의 기사", "남성", ["g1"], 4, 0, 50],
      ["f", "노아", "숲속의 기록자", "미지정", ["g3"], 5, 350, 50],
      ["g", "아린", "작은 별의 후계자", "여성", ["g1"], 6, -175, 320],
      ["h", "이든", "바람을 따르는 궁수", "남성", ["g2"], 7, 350, 320],
    ];
    p.people = raw.map(
      ([pid, name, subtitle, gender, groups, avatar, x, y]) => {
        p.views.network.positions[pid] = { x, y, pinned: false };
        return {
          id: pid,
          name,
          subtitle,
          gender,
          groups,
          avatar,
          photo: "",
          notes: `${name}의 이야기를 이곳에 기록해 보세요.\n\n이 프로젝트는 자유롭게 편집할 수 있는 예시입니다. 새 프로젝트에서 나만의 인물 관계도를 시작할 수도 있습니다.`,
        };
      },
    );
    const rr = [
      ["a", "b", "spouse"],
      ["b", "c", "spouse"],
      ["a", "d", "parent"],
      ["b", "d", "parent"],
      ["a", "e", "parent"],
      ["b", "e", "parent"],
      ["d", "g", "parent"],
      ["e", "f", "lover"],
      ["c", "f", "friend"],
      ["d", "h", "colleague"],
      ["f", "h", "friend"],
      ["e", "g", "friend"],
    ];
    p.relations = rr.map(([from, to, type], i) => ({
      id: "r" + i,
      from,
      to,
      type,
      parentKind: type === "parent" ? "biological" : "",
      notes: "",
    }));
    p.focus = "d";
    return p;
  }
  return {
    TYPES,
    id,
    clone,
    emptyProject,
    validate,
    labelRelation,
    infer,
    patterns,
    localPosition,
    networkLayout,
    familyProjection,
    mergePeople,
    demo,
  };
});
