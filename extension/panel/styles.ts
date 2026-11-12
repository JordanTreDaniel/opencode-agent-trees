// Panel styles. Every colour comes from the host theme tokens that
// `applyHostReady` publishes (`--oc-*`), so the panel follows the app's
// light/dark theme without shipping a palette of its own.

export const PANEL_CSS = `
.ov-shell {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  box-sizing: border-box;
  font-family: var(--oc-font, system-ui, sans-serif);
  font-size: 14px;
  color: var(--oc-fg);
  background: var(--oc-bg);
}
.ov-shell * { box-sizing: border-box; }

.ov-header {
  padding: 14px 16px 0;
  border-bottom: 1px solid var(--oc-border);
  background: var(--oc-bg);
}
.ov-titlebar {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  flex-wrap: wrap;
}
.ov-title {
  margin: 0;
  font-size: 15px;
  font-weight: 650;
  letter-spacing: 0.01em;
}
.ov-subtitle {
  color: var(--oc-muted);
  font-size: 12px;
  margin-left: 8px;
  font-weight: 400;
}
.ov-chips {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  align-items: center;
}
.ov-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  line-height: 1;
  padding: 5px 8px;
  border-radius: 999px;
  border: 1px solid var(--oc-border);
  background: var(--oc-muted-surface);
  color: var(--oc-muted);
  white-space: nowrap;
}
button.ov-chip { cursor: pointer; font-family: inherit; }
button.ov-chip:hover { background: var(--oc-hover); color: var(--oc-fg); }
.ov-chip[data-tone="warning"] {
  border-color: color-mix(in srgb, var(--oc-warning) 60%, transparent);
  color: var(--oc-warning-text);
  background: color-mix(in srgb, var(--oc-warning) 14%, transparent);
}
.ov-chip[data-tone="error"] {
  border-color: color-mix(in srgb, var(--oc-error) 60%, transparent);
  color: var(--oc-error-text);
  background: color-mix(in srgb, var(--oc-error) 14%, transparent);
}
.ov-chip[data-tone="success"] {
  border-color: color-mix(in srgb, var(--oc-success) 55%, transparent);
  color: var(--oc-success-text);
  background: color-mix(in srgb, var(--oc-success) 14%, transparent);
}
.ov-chip[data-tone="info"] {
  border-color: color-mix(in srgb, var(--oc-info) 55%, transparent);
  color: var(--oc-info-text);
  background: color-mix(in srgb, var(--oc-info) 14%, transparent);
}
.ov-chip[data-tone="neutral"] { color: var(--oc-muted); }

.ov-switcher {
  margin-top: 10px;
  overflow-x: auto;
  overflow-y: hidden;
  padding-bottom: 2px;
}
.ov-viewline {
  display: flex;
  gap: 8px 10px;
  flex-wrap: wrap;
  align-items: center;
  padding: 9px 16px 0;
  font-size: 12px;
  color: var(--oc-muted);
}
.ov-filters {
  font-family: var(--oc-mono, ui-monospace, monospace);
  color: var(--oc-fg);
  font-size: 12px;
}

.ov-body {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 10px 16px 8px;
  gap: 10px;
}

.ov-proxy {
  border: 1px dashed color-mix(in srgb, var(--oc-warning) 70%, transparent);
  background: color-mix(in srgb, var(--oc-warning) 10%, transparent);
  border-radius: var(--oc-radius, 8px);
  padding: 10px 12px;
}
.ov-proxy-head {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12.5px;
  font-weight: 650;
  color: var(--oc-warning-text);
}
.ov-proxy-body {
  margin-top: 6px;
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--oc-fg);
}
.ov-proxy-body code {
  font-family: var(--oc-mono, ui-monospace, monospace);
  font-size: 12px;
  background: var(--oc-muted-surface);
  border: 1px solid var(--oc-border);
  border-radius: 4px;
  padding: 0 4px;
}

.ov-gaps {
  border: 1px solid var(--oc-border);
  background: var(--oc-elevated);
  border-radius: var(--oc-radius, 8px);
  padding: 9px 12px;
}
.ov-gaps-head {
  display: flex;
  align-items: center;
  gap: 7px;
  flex-wrap: wrap;
  font-size: 12.5px;
  font-weight: 650;
  color: var(--oc-fg);
}
.ov-gaps ul {
  margin: 7px 0 0;
  padding-left: 18px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.ov-gaps li {
  font-size: 12px;
  line-height: 1.45;
  color: var(--oc-muted);
}
.ov-gaps li strong { color: var(--oc-warning-text); font-weight: 600; }
.ov-gaps li[data-tone="muted"] strong { color: var(--oc-muted); }

.ov-note {
  font-size: 12.5px;
  line-height: 1.5;
  color: var(--oc-muted);
  border-left: 2px solid var(--oc-border);
  padding-left: 9px;
}
.ov-note strong { color: var(--oc-fg); font-weight: 600; }
.ov-note[data-tone="warning"] { border-left-color: var(--oc-warning); }
.ov-note[data-tone="warning"] strong { color: var(--oc-warning-text); }

.ov-anchor {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--oc-muted);
}
.ov-anchor > .oc-sdk { min-width: 240px; max-width: 340px; }

.ov-rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.ov-row {
  display: block;
  width: 100%;
  text-align: left;
  font: inherit;
  color: inherit;
  cursor: pointer;
  border: 1px solid var(--oc-border);
  background: var(--oc-elevated);
  border-radius: calc(var(--oc-radius, 8px) - 2px);
  padding: 8px 10px;
}
.ov-row:hover { background: var(--oc-hover); border-color: var(--oc-primary); }
.ov-row:focus-visible { outline: 2px solid var(--oc-focus); outline-offset: 1px; }
.ov-row[data-indent="true"] {
  padding-left: calc(10px + var(--d, 0) * 18px);
  position: relative;
}
.ov-row[data-indent="true"][style*="--d:0"] { padding-left: 10px; }
.ov-row-head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}
.ov-id {
  font-family: var(--oc-mono, ui-monospace, monospace);
  font-size: 11.5px;
  color: var(--oc-info-text);
  white-space: nowrap;
}
.ov-row-title {
  font-size: 13.5px;
  font-weight: 600;
  color: var(--oc-fg);
  flex: 1 1 auto;
  min-width: 120px;
  overflow-wrap: anywhere;
}
.ov-badges { display: inline-flex; gap: 5px; flex-wrap: wrap; }
.ov-badge {
  font-size: 10.5px;
  line-height: 1;
  padding: 3px 6px;
  border-radius: 999px;
  border: 1px solid var(--oc-border);
  background: var(--oc-muted-surface);
  color: var(--oc-muted);
  white-space: nowrap;
}
.ov-badge[data-tone="success"] {
  color: var(--oc-success-text);
  border-color: color-mix(in srgb, var(--oc-success) 55%, transparent);
  background: color-mix(in srgb, var(--oc-success) 13%, transparent);
}
.ov-badge[data-tone="warning"] {
  color: var(--oc-warning-text);
  border-color: color-mix(in srgb, var(--oc-warning) 55%, transparent);
  background: color-mix(in srgb, var(--oc-warning) 13%, transparent);
}
.ov-badge[data-tone="error"] {
  color: var(--oc-error-text);
  border-color: color-mix(in srgb, var(--oc-error) 55%, transparent);
  background: color-mix(in srgb, var(--oc-error) 13%, transparent);
}
.ov-badge[data-tone="info"] {
  color: var(--oc-info-text);
  border-color: color-mix(in srgb, var(--oc-info) 55%, transparent);
  background: color-mix(in srgb, var(--oc-info) 13%, transparent);
}
.ov-row-sub {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
  margin-top: 5px;
  font-size: 11.5px;
  color: var(--oc-muted);
}
.ov-row-sub .ov-mono {
  font-family: var(--oc-mono, ui-monospace, monospace);
  overflow-wrap: anywhere;
}
.ov-time { white-space: nowrap; font-variant-numeric: tabular-nums; }

.ov-empty {
  border: 1px dashed var(--oc-border);
  border-radius: var(--oc-radius, 8px);
  padding: 22px 16px;
  text-align: center;
  color: var(--oc-muted);
  font-size: 13px;
  line-height: 1.55;
}
.ov-empty strong { display: block; color: var(--oc-fg); font-size: 13.5px; margin-bottom: 5px; }

.ov-vocab {
  border-top: 1px solid var(--oc-border);
  background: var(--oc-elevated);
  margin-top: auto;
}
.ov-vocab-toggle {
  display: flex;
  width: 100%;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font: inherit;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--oc-fg);
  background: transparent;
  border: 0;
  padding: 10px 16px;
  cursor: pointer;
}
.ov-vocab-toggle:hover { background: var(--oc-hover); }
.ov-vocab-toggle .ov-vocab-hint { color: var(--oc-muted); font-weight: 400; }
.ov-vocab-body { padding: 0 16px 14px; display: flex; flex-direction: column; gap: 4px; }
.ov-vocab-row {
  display: grid;
  grid-template-columns: minmax(130px, 1.1fr) minmax(150px, 1.4fr) auto;
  gap: 4px 12px;
  align-items: baseline;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid transparent;
}
.ov-vocab-row:nth-child(odd) { background: color-mix(in srgb, var(--oc-muted-surface) 55%, transparent); }
.ov-vocab-name {
  font-family: var(--oc-mono, ui-monospace, monospace);
  font-size: 12px;
  color: var(--oc-fg);
  overflow-wrap: anywhere;
}
.ov-vocab-desc { font-size: 11.5px; line-height: 1.45; color: var(--oc-muted); overflow-wrap: anywhere; }
.ov-vocab-row[data-avail="unavailable"] .ov-vocab-name {
  text-decoration: line-through;
  text-decoration-color: var(--oc-error-text);
  color: var(--oc-error-text);
}
.ov-vocab-row[data-avail="unknown"] .ov-vocab-name { color: var(--oc-warning-text); }
.ov-vocab-type {
  grid-column: 1 / -1;
  font-family: var(--oc-mono, ui-monospace, monospace);
  font-size: 10.5px;
  color: var(--oc-subtle, var(--oc-muted));
}

@media (max-width: 560px) {
  .ov-header { padding: 12px 12px 0; }
  .ov-body { padding: 10px 12px 8px; }
  .ov-viewline { padding: 8px 12px 0; }
  .ov-vocab-toggle, .ov-vocab-body { padding-left: 12px; padding-right: 12px; }
  .ov-vocab-row { grid-template-columns: 1fr auto; }
  .ov-vocab-desc { grid-column: 1 / -1; }
  .ov-row-sub { flex-direction: column; gap: 3px; }
  .ov-anchor > .oc-sdk { min-width: 100%; max-width: none; }
}
`;
