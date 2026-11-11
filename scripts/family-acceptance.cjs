const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
let automation;
try {
  automation = require("playwright-core");
} catch {
  automation = require(
    path.resolve(
      path.dirname(process.execPath),
      "../node_modules/playwright-core",
    ),
  );
}
const root = path.resolve(__dirname, ".."),
  exe =
    process.env.SIMLINE_EXE ||
    path.join(root, "dist/SIMLINE-2.1-win32-x64/SIMLINE.exe");
const dataDir = path.join(root, ".test-data/acceptance-" + Date.now()),
  report = path.join(root, "test-results/simline");
fs.mkdirSync(report, { recursive: true });
async function start() {
  const app = await automation._electron.launch({
    executablePath: exe,
    args: [],
    env: { ...process.env, INYEON_DATA: dataDir },
    timeout: 30000,
  });
  const page = await app.firstWindow();
  page.setDefaultTimeout(7000);
  page.setDefaultNavigationTimeout(10000);
  await page.waitForFunction(
    () =>
      typeof project !== "undefined" &&
      project &&
      document.querySelector("#canvas-title")?.textContent,
    {},
    { timeout: 10000 },
  );
  return { app, page };
}
async function stop(app) {
  await app.evaluate(({ app }) => app.exit(0));
  await new Promise((resolve) =>
    app.process().exitCode !== null
      ? resolve()
      : app.process().once("exit", resolve),
  );
}
(async () => {
  let { app, page } = await start();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const action = (name, scope = page) =>
    scope.locator(`[data-action="${name}"]`).first().click();
  const modal = () => page.locator("#modal[open]");
  const settled = () =>
    page.waitForFunction(
      () => document.querySelector("#save-status").textContent === "● 저장됨",
    );
  const snapshot = () =>
    page.evaluate(async () => {
      await saveQueue;
      return (await desktop.call("bootstrap")).project;
    });
  const waitCount = (count) =>
    page.waitForFunction(
      (count) => document.querySelectorAll("[data-junction]").length === count,
      count,
    );
  try {
    await page.locator('[data-action="mode"][data-mode="family"]').click();
    await waitCount(7);
    await page.waitForFunction(() => calc?.focus === "P1");
    const original = await snapshot();
    assert.equal(original.people.length, 10);
    assert.equal(original.relations.length, 23);
    await page.screenshot({ path: path.join(report, "01-first-family.png") });
    await page.locator("#family-jump-select").selectOption("F5");
    await settled();
    await page.screenshot({ path: path.join(report, "03-twin-junction.png") });
    await action("fit");
    await page.screenshot({ path: path.join(report, "02-all-families.png") });
    async function checkLines() {
      const counts = await page.evaluate(() => {
        const boxes = [...document.querySelectorAll("#world .node")].map(
          (el) => {
            const m = el.transform.baseVal.getItem(0).matrix;
            return { x: m.e, y: m.f, w: 188, h: 132 };
          },
        );
        let crossing = 0,
          diagonal = 0;
        const examples = [];
        const paths = [...document.querySelectorAll("#world [data-routed]")];
        for (const path of paths) {
          const coords = path
            .getAttribute("d")
            .match(/-?[\d.]+(?:e[+-]?\d+)?/gi)
            .map(Number);
          for (let i = 2; i < coords.length; i += 2) {
            const a = { x: coords[i - 2], y: coords[i - 1] },
              b = { x: coords[i], y: coords[i + 1] };
            if (a.x !== b.x && a.y !== b.y) diagonal++;
            const hit = boxes.find((box) => Families.crosses(a, b, box));
            if (hit) {
              crossing++;
              examples.push({ a, b, hit });
            }
          }
        }
        return { crossing, diagonal, paths: paths.length, examples };
      });
      assert(counts.paths > 0);
      assert.equal(counts.crossing, 0, JSON.stringify(counts.examples));
      assert.equal(counts.diagonal, 0);
      return counts;
    }
    const familyGeometry = await checkLines();
    assert.equal(await page.locator('.node[data-person="P1"]').count(), 7);
    for (const id of ["P3", "P6", "P9", "P1"]) {
      await page
        .locator(`[data-action="select-person"][data-id="${id}"]`)
        .first()
        .click();
      await action("set-focus");
      await page.waitForFunction((id) => calc?.focus === id, id);
      const results = await page.evaluate(() =>
        calc.results.map((r) => [r.person, r.label, r.kind]),
      );
      if (id === "P9")
        assert(results.some(([p, label]) => p === "P1" && label === "조부모"));
      if (id === "P6")
        assert(results.some(([p, label]) => p === "P1" && label === "배우자"));
    }
    await action("paths");
    await page.locator("#path-from").fill("P3");
    await page.locator("#path-to").fill("P9");
    await action("path-search", modal());
    assert((await page.locator('[data-action="path-display"]').count()) > 1);
    await action("path-display", modal());
    assert(await page.locator("#path-panel").isVisible());
    await action("close-proof");
    await page.locator('[data-action="mode"][data-mode="network"]').click();
    await waitCount(7);
    assert.equal(await page.locator(".node").count(), 10);
    await checkLines();
    await page.locator('[data-action="mode"][data-mode="family"]').click();
    await action("layout-menu");
    await action("layout-all", modal());
    await waitCount(7);
    await checkLines();
    await action("families");
    await modal().locator('[data-action="family-edit"][data-id="F5"]').click();
    await page.locator("#family-union").selectOption("former");
    await action("family-save", modal());
    await settled();
    let p = await snapshot();
    assert.equal(p.relations.filter((e) => e.type === "former").length, 1);
    assert.deepEqual(
      p.families.filter((f) => f.id !== "F5"),
      original.families.filter((f) => f.id !== "F5"),
    );
    await action("undo");
    await page.waitForFunction(() => project.families[4].union === "spouse");
    await action("families");
    await modal()
      .locator('[data-action="family-branch"][data-id="F5"]')
      .click();
    await waitCount(3);
    await action("families");
    await modal().locator('[data-action="family-fold"][data-id="F5"]').click();
    await action("close-modal", modal());
    assert.equal(
      await page.locator('.node[data-node="unit:F5:child:P7"]').count(),
      0,
    );
    await action("family-all");
    await waitCount(7);
    await action("families");
    await modal().locator('[data-action="family-edit"][data-id="F7"]').click();
    await action("family-delete-dialog", modal());
    await action("family-delete", modal());
    await waitCount(6);
    p = await snapshot();
    assert.equal(p.people.length, 10);
    assert(!p.relations.some((r) => r.familyId === "F7"));
    await action("undo");
    await waitCount(7);
    await action("families");
    await action("family-create", modal());
    await page.locator("#parent-one").fill("P9");
    await page.locator("#parent-two").fill("");
    await action("birth-add", modal());
    await page.locator("[data-birth-input]").fill("P1");
    await action("birth-add-child", modal());
    await action("family-save", modal());
    await page.waitForFunction(
      () => project.families.length === 8 && calc?.cycles.length > 0,
    );
    await settled();
    await action("undo");
    await waitCount(7);
    // Reconstruct the entire fixture through the user-facing empty-project editor.
    await action("projects");
    await action("new-project", modal());
    await page.locator("#new-project-name").fill("직접 입력한 일곱 가족");
    await action("create-project", modal());
    for (let i = 1; i <= 10; i++) {
      await action("add-person");
      await page.locator("#person-name").fill("P" + i);
      await action("save-person", modal());
      await page.waitForFunction((n) => project.people.length === n, i);
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
    for (const [index, [partner, kids]] of units.entries()) {
      await action("families");
      await action("family-create", modal());
      await page.locator("#family-name").fill("F" + (index + 1));
      await page.locator("#parent-one").fill("P1");
      await page.locator("#parent-two").fill("P" + partner);
      await page.locator("#family-parent-kind").selectOption("biological");
      await action("birth-add", modal());
      for (const kid of kids) {
        await page.locator("[data-birth-input]").fill("P" + kid);
        await action("birth-add-child", modal());
      }
      await action("family-save", modal());
      await page.waitForFunction(
        (n) => project.families.length === n,
        index + 1,
      );
    }
    p = await snapshot();
    const getName = (id) => p.people.find((n) => n.id === id).name;
    assert.equal(p.people.length, 10);
    assert.equal(p.relations.length, 23);
    assert(p.families.every((f) => getName(f.parents[0]) === "P1"));
    assert.deepEqual(p.families[4].births[0].children.map(getName), [
      "P7",
      "P8",
    ]);
    await page.locator('[data-action="mode"][data-mode="family"]').click();
    await waitCount(7);
    const pid = p.people.find((p) => p.name === "P1").id;
    await page
      .locator('[data-action="select-person"][data-id="' + pid + '"]')
      .first()
      .click();
    await action("edit-person");
    await app.evaluate(
      ({ dialog }, image) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [image],
        });
      },
      path.join(root, "assets/icon.png"),
    );
    await action("pick-photo", modal());
    await page.waitForFunction(() =>
      document.querySelector("#photo-preview").src.startsWith("data:image/png"),
    );
    await page.locator("#person-name").fill("P1 수정");
    await action("save-person", modal());
    await settled();
    assert.equal(
      await page.locator('.node[data-person="' + pid + '"]').count(),
      7,
    );
    assert(
      (
        await page.locator('.node[data-person="' + pid + '"]').allTextContents()
      ).every((t) => t.includes("P1 수정")),
    );
    const names = await page.evaluate(() =>
      Object.fromEntries(projection.nodes.map((n) => [n.id, [n.x, n.y]])),
    );
    await action("add-person");
    await page.locator("#person-name").fill("독립 인물");
    await action("save-person", modal());
    await settled();
    const after = await page.evaluate(() =>
      Object.fromEntries(projection.nodes.map((n) => [n.id, [n.x, n.y]])),
    );
    for (const [id, pos] of Object.entries(names))
      assert.deepEqual(after[id], pos);
    await action("undo");
    await page.waitForFunction(() => project.people.length === 10);
    // Create a photographed child before the second parent is known.
    await action("families");
    await action("family-create", modal());
    await page.locator("#parent-one").fill("P2");
    await page.locator("#parent-two").fill("");
    await page.locator(".family-quick-add summary").click();
    await page.locator("#new-child-name").fill("나중에 부모 연결");
    await action("new-child-photo", modal());
    await page.waitForFunction(() =>
      document
        .querySelector("#child-photo-status")
        .textContent.includes("선택됨"),
    );
    await action("new-child-add", modal());
    await action("family-save", modal());
    await page.waitForFunction(() => project.families.length === 8);
    await action("families");
    await modal().locator('[data-action="family-edit"][data-id="F8"]').click();
    await page.locator("#parent-two").fill("P3");
    await action("family-save", modal());
    await settled();
    const next = await snapshot();
    assert.equal(next.families[7].parents.length, 2);
    assert(next.people.find((p) => p.name === "나중에 부모 연결").photo);
    await action("undo");
    await page.waitForFunction(() => project.families[7]?.parents.length === 1);
    await action("undo");
    await waitCount(7);
    // Drag one alias, pin its position and persist the per-mode viewport.
    await page.locator("#family-jump-select").selectOption("F1");
    const box = await page
      .locator('.node[data-node^="unit:F1:parent0:"]')
      .boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + box.width / 2 + 12,
      box.y + box.height / 2 + 15,
      { steps: 4 },
    );
    await page.mouse.up();
    await settled();
    await checkLines();
    await action("filters");
    await page
      .locator('input[name="edge-filter"][value="colleague"]')
      .uncheck();
    await action("apply-filters", modal());
    await settled();
    const saved = await snapshot();
    assert(Object.values(saved.views.family.positions).some((n) => n.pinned));
    await app.evaluate(({ dialog }, out) => {
      dialog.showSaveDialog = async (_w, options) => ({
        canceled: false,
        filePath: out + "/" + options.defaultPath,
      });
    }, report);
    await action("export-menu");
    await action("export-project", modal());
    await page.waitForFunction(() =>
      document.querySelector("#toast").textContent.includes("백업을 저장"),
    );
    const backup = path.join(report, saved.name + ".simline");
    const archive = JSON.parse(fs.readFileSync(backup, "utf8"));
    assert.deepEqual(archive.project.families, saved.families);
    assert.equal(Object.keys(archive.assets).length, 1);
    await action("export-svg", modal());
    await page.waitForFunction(() =>
      document.querySelector("#toast").textContent.includes("이미지를 저장"),
    );
    assert(
      fs
        .readFileSync(path.join(report, saved.name + ".svg"), "utf8")
        .includes('data-junction="F7"'),
    );
    await action("export-menu");
    await action("export-png", modal());
    await page.waitForFunction(() =>
      document.querySelector("#toast").textContent.includes("이미지를 저장"),
    );
    assert.equal(
      fs
        .readFileSync(path.join(report, saved.name + ".png"))
        .subarray(1, 4)
        .toString(),
      "PNG",
    );
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [file],
      });
    }, backup);
    await action("projects");
    await action("import-project", modal());
    await page.waitForFunction(() => project.name.endsWith("가져옴"));
    await waitCount(7);
    const imported = await snapshot();
    for (const field of [
      "people",
      "families",
      "relations",
      "views",
      "settings",
      "ui",
    ])
      assert.deepEqual(imported[field], saved[field]);
    await stop(app);
    ({ app, page } = await start());
    await waitCount(7);
    const reopened = await snapshot();
    for (const field of [
      "people",
      "families",
      "relations",
      "views",
      "settings",
      "ui",
      "focus",
      "mode",
    ])
      assert.deepEqual(reopened[field], imported[field]);
    const photos = await page.evaluate(
      async () => Object.keys((await desktop.call("bootstrap")).assets).length,
    );
    assert.equal(photos, 1);
    assert.deepEqual(errors, []);
    console.log(
      JSON.stringify(
        {
          executable: exe,
          createdViaUI: {
            people: 10,
            families: 7,
            relations: 23,
            twins: ["P7", "P8"],
          },
          familyGeometry,
          verifiedFocus: ["P1", "P3", "P6", "P9"],
          backupAndRestart: true,
          photos,
          rendererErrors: errors,
        },
        null,
        2,
      ),
    );
  } catch (e) {
    await page
      .screenshot({ path: path.join(report, "failure.png") })
      .catch(() => {});
    console.error(
      await page
        .locator("#form-error")
        .allTextContents()
        .catch(() => []),
    );
    throw e;
  } finally {
    await stop(app).catch(() => {});
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
