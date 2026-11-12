// Panel entry point.
//
// One host bridge (`connectHost`), one theme application, one mounted app.
// The preview harness loads this exact bundle inside its mock host frame —
// there is no preview-only branch anywhere in panel/.

import { connectHost } from "@openchamber/sdk";
import { applyHostReady } from "@openchamber/sdk/ui";
import { mountApp } from "./app";

const host = connectHost();

host.onReady((context) => {
  applyHostReady(context, document.documentElement);
  document.body.dataset.ocSurface = context.surface;
});

const root = document.getElementById("root");
if (!root) throw new Error("Session Views: #root is missing from panel/index.html");

mountApp(root, host);
