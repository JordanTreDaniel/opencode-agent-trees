#!/usr/bin/env node
// Visual proof routine for the Session Views extension.
//
//   node preview/server.mjs &          # serve extension/ on 127.0.0.1:4173
//   node preview/shoot.mjs [outdir]    # screenshots (default /tmp/extension-proof)
//   node preview/shoot.mjs [outdir] --only=a,b   # capture only the named shots
//
// Desktop 1440x900 for all six views, mobile 390x844 for default and
// question-paused, plus element close-ups of the view switcher, the proxy
// label and the unavailable filters. Also captures the needs-restart view
// with provenance stripped (the "orphaned: unknown" path) and the `?empty=1`
// fixture that forces needs-restart and question-paused empty.
//
// Every run that includes the running/question-paused desktop shots also
// asserts the disjointness contract on the RENDERED panel: the two views' row
// ids must not overlap and must together cover every fixture session whose
// activity is a running one.

import { chromium } from "playwright";
import { mkdir, readFile } from "node:fs/promises";

const BASE = process.env.PREVIEW_URL ?? "http://127.0.0.1:4173/preview/";
const OUT = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : "/Users/jordanc/dev/opencode-v2-test/tmp/opencode/extension-proof";
const onlyArg = process.argv.find((arg) => arg.startsWith("--only="));
const ONLY = onlyArg ? new Set(onlyArg.slice("--only=".length).split(",").filter(Boolean)) : null;
const want = (name) => !ONLY || ONLY.has(name);

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

const TAB = {
  default: "default (proxy)",
  running: "running",
  "needs-restart": "needs-restart",
  "question-paused": "question-paused",
  tree: "tree:root",
  subtree: "subtree:",
};

const fixtures = JSON.parse(await readFile(new URL("./fixtures.json", import.meta.url), "utf8"));
// The panel's statusOf(): which activities read as `status = running`.
const RUNNING_ACTIVITIES = new Set(["running", "retrying", "waiting-permission", "waiting-question"]);
const fixtureRunning = fixtures.sessions.filter((session) => RUNNING_ACTIVITIES.has(session.activity));

const inventory = [];

const shot = async (page, name, { fullPage = true } = {}) => {
  const path = `${OUT}/${name}.png`;
  await page.screenshot({ path, fullPage });
  inventory.push(path);
  process.stdout.write(`captured ${path}\n`);
};

const openPreview = async (browser, viewport, base = BASE) => {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  await page.goto(base, { waitUntil: "load" });
  await page.waitForSelector("#pv-frame");
  const frame = page.frames().find((candidate) => candidate.url().includes("panel/index.html"));
  if (!frame) throw new Error("panel iframe did not load");
  await frame.waitForSelector(".ov-row, .ov-empty", { timeout: 15000 });
  return { page, frame, errors };
};

/** Session ids of the rows currently rendered, sorted. */
const rowIds = async (frame) =>
  (await frame.locator(".ov-row .ov-id").allTextContents())
    .map((text) => text.replace("…", ""))
    .sort();

const clickTab = async (frame, id) => {
  await frame.getByRole("tab", { name: TAB[id] }).click();
  await frame.waitForFunction(
    (expected) => document.querySelector(".ov-viewline strong")?.textContent?.startsWith(expected),
    id === "tree" || id === "subtree" ? id : id,
    { timeout: 5000 },
  );
};

const run = async () => {
  await mkdir(OUT, { recursive: true });
  const browser = await chromium.launch();

  // --- desktop: all six views ------------------------------------------
  const DESKTOP_SHOTS = [
    "desktop-default",
    "closeup-view-switcher",
    "closeup-proxy-label",
    "desktop-running",
    "desktop-needs-restart",
    "desktop-question-paused",
    "desktop-tree",
    "desktop-subtree",
  ];
  if (DESKTOP_SHOTS.some(want)) {
    const { page, frame, errors } = await openPreview(browser, DESKTOP);
    if (want("desktop-default")) {
      await clickTab(frame, "default");
      await shot(page, "desktop-default");
    }

    if (want("closeup-view-switcher")) {
      const switcher = frame.locator(".ov-switcher");
      inventory.push(`${OUT}/closeup-view-switcher.png`);
      await switcher.screenshot({ path: `${OUT}/closeup-view-switcher.png` });
    }

    if (want("closeup-proxy-label")) {
      const proxy = frame.locator(".ov-proxy");
      inventory.push(`${OUT}/closeup-proxy-label.png`);
      await proxy.screenshot({ path: `${OUT}/closeup-proxy-label.png` });
    }

    if (want("desktop-running")) {
      await clickTab(frame, "running");
      await shot(page, "desktop-running");
    }

    if (want("desktop-needs-restart")) {
      await clickTab(frame, "needs-restart");
      await shot(page, "desktop-needs-restart");
    }

    if (want("desktop-question-paused")) {
      await clickTab(frame, "question-paused");
      await shot(page, "desktop-question-paused");
    }

    // Disjointness, asserted on the RENDERED rows (not on the definitions):
    // running ∩ question-paused = ∅ and running ∪ question-paused = every
    // fixture session whose activity is a running one.
    if (want("desktop-running") && want("desktop-question-paused")) {
      await clickTab(frame, "running");
      const activeIds = await rowIds(frame);
      await clickTab(frame, "question-paused");
      const pausedIds = await rowIds(frame);

      const isPausedRow = (session) =>
        session.activity === "waiting-question" || session.pendingForm === true;
      const expectedPaused = fixtureRunning.filter(isPausedRow).map((session) => session.id).sort();
      const expectedActive = fixtureRunning.filter((session) => !isPausedRow(session)).map((session) => session.id).sort();
      const overlap = activeIds.filter((id) => pausedIds.includes(id));
      const union = [...new Set([...activeIds, ...pausedIds])].sort();
      if (overlap.length) throw new Error(`running/question-paused overlap on the rendered panel: ${overlap.join(", ")}`);
      if (activeIds.length + pausedIds.length !== fixtureRunning.length) {
        throw new Error(
          `running(${activeIds.length}) + question-paused(${pausedIds.length}) != fixture status=running (${fixtureRunning.length})`,
        );
      }
      if (JSON.stringify(union) !== JSON.stringify(fixtureRunning.map((session) => session.id).sort())) {
        throw new Error(`the two views do not cover every running row: union=${union.join(",")}`);
      }
      if (JSON.stringify(activeIds) !== JSON.stringify(expectedActive) || JSON.stringify(pausedIds) !== JSON.stringify(expectedPaused)) {
        throw new Error(
          `membership mismatch: running=${activeIds.join(",")} (expected ${expectedActive.join(",")}), ` +
            `question-paused=${pausedIds.join(",")} (expected ${expectedPaused.join(",")})`,
        );
      }
      process.stdout.write(
        `disjointness: running ${activeIds.length} + question-paused ${pausedIds.length} == ${fixtureRunning.length} status=running rows; no overlap; union == all\n`,
      );
    }

    if (want("desktop-tree")) {
      await clickTab(frame, "tree");
      await shot(page, "desktop-tree");
    }

    if (want("desktop-subtree")) {
      await clickTab(frame, "subtree");
      await shot(page, "desktop-subtree");
    }

    // filter vocabulary assertions live in the tall-viewport block below
    if (errors.length) process.stdout.write(`PAGE ERRORS (desktop): ${errors.join(" | ")}\n`);
    else process.stdout.write("no console/page errors (desktop)\n");
    await page.context().close();
  }

  // --- desktop: the whole filter vocabulary, tall viewport so no row clips -
  if (want("desktop-vocab-open") || want("closeup-unavailable-filters")) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 2400 }, deviceScaleFactor: 1 });
    const page = await context.newPage();
    const errors = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(`console: ${message.text()}`);
    });
    page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
    await page.goto(BASE, { waitUntil: "load" });
    const frame = page.frames().find((candidate) => candidate.url().includes("panel/index.html"));
    if (!frame) throw new Error("panel iframe did not load");
    await frame.waitForSelector(".ov-row, .ov-empty", { timeout: 15000 });
    await clickTab(frame, "default");
    await frame.locator(".ov-vocab-toggle").click();
    await frame.waitForSelector('.ov-vocab-row[data-avail="unavailable"]');
    const rowCount = await frame.locator(".ov-vocab-row").count();
    const unavailable = await frame.locator('.ov-vocab-row[data-avail="unavailable"] .ov-vocab-name').allTextContents();
    process.stdout.write(`vocab rows: ${rowCount}; unavailable rows: ${unavailable.join(", ")}\n`);
    if (rowCount !== 20) throw new Error(`expected 20 vocabulary rows, got ${rowCount}`);
    if (!unavailable.includes("userSpawned") || !unavailable.includes("waveIndex")) {
      throw new Error(`userSpawned / waveIndex not marked unavailable: ${unavailable.join(", ")}`);
    }
    if (want("closeup-unavailable-filters")) {
      inventory.push(`${OUT}/closeup-unavailable-filters.png`);
      await frame.locator(".ov-vocab").screenshot({ path: `${OUT}/closeup-unavailable-filters.png` });
    }
    if (want("desktop-vocab-open")) {
      inventory.push(`${OUT}/desktop-vocab-open.png`);
      await page.screenshot({ path: `${OUT}/desktop-vocab-open.png`, fullPage: true });
    }
    if (errors.length) process.stdout.write(`PAGE ERRORS (vocab): ${errors.join(" | ")}\n`);
    await context.close();
  }

  // --- desktop: needs-restart with provenance stripped ------------------
  if (want("desktop-needs-restart-orphan-unknown")) {
    const { page, frame, errors } = await openPreview(browser, DESKTOP);
    await page.locator("#pv-provenance").uncheck();
    await frame.waitForFunction(
      () => [...document.querySelectorAll(".ov-chip")].some((node) => node.textContent?.includes("data gap")),
      undefined,
      { timeout: 5000 },
    );
    await clickTab(frame, "needs-restart");
    await shot(page, "desktop-needs-restart-orphan-unknown");
    if (errors.length) process.stdout.write(`PAGE ERRORS (unknown-path): ${errors.join(" | ")}\n`);
    await page.context().close();
  }

  // --- desktop 1440x900: the empty state, forced by ?empty=1 ------------
  const EMPTY_SHOTS = [
    "desktop-empty-needs-restart",
    "desktop-empty-question-paused",
    "desktop-empty-needs-restart-provenance-off",
  ];
  if (EMPTY_SHOTS.some(want)) {
    const { page, frame, errors } = await openPreview(browser, DESKTOP, `${BASE}?empty=1`);

    // The workspace must still be populated, or "empty" would prove nothing.
    await clickTab(frame, "default");
    const defaultRows = await frame.locator(".ov-row").count();
    if (defaultRows === 0) throw new Error("?empty=1 dropped every session; the empty state would be unprovable");
    process.stdout.write(`?empty=1: default view still renders ${defaultRows} row(s)\n`);

    const readEmpty = async (tab) => {
      await clickTab(frame, tab);
      const empties = await frame.locator(".ov-empty").count();
      if (empties !== 1) throw new Error(`expected exactly one empty-state box in ${tab}, found ${empties}`);
      const title = await frame.locator(".ov-empty strong").textContent();
      const body = await frame.locator(".ov-empty span").first().textContent();
      process.stdout.write(`empty state [${tab}]: "${title}" — "${body}"\n`);
      return { title, body };
    };

    if (want("desktop-empty-needs-restart")) {
      await readEmpty("needs-restart");
      await shot(page, "desktop-empty-needs-restart");
    }
    if (want("desktop-empty-question-paused")) {
      await readEmpty("question-paused");
      await shot(page, "desktop-empty-question-paused");
    }
    if (want("desktop-empty-needs-restart-provenance-off")) {
      // Production shape: no claim/fork/scheduled flags at all.
      await page.locator("#pv-provenance").uncheck();
      await frame.waitForFunction(
        () => [...document.querySelectorAll(".ov-chip")].some((node) => node.textContent?.includes("data gap")),
        undefined,
        { timeout: 5000 },
      );
      await readEmpty("needs-restart");
      await shot(page, "desktop-empty-needs-restart-provenance-off");
    }

    if (errors.length) process.stdout.write(`PAGE ERRORS (empty): ${errors.join(" | ")}\n`);
    else process.stdout.write("no console/page errors (empty fixture)\n");
    await page.context().close();
  }

  // --- mobile: default + question-paused --------------------------------
  if (want("mobile-default") || want("mobile-question-paused")) {
    const { page, frame, errors } = await openPreview(browser, MOBILE);
    if (want("mobile-default")) {
      await clickTab(frame, "default");
      await shot(page, "mobile-default");
    }
    if (want("mobile-question-paused")) {
      await clickTab(frame, "question-paused");
      await shot(page, "mobile-question-paused");
    }
    if (errors.length) process.stdout.write(`PAGE ERRORS (mobile): ${errors.join(" | ")}\n`);
    else process.stdout.write("no console/page errors (mobile)\n");
    await page.context().close();
  }

  await browser.close();
  process.stdout.write(`\n${inventory.length} screenshots in ${OUT}\n`);
};

run().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exit(1);
});
