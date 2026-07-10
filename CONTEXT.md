# Work Dashboard

A local, single-user dashboard whose integrations are pluggable. This glossary
pins the ubiquitous language for how integrations, their UI, and their data are
named. It defines *what* the terms mean — not *how* to build them (see the
`create-module` skill for that).

## Language

### Modules & widgets

**Module**:
A self-contained integration living under `src/modules/<name>/` (e.g. `github`,
`gws`). A module owns one or more widget types and everything they need.
_Avoid_: plugin, integration, package, extension.

**Widget type**:
A kind of widget a module offers, identified by a dotted string id
(`"github.prs"`, `"gws.gmail"`). The unit that gets registered and configured.
_Avoid_: widget kind, card type.

**Widget**:
A single configured, placed instance of a widget type on the dashboard. Many
widgets can share one widget type with different configs.
_Avoid_: card (that's the visual chrome), instance.

**Widget contract**:
The type-level interface the shell depends on (data in, rendered body out). The
shell knows only this contract, never a specific module.
_Avoid_: widget API, interface.

**Config**:
The per-widget settings for a widget type, described by a schema. The schema
both validates the config and drives the auto-generated settings form.
_Avoid_: options, settings, preferences.

### Wiring

**Manifest**:
A module's dependency-free shared surface: its widget-type ids, config schemas,
defaults, and data shapes. Importable by both server and client.
_Avoid_: types file, index.

**Server** (the module's server side):
The module's server-only surface: how each widget type gets its data, plus any
actions. Registers into the server registry.
_Avoid_: backend, api.

**Client** (the module's client side):
The module's browser surface: the React body that renders a widget type.
Registers into the client registry.
_Avoid_: frontend, ui, view.

**Registry**:
The lookup a module registers itself into so the shell can find it by widget
type. There are two — one server-only, one client — kept strictly apart.
_Avoid_: catalog, store, map.

**Shell**:
The dashboard framework that arranges, configures, and renders widgets while
staying ignorant of any specific module — it speaks only the widget contract.
_Avoid_: host, container, app, framework.

### Data & layout

**Cache-first**:
The data-flow rule: a widget renders instantly from its last cached data;
fetching fresh data (manual or interval) re-caches and re-renders. A failed
refresh keeps the last good data.
_Avoid_: stale-while-revalidate, lazy load.

**Widget cache**:
The stored last-known data (and error state) for each widget, keyed by widget.
_Avoid_: data store, snapshot.

**Layout**:
Where each widget sits and whether it shows — its column, order, and hidden
flag. Layout *is* the set of widgets, not a separate structure.
_Avoid_: grid, arrangement, positions.
