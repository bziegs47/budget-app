# `App.tsx` decomposition roadmap

`src/App.tsx` is currently **~7,570 lines** (post-Tier 0 baseline) and
houses every concern in the renderer: icons, primitive form widgets,
every modal, the sidebar, every view, the home dashboard, the library,
IPC listeners, autosave, menu wiring, and the top-level `App`
component. The file works, but the cost of any further feature is
paid in scroll time and merge conflicts.

This document is a **plan**, not a change. No code moves until each
slice is scoped and reviewed on its own branch. The goal is to land
small, mechanical extractions that leave behavior identical and let
`App.tsx` shrink to "the thing that owns top-level state and routes
views."

## Guiding principles

1. **Behavior preservation first.** Every extraction is a
   move-and-rename, not a rewrite. Any logic change rides a separate
   commit so reviewers can audit it in isolation.
2. **One file per top-level concern.** A modal, a view, a hook — each
   gets its own file. Multiple components share a file only when
   they're tightly coupled (e.g. a view and its private subcomponents).
3. **No new abstractions until duplication appears.** We don't invent
   a `useModal` hook just to have one; we only consolidate when two
   call sites prove the shape.
4. **Imports stay relative for now.** Path aliases (`@/components/...`)
   are a follow-up; mixing rename and alias work in the same PR makes
   diffs noisy.
5. **Lints and types stay green at every step.** Each extraction PR
   ends with `npx tsc --noEmit` and `npm run build` clean.
6. **CSS co-locates with components.** When a component moves out of
   `App.tsx`, any selectors used *only* by that component move with
   it into a sibling `.css` file (e.g. `SaveStatusPill.tsx` +
   `SaveStatusPill.css`). Selectors shared across components stay in
   `src/App.css` until/unless we shard further. Per-component CSS is
   imported at the top of the component file. We deliberately don't
   introduce CSS modules or CSS-in-JS yet — plain `.css` siblings
   keep the migration mechanical.

## Proposed target layout

```
src/
  App.tsx                       # thin shell: state, routing, IPC wiring
  app/
    state/
      useWorkspaceState.ts      # workspace, dirty, autosave, snapshots
      useMenuListeners.ts       # the menuHandlersRef + listen() block
      useViewRouter.ts          # view enum + transitions (welcome,
                                #   library, years-landing, year-overview,
                                #   month, cross-year, reports)
    ipc/
      commands.ts               # typed wrappers for invoke<...>(...)
      events.ts                 # typed listen<...>(...)
  components/
    icons/
      ListIcon.tsx
      PencilIcon.tsx
      CalendarIcon.tsx
      NewWindowIcon.tsx
      TrashIcon.tsx
      PlusIcon.tsx
      LockIcon.tsx
      index.ts                  # barrel for ergonomic imports
    primitives/
      IconButton.tsx
      SaveStatusPill.tsx
      PopoverCalendar.tsx
      DateField.tsx
      PlannedAmountInput.tsx
      ExportPickerButton.tsx
    modals/
      useModalFocusTrap.ts
      BucketReorderModal.tsx
      UnsavedChangesModal.tsx
      ExpenseLineEditModal.tsx
      ConfirmDeleteRowModal.tsx
      PasswordModal.tsx
      PreferencesModal.tsx
      CreateYearModal.tsx
      RenameYearModal.tsx
      DeleteYearConfirmModal.tsx
      RenameWorkspaceModal.tsx
      DeleteWorkspaceConfirmModal.tsx
      OpenInWindowModal.tsx
      DuplicateYearModal.tsx
    sidebar/
      Sidebar.tsx
      YearListRow.tsx
      MonthRowItem.tsx
  views/
    WelcomeScreen.tsx
    LibraryView.tsx
    YearsLanding.tsx            # (or BudgetDashboard, post-redesign)
    YearOverviewView.tsx
    CrossYearView.tsx
    CrossYearMatrix.tsx
    MonthlyBarsChart.tsx
    YtdSlideOver.tsx
    YtdDualStrip.tsx
    ReportsView.tsx
    MonthBudgetView/
      index.tsx
      SummaryRow.tsx
      IncomeLineBlock.tsx
      IncomeEntriesPanel.tsx
      ExpenseLineBlock.tsx
      TransactionsPanel.tsx
    YearEndNudge.tsx
```

The exact folder names are negotiable; what matters is the shape:
**icons, primitives, modals, sidebar, views, state hooks, IPC
wrappers** — each with a clear owner.

## Phased extraction plan

Each phase is one PR. Phases are ordered so the highest-leverage,
lowest-risk moves come first. Every phase ends with the file shrinking
by a measurable number of lines and the file count growing by a
known amount.

### Phase 0 — Inventory (no code)

- This document.
- Confirm the target layout with reviewers before any moves.

### Phase 1 — Icons (~150 LOC out)

- Move every `*Icon` function to `src/components/icons/*.tsx`.
- Add a barrel `index.ts`.
- Update imports in `App.tsx` and any other consumer.
- Icons are pure SVG with no unique selectors, so the CSS
  co-location convention (principle #6) has nothing to apply here.
  Phase 2 (primitives) is its first real test.
- **Risk:** essentially zero. Pure components, no state.

### Phase 2 — Primitive widgets (~700 LOC out)

- `IconButton`, `SaveStatusPill`, `PopoverCalendar`, `DateField`,
  `PlannedAmountInput`, `ExportPickerButton`.
- Co-locate their CSS classes if any are unique to them.
- **Risk:** low. Each takes props; none reach into `App` state
  directly except via callbacks.

### Phase 3 — Focus-trap hook + leaf modals (~300 LOC out)

- Move `useModalFocusTrap` and `getFocusableWithin` to
  `src/components/modals/useModalFocusTrap.ts`.
- Move `BucketReorderModal`, `UnsavedChangesModal`,
  `ConfirmDeleteRowModal`, `OpenInWindowModal`.
- **Risk:** low. These don't touch shared `App` state beyond their
  callback props.

### Phase 4 — Workspace + year/month modals (~900 LOC out)

- `PasswordModal`, `PreferencesModal`, `CreateYearModal`,
  `RenameYearModal`, `DeleteYearConfirmModal`, `RenameWorkspaceModal`,
  `DeleteWorkspaceConfirmModal`, `DuplicateYearModal`,
  `ExpenseLineEditModal`.
- `PreferencesModal` reaches into `settings`, `workspaceMeta`,
  cloud probes, and several invoke calls — extract its props
  carefully and keep its logic intact.
- **Risk:** medium for `PreferencesModal`, low for the rest.

### Phase 5 — Sidebar (~250 LOC out)

- Move `Sidebar`, `YearListRow`, `MonthRowItem` to
  `src/components/sidebar/`.
- Sidebar already takes its data via props; the extraction is
  mostly cut/paste.
- **Risk:** low.

### Phase 6 — Standalone views (~1,200 LOC out)

- `WelcomeScreen`, `LibraryView`, `YearsLanding`/`BudgetDashboard`,
  `YearOverviewView`, `CrossYearView` (+ `CrossYearMatrix`,
  `MonthlyBarsChart`), `YtdSlideOver`, `YtdDualStrip`,
  `ReportsView`, `YearEndNudge`.
- Each becomes its own file; tightly-coupled helpers
  (`CrossYearMatrix`, `MonthlyBarsChart`) live next to their parent.
- **Risk:** low — these are presentational, fed by props.

### Phase 7 — `MonthBudgetView` and its row blocks (~900 LOC out)

- `MonthBudgetView` is the largest single view; extract it into a
  folder so its row blocks (`SummaryRow`, `IncomeLineBlock`,
  `IncomeEntriesPanel`, `ExpenseLineBlock`, `TransactionsPanel`)
  can live as siblings.
- **Risk:** medium. `MonthBudgetView` shares many callbacks with
  `App` — extracting may surface implicit prop dependencies. Keep
  the prop list explicit and typed.

### Phase 8 — IPC wrappers (~200 LOC out, but spread)

- Replace ad-hoc `invoke<T>("...", { ... })` calls with typed
  wrappers in `src/app/ipc/commands.ts`.
- Replace `listen("event", ...)` calls with wrappers in
  `src/app/ipc/events.ts`.
- This is the first real refactor (not just a move). It pays off
  by making future Tauri command renames a single-file change.
- **Risk:** medium. Stage in two passes: wrappers added with the
  same signatures, then call sites updated.

### Phase 9 — App-level hooks (~600 LOC out)

- `useWorkspaceState`: workspace meta, dirty flag, autosave timer,
  snapshot polling.
- `useMenuListeners`: the `menuHandlersRef` + `listen()` block we
  just refactored in A5. This is a great candidate because it's
  already self-contained.
- `useViewRouter`: view enum + the small helpers around switching
  views (e.g. `enterYear`, `activateMonth`, `goHome`).
- **Risk:** medium. These hooks own real state; tests would help.

### Phase 10 — Polish

- Decide on path aliases (`@/components/...`) and apply with
  `tsconfig`/`vite` config.
- Add a top-of-file map to `App.tsx` documenting which hooks /
  views it composes.
- Re-evaluate whether any remaining `App.tsx` blocks should move.

## What does **not** need to move

- The `AppView` discriminated union and the top-level routing
  switch can stay in `App.tsx`. That **is** the file's job.
- One-shot helpers used only inside `App` (e.g. local memo
  derivations, tiny effect blocks) are fine where they are.
- Selectors not unique to an extracted component continue to live
  in `src/App.css`. Per-component selectors co-locate with the
  component (see principle #6).

## Milestone targets

Baseline: ~7,570 lines (post-Tier 0). Per-phase deltas in each
phase header above; cumulative targets below.

| After phase | Target `App.tsx` LOC |
| ---: | ---: |
| 1 | ~7,420 |
| 2 | ~6,720 |
| 3 | ~6,420 |
| 4 | ~5,520 |
| 5 | ~5,270 |
| 6 | ~4,070 |
| 7 | ~3,170 |
| 8 | ~2,970 |
| 9 | ~2,370 |

A ~2,400-line `App.tsx` whose surface is "state, IPC, view routing"
is a healthy place to stop. We can revisit further splits once the
file's shape stabilizes.

## Rollout discipline

- One phase = one PR, reviewed and merged before the next starts.
- Each PR notes the line-count delta in its description so we can
  track the milestone table.
- If a phase reveals a non-trivial logic change is needed, the
  refactor stops and the change ships on its own branch first.
- Branches use the `refactor/app-tsx-phase-<n>-<slug>` pattern so
  history reads cleanly.
