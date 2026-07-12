# System widget — size-adaptive layout

**Date:** 2026-07-12
**Module:** `src/modules/system/`
**Status:** Design approved, pending spec review

## Problem

The System widget (`system-stats-widget.tsx`) stacks three full-width 64px area
charts — CPU, Memory, Network — each with a header and 1rem gaps (~270px total).
In a short card the content clips; the user must drag the card taller to see all
three. The trend charts are what consume the vertical space.

## Goal

Everything readable at a small card height, without losing the trend charts when
the card is given room. No data/sampler/manifest changes — purely presentational.

## Design

Two layout modes chosen from the widget's measured available height.

### Measurement

A `ResizeObserver` on the widget root reports content height. A small hook
(`useElementHeight`, colocated or in the module) returns `{ ref, height }`.
The widget derives its mode from `height`.

### Modes

**Compact** (short card) — one row per metric, ~24px each, layout
`label | graphic | value`, all three visible with no clipping:

- **CPU** — horizontal meter bar, domain 0–100%, filled with `--chart-cpu`; value `72%`.
- **Memory** — horizontal meter bar, domain 0–total, filled with `--chart-mem`; value `12.3 / 32 GB`.
- **Network** — tiny inline dual-line sparkline (rx `--chart-net-rx`, tx `--chart-net-tx`)
  in the graphic column, followed by `↓ 1.2 MB/s  ↑ 340 KB/s`. Sparkline (not text-only)
  keeps the three rows visually aligned and gives the burstiest metric its trend.

**Full** (tall card) — today's three stacked 64px `AreaChart`s, unchanged.

### Threshold (with hysteresis)

- Switch to **full** when available height ≥ ~210px.
- Switch back to **compact** when ≤ ~190px.
- The ~20px deadband prevents mode oscillation while dragging the card border.
- Below the compact floor, it simply stays compact.

Exact px values tunable during implementation against the real card chrome.

## Non-goals / YAGNI

- **Only two modes.** No mid-height intermediate state.
- **No shared meter/sparkline component.** Meters are inline markup (a track div +
  a colored fill div) local to `system-stats-widget.tsx`. A general component is
  built only if another widget needs one.
- No GPU metric (the module has never had one; out of scope).

## Files touched

- `src/modules/system/widgets/system-stats-widget.tsx` — mode logic + compact markup.
- Possibly one small hook file for `useElementHeight` (or inline).
- Reuses existing `--chart-*` CSS vars in `globals.css`; no new colors expected.

## Testing

- Existing widget test continues to pass.
- Add coverage: given a short measured height → compact rows render (meter bars +
  network sparkline + values); given a tall height → area charts render. Height is
  injected/mocked since `ResizeObserver` isn't driven by real layout in jsdom.
