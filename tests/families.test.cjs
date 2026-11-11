const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const K = require("../core.js");
const F = require("../families.js");
const { Store } = require("../store.cjs");
const fixture = () => F.fixture(K);

test("F1–F7 contain one P1, 16 parent facts, seven marriages and one shared twin birth", () => {
  const p = fixture();
  K.validate(p);
  assert.equal(p.people.length, 10);
  assert.equal(p.people.filter((n) => n.id === "P1").length, 1);
  assert.equal(p.families.filter((f) => f.parents.includes("P1")).length, 7);
  assert.equal(p.relations.filter((r) => r.type === "spouse").length, 7);
  const pairs = p.relations
    .filter((r) => r.type === "parent")
    .map((r) => [r.from, r.to].join(">"))
    .sort();
  const desired = [
    "P1>P3",
    "P2>P3",
    "P1>P4",
    "P3>P4",
    "P1>P5",
    "P4>P5",
    "P1>P6",
    "P5>P6",
    "P1>P7",
    "P6>P7",
    "P1>P8",
    "P6>P8",
    "P1>P9",
    "P7>P9",
    "P1>P10",
    "P8>P10",
  ].sort();
  assert.deepEqual(pairs, desired);
  assert.deepEqual(p.families[4].births, [
    { id: "B5", date: "", children: ["P7", "P8"] },
  ]);
});
test("perspectives P1 P3 P6 P9 carry independent direct and indirect meanings", () => {
  const p = fixture();
  for (const [from, to, expected] of [
    ["P1", "P3", ["배우자", "자녀"]],
    ["P1", "P6", ["배우자", "자녀", "손자녀"]],
    ["P3", "P1", ["배우자", "부모"]],
    ["P6", "P1", ["배우자", "부모", "조부모"]],
    ["P9", "P1", ["부모", "조부모", "증조부모"]],
    ["P9", "P8", ["부모의 형제자매"]],
  ]) {
    const result = K.infer(p, from);
    for (const label of expected)
      assert(
        result.results.some((r) => r.person === to && r.label === label),
        from + " → " + to + " " + label,
      );
    for (const r of result.results)
      assert.equal(
        new Set(r.proofs.map((p) => JSON.stringify(p.edges))).size,
        r.proofs.length,
      );
  }
});
test("changing a single family updates only its facts and keeps people", () => {
  const p = fixture(),
    others = JSON.stringify(p.families.filter((f) => f.id !== "F5"));
  const family = K.clone(p.families[4]);
  family.union = "former";
  F.save(p, family);
  assert.equal(JSON.stringify(p.families.filter((f) => f.id !== "F5")), others);
  assert(
    K.infer(p, "P1").results.some(
      (r) => r.person === "P6" && r.label === "이전 배우자",
    ),
  );
  F.remove(p, "F5");
  assert.equal(p.people.length, 10);
  assert(!p.relations.some((r) => r.familyId === "F5"));
  K.validate(p);
});
test("single parent later gains a second parent without changing a different family", () => {
  const p = fixture(),
    old = JSON.stringify(p.families);
  const family = {
    id: "F8",
    name: "F8",
    parents: ["P2"],
    union: "none",
    parentKind: "adoptive",
    births: [{ id: "B8", children: ["P9"], date: "" }],
  };
  F.save(p, family);
  assert.equal(F.facts(family).length, 1);
  family.parents.push("P3");
  F.save(p, family);
  assert.equal(F.facts(family).length, 2);
  assert.equal(JSON.stringify(p.families.slice(0, 7)), old);
});
test("Korean kin terms require the relevant evidence", () => {
  const p = K.emptyProject("호칭");
  p.people = [
    "나",
    "아버지",
    "어머니",
    "작은아버지",
    "고모",
    "이모",
    "동생",
    "다른 어머니",
  ].map((name) => ({
    id: name,
    name,
    groups: [],
    gender: ["아버지", "작은아버지"].includes(name) ? "남성" : "여성",
  }));
  p.people[1].birthDate = "1970-01-01";
  p.people[3].birthDate = "1980-01-01";
  const rows = [
    ["아버지", "나", "parent"],
    ["어머니", "나", "parent"],
    ["아버지", "작은아버지", "sibling"],
    ["아버지", "고모", "sibling"],
    ["어머니", "이모", "sibling"],
    ["아버지", "동생", "parent"],
    ["다른 어머니", "동생", "parent"],
  ];
  p.relations = rows.map(([from, to, type], i) => ({
    id: "r" + i,
    from,
    to,
    type,
    parentKind: "biological",
  }));
  const labels = K.infer(p, "나").results.map((r) => r.label);
  for (const label of [
    "숙부",
    "삼촌",
    "고모",
    "이모",
    "이복형제자매",
    "조부모",
  ].slice(0, 5))
    assert(labels.includes(label), label);
  p.relations.pop();
  assert(!K.infer(p, "나").results.some((r) => r.label === "이복형제자매"));
});
function assertRouting(graph) {
  assert(graph.segments.length);
  const boxes = graph.nodes.map((n) => ({ x: n.x, y: n.y, w: 188, h: 132 }));
  for (const s of graph.segments) {
    assert(!s.blocked, "blocked " + s.unitId);
    for (let i = 1; i < s.points.length; i++) {
      const a = s.points[i - 1],
        b = s.points[i];
      assert(a.x === b.x || a.y === b.y, "diagonal segment");
      assert(!boxes.some((box) => F.crosses(a, b, box)), "card pierced");
    }
  }
}
test("two parents share a midpoint junction; routes avoid every card in both modes", () => {
  const p = fixture(),
    graph = F.projectUnits(p);
  assert.equal(graph.nodes.length, 22);
  assert.equal(graph.nodes.filter((n) => n.person === "P1").length, 7);
  assert.equal(graph.junctions.length, 7);
  for (const u of graph.junctions) {
    const [a, b] = u.parents;
    assert.equal(u.center.x, (a.x + 188 + b.x) / 2);
    assert.equal(u.center.y, a.y + 66);
  }
  assertRouting(graph);
  assertRouting(F.projectUnits(p, { network: true }));
});
test("vertically stacked partners branch sideways to the facing side of their child", () => {
  const p = fixture();
  p.families = p.families.slice(0, 1);
  p.relations = F.facts(p.families[0]);
  p.people = p.people.slice(0, 3);
  p.views.network.positions = {
    P1: { x: 0, y: 0 },
    P2: { x: 0, y: 300 },
    P3: { x: 400, y: 150 },
  };
  const g = F.projectUnits(p, { network: true });
  assert.deepEqual(g.junctions[0].center, { x: 94, y: 216 });
  const child = g.segments.find((s) => s.type === "parent");
  assert.deepEqual(child.points.at(-1), { x: 400, y: 216 });
  assert(child.points.every((q) => q.y === 216));
  assertRouting(g);
});
test("hand placement, family folding and branch isolation preserve raw data", () => {
  const p = fixture(),
    initial = JSON.stringify(p.relations),
    view = F.projectUnits(p),
    node = view.junctions[4].parents[0];
  p.views.family.positions[node.id] = {
    x: node.x + 13,
    y: node.y + 18,
    pinned: true,
  };
  p.ui = { familyBranch: "F5", foldedFamilies: ["F5"] };
  const v = F.projectUnits(p);
  assert.deepEqual(
    v.junctions.map((j) => j.id),
    ["F5", "F6", "F7"],
  );
  assert.equal(v.junctions[0].children.length, 0);
  assert(v.nodes.find((n) => n.id === node.id).pinned);
  assertRouting(v);
  assert.equal(JSON.stringify(p.relations), initial);
});
test("legacy projection and explicit conversion preserve IDs, directions and provenance", () => {
  const p = K.demo(),
    before = JSON.stringify(p);
  const model = F.legacyUnits(p),
    preview = F.legacyProjection(p, { network: false });
  assert(preview.junctions.length);
  assert.equal(JSON.stringify(p), before);
  const identity = (e) =>
    JSON.stringify([e.id, e.from, e.to, e.type, e.notes || ""]);
  const facts = p.relations.map(identity).sort();
  F.adoptLegacy(p, model);
  K.validate(p);
  assert.deepEqual(p.relations.map(identity).sort(), facts);
});
test("cycle and many paths terminate; alternative evidence survives", () => {
  const p = fixture();
  p.relations.push({ id: "cycle", type: "parent", from: "P9", to: "P1" });
  const r = K.infer(p, "P1", { depth: 10, limit: 100000 });
  assert(r.cycles.length > 0);
  assert(r.states <= 100000);
  const routes = F.findPaths(p, "P3", "P9", 6);
  assert(routes.paths.length > 1);
  assert(routes.paths.every((v) => new Set(v.people).size === v.people.length));
});
test("merge, undo, restart and portable backup preserve family and twin records", async () => {
  const location = path.join(__dirname, "../.test-data/family-" + Date.now());
  const s = await new Store().open(location, false),
    p = fixture();
  s.create(p);
  const edited = K.mergePeople(p, "P3", "P4");
  K.validate(edited);
  s.save(edited, "병합");
  s.travel(p.id, "undo");
  const reopened = await new Store().open(location, false);
  const snapshot = reopened.get(p.id);
  assert.deepEqual(snapshot.families, p.families);
  assert.deepEqual(snapshot.relations, p.relations);
  const imported = reopened.importBundle(reopened.bundle(p.id)).project;
  assert.deepEqual(imported.families, p.families);
  assert.deepEqual(imported.views, p.views);
});
