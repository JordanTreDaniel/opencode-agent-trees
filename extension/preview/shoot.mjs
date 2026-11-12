#!/usr/bin/env node
// Visual proof routine for the Session Views extension.
//
//   node preview/server.mjs &          # serve extension/ on 127.0.0.1:4173
//   node preview/shoot.mjs [outdir]    # screenshots (default /tmp/extension-proof)
//
// Desktop 1440x900 for all six views, mobile 390x844 for default and
// question-paused, plus element close-ups of the view switcher, the proxy
// label and the unavailable filters. Also captures the needs-restart view
// with provenance stripped (the "orphaned: unknown" path).

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const BASE = process.env.PREVIEW_URL ?? "http://127.0.0.1:4173/preview/";
const OUT = process.argv[2] ?? "/Users/jordanc/dev/opencode-v2-test/tmp/opencode/extension-proof";

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

const inventory = [];

const shot = async (page, name, { fullPage = true } = {}) => {
  const path = `${OUT}/${name}.png`;
  await page.screenshot({ path, fullPage });
  inventory.push(path);
  process.stdout.write(`captured ${path}\n`);
};

const openPreview = async (browser, viewport) => {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForSelector("#pv-frame");
  const frame = page.frames().find((candidate) => candidate.url().includes("panel/index.html"));
  if (!frame) throw new Error("panel iframe did not load");
  await frame.waitForSelector(".ov-row, .ov-empty", { timeout: 15000 });
  return { page, frame, errors };
};

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
  {
    const { page, frame, errors } = await openPreview(browser, DESKTOP);
    await clickTab(frame, "default");
    await shot(page, "desktop-default");

    const switcher = frame.locator(".ov-switcher");
    inventory.push(`${OUT}/closeup-view-switcher.png`);
    await switcher.screenshot({ path: `${OUT}/closeup-view-switcher.png` });

    const proxy = frame.locator(".ov-proxy");
    inventory.push(`${OUT}/closeup-proxy-label.png`);
    await proxy.screenshot({ path: `${OUT}/closeup-proxy-label.png` });

    await clickTab(frame, "running");
    await shot(page, "desktop-running");

    await clickTab(frame, "needs-restart");
    await shot(page, "desktop-needs-restart");

    await clickTab(frame, "question-paused");
    await shot(page, "desktop-question-paused");

    await clickTab(frame, "tree");
    await shot(page, "desktop-tree");

    await clickTab(frame, "subtree");
    await shot(page, "desktop-subtree");

    // filter vocabulary assertions live in the tall-viewport block below
    if (errors.length) process.stdout.write(`PAGE ERRORS (desktop): ${errors.join(" | ")}\n`);
    else process.stdout.write("no console/page errors (desktop)\n");
    await page.context().close();
  }

  // --- desktop: the whole filter vocabulary, tall viewport so no row clips -
  {
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
    inventory.push(`${OUT}/closeup-unavailable-filters.png`);
    await frame.locator(".ov-vocab").screenshot({ path: `${OUT}/closeup-unavailable-filters.png` });
    inventory.push(`${OUT}/desktop-vocab-open.png`);
    await page.screenshot({ path: `${OUT}/desktop-vocab-open.png`, fullPage: true });
    if (errors.length) process.stdout.write(`PAGE ERRORS (vocab): ${errors.join(" | ")}\n`);
    await context.close();
  }

  // --- desktop: needs-restart with provenance stripped ------------------
  {
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

  // --- mobile: default + question-paused --------------------------------
  {
    const { page, frame, errors } = await openPreview(browser, MOBILE);
    await clickTab(frame, "default");
    await shot(page, "mobile-default");
    await clickTab(frame, "question-paused");
    await shot(page, "mobile-question-paused");
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
