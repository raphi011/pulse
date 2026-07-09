# Follow-ups — GitHub Module (Plan 2)

The module shipped and was approved to merge. The final full-implementation code review
surfaced these non-blocking items, deferred by decision (2026-07-09) to keep the merge focused.
Two of them are gaps against the original design spec, noted as such.

## Important

1. **"Not configured" empty state** *(spec gap — spec promised "teaching empty states")*
   Team PRs (no `authors`), Failing Actions (no `repos`), and Dependabot (no `repos`) each return
   an empty list on empty config, which renders the same generic "No open PRs / No failing runs /
   No open alerts" as a genuinely-empty healthy result. A freshly-added, unconfigured widget looks
   broken with no nudge toward **⋯ → Configure**.
   *Fix:* the widget body should detect an empty required-config array and render a distinct
   "Not configured — open ⋯ → Configure" state. (Bodies already receive `config`; type it properly
   — currently `unknown` — and branch on it.)
   Files: `src/modules/github/widgets/{pr-list-widget,failing-actions-widget,dependabot-widget}.tsx`.

2. **Silent per-repo partial failure** *(spec gap — spec said "surface a non-fatal note if some targets errored")*
   `runs.ts` and `dependabot.ts` collect only fulfilled results and throw **only if every repo
   rejected**. One mistyped/inaccessible repo among several valid ones disappears with `status:"ok"`
   and no stale/error signal — inconsistent with the cache-first "keep last-good + stale badge" model.
   *Fix:* track which repos failed (zip `config.repos` with the `allSettled` results), add an optional
   `errors?: string[]` to `FailingActionsData`/`DependabotData`, and render a subtle non-fatal footer
   note ("N repo(s) failed to load") in the body.
   Files: `src/modules/github/{runs.ts,dependabot.ts}` + their widget bodies + manifest data types.

## Minor

3. **`repo` config is unvalidated `z.string()`** (`manifest.ts` — failingActions/dependabot `repos`).
   Interpolated into the dependabot API path `/repos/${repo}/dependabot/alerts?...` and `-R repo`.
   Not a shell-injection risk (execFile, arg arrays), but a value like `owner/name?foo=bar` yields a
   malformed path / query-param injection into the user's own `gh api` call. Add an `owner/name`
   regex to the schema — also improves the config-form validation message.

4. **Config drift until reload in the save dialog** (`configure-dialog.tsx`).
   `onSaved` propagates the raw form `values`, not the server's `safeParse` output (defaults applied).
   Clearing the number field persists `limit:20` server-side but local state omits it until reload.
   *Fix:* have `PATCH /api/widgets/[id]` return the stored config and use that in `onSaved`.

5. **`maxBuffer` overflow misclassified as `timeout`** (`cli.ts`).
   `ERR_CHILD_PROCESS_STDOUT_MAXBUFFER` also sets `killed:true`, so a >10MB payload would report
   "timed out". Very unlikely to hit; classify explicitly if it ever matters.

6. **Body `config` generic left as `unknown`** in the three widget bodies despite `MyPrsConfig`/etc.
   existing; `PrListWidget` typed `<MyPrsData,…>` though it also renders Team PRs (structurally
   identical — a shared `PrsData` alias would read better). Cosmetic; folds into item 1's typing work.

## Also deferred from Plan 2 scope (by design, per the spec)

- **Action endpoint** (`POST /api/widgets/[id]/action`), `runAction` wiring, and the **merge action**
  — intentionally out of scope; `runAction` is a no-op. Build in the phase that adds merge.
