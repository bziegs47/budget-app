# App.tsx decomposition — progress tracker

Companion to `app-tsx-decomposition.md` (the full plan). This file tracks
what's landed, what's next, and the running line counts.

## Line count tracker

| Phase | Description | App.tsx | App.css | PR |
|------:|:------------|--------:|--------:|:---|
| — | Baseline (pre-decomposition) | 7,658 | 3,405 | — |
| 1 | Icons → `components/icons/` | 7,420 | 3,405 | merged |
| 2 | Primitive widgets → `components/primitives/` | 6,987 | 2,921 | [#12](https://github.com/bziegs47/budget-app/pull/12) |
| 3 | Focus-trap hook + leaf modals → `components/modals/` | 6,553 | 2,853 | [#13](https://github.com/bziegs47/budget-app/pull/13) |
| 4 | Workspace + year/month modals → `components/modals/` | 5,115 | 2,546 | [#14](https://github.com/bziegs47/budget-app/pull/14) |
| 5 | Sidebar + UX polish | 4,918 | 2,172 | [#15](https://github.com/bziegs47/budget-app/pull/15) |
| 6 | Standalone views → `views/` | 2,933 | 2,172 | [#16](https://github.com/bziegs47/budget-app/pull/16) |
| 7 | MonthBudgetView → `views/MonthBudgetView/` | 2,289 | 2,172 | [#17](https://github.com/bziegs47/budget-app/pull/17) |
| 8 | Typed IPC wrappers → `app/ipc/` | 2,313 | 2,172 | [#18](https://github.com/bziegs47/budget-app/pull/18) |
| 9 | App-level hooks → `app/state/` | 2,196 | 2,172 | [#19](https://github.com/bziegs47/budget-app/pull/19) |
| 10 | Polish + final cleanup | 2,196 | 2,172 | [#20](https://github.com/bziegs47/budget-app/pull/20) |

**Result:** 7,658 → 2,196 lines (−71%). App.tsx is now state, IPC, view
routing, and a thin JSX shell — exactly the target shape from the plan.

## Completed phases

### Phase 1 — Icons (~150 LOC)
Extracted 7 icon components to `src/components/icons/` with barrel index.

### Phase 2 — Primitive widgets (~670 LOC)
Extracted to `src/components/primitives/`:
- `IconButton`, `SaveStatusPill`, `PopoverCalendar`, `DateField`,
  `PlannedAmountInput`, `ExportPickerButton`
- Each with co-located CSS. Private helpers (`relativeTimeShort`,
  `isoToParts`, `partsToIso`, `isoOfDate`, `DOW_LABELS`) moved with
  their owning component.

### Phase 3 — Focus-trap hook + leaf modals (~500 LOC)
Extracted to `src/components/modals/`:
- `useModalFocusTrap` + `preventFocusSteal` (shared hook)
- `BucketReorderModal`, `UnsavedChangesModal`, `ConfirmDeleteRowModal`,
  `OpenInWindowModal`

### Phase 4 — Workspace + year/month modals (~1,740 LOC)
Extracted to `src/components/modals/`:
- `ExpenseLineEditModal`, `PasswordModal`, `PreferencesModal`,
  `CreateYearModal`, `RenameYearModal`, `DeleteYearConfirmModal`,
  `RenameWorkspaceModal`, `DeleteWorkspaceConfirmModal`,
  `DuplicateYearModal`
- Helper types (`ExpenseLineEditConfig`, `PasswordModalKind`,
  `PreferenceSectionId`) moved with their owning component.

### Phase 5 — Sidebar + UX polish
Extracted to `src/components/sidebar/`:
- `Sidebar`, `YearListRow`, `MonthRowItem` with co-located CSS
- `AppView` type moved to `src/types.ts` to avoid circular imports

Additional scope bundled into this branch:
- **Sidebar section nav:** expense bucket jump links under the active month
- **Cross-year back nav:** "‹ Dashboard" in sidebar, inline back buttons removed
- **Month data entry UX:** day-only date input, Enter-to-submit with animation,
  clickable actual column, auto-collapse on view change, centered money columns,
  wider actions column

### Phase 6 — Standalone views (~1,985 LOC)
Extracted to `src/views/`:
- `WelcomeScreen`, `YearEndNudge`, `BudgetDashboard`
  (+`BudgetDashboardSnapshot`), `LibraryView`, `YearOverviewView`,
  `CrossYearView` (+`CrossYearMatrix`, `aggregateLineRows`),
  `MonthlyBarsChart`, `YtdSlideOver`, `ReportsView`, `YtdDualStrip`
- Shared helpers in `src/views/helpers.ts`

### Phase 7 — MonthBudgetView + row blocks (~644 LOC)
Extracted to `src/views/MonthBudgetView/`:
- `MonthBudgetView`, `SummaryRow`, `IncomeLineBlock`
  (+`IncomeEntriesPanel`), `ExpenseLineBlock` (+`TransactionsPanel`)

### Phase 8 — Typed IPC wrappers
Created `src/app/ipc/`:
- `commands.ts` — typed wrapper functions for all 63 Tauri commands
- `events.ts` — typed menu event helpers
- Migrated all raw `invoke()` calls in App.tsx

### Phase 9 — App-level hooks (~117 LOC)
Created `src/app/state/`:
- `useSyncedRef` — ref-mirroring utility
- `useMenuListeners` — menu event bindings + encryption handlers

`useWorkspaceState` and `useViewRouter` from the original plan were
skipped: the remaining state is too intertwined to extract without
creating leaky abstractions, and the file is already well below target.

### Phase 10 — Polish
Final cleanup: updated progress tracker, verified no dead code remains,
all type checks and builds pass.

## Final layout

```
src/
  App.tsx                           # 2,196 lines — state, routing, JSX shell
  App.css                           # 2,172 lines
  types.ts                          # shared TS types + AppView
  money.ts                          # USD formatting/parsing
  app/
    ipc/
      commands.ts                   # typed invoke wrappers (63 commands)
      events.ts                     # typed menu event helpers
      index.ts
    state/
      useSyncedRef.ts               # ref-mirroring hook
      useMenuListeners.ts           # menu event bindings
      index.ts
  components/
    icons/                          # 7 SVG icon components + barrel
    primitives/                     # 6 form widgets + co-located CSS
    modals/                         # 13 modal components + focus-trap hook
    sidebar/                        # Sidebar + YearListRow + MonthRowItem
  views/
    helpers.ts                      # shared view helpers
    WelcomeScreen.tsx
    YearEndNudge.tsx
    BudgetDashboard.tsx
    LibraryView.tsx
    YearOverviewView.tsx
    CrossYearView.tsx
    MonthlyBarsChart.tsx
    YtdSlideOver.tsx
    ReportsView.tsx
    YtdDualStrip.tsx
    MonthBudgetView/
      index.tsx
      SummaryRow.tsx
      IncomeLineBlock.tsx
      ExpenseLineBlock.tsx
    index.ts                        # barrel
```
