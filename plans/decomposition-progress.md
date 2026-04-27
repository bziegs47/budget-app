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
| 6 | Standalone views | — | — | pending |
| 7 | MonthBudgetView + row blocks | — | — | pending |
| 8 | IPC wrappers | — | — | pending |
| 9 | App-level hooks | — | — | pending |
| 10 | Polish (path aliases, cleanup) | — | — | pending |

Target: ~2,400 lines in App.tsx (state, IPC, view routing).

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
- **Sidebar section nav:** When viewing a month, expense bucket names
  appear as jump links under the active month in the sidebar. Clicking
  one smooth-scrolls to that card.
- **Cross-year back nav:** "‹ Dashboard" button appears in the sidebar
  during cross-year view; inline back buttons removed from the
  cross-year page.
- **Month data entry UX:**
  - Date field shows `MM / [DD] / YYYY` with month and year fixed from
    the active budget period — user only enters the day
  - Single-digit day entry (e.g. `5`) registers immediately
  - Enter key submits transaction/entry with "Added ✓" animation
  - All fields (including date) clear on submit
  - Actual column is clickable to toggle transaction/entry panel
  - Expanded detail panels collapse on view change
  - Money columns centered under headers in budget line tables
  - Actions column widened to prevent icon overflow

## Next up

### Phase 6 — Standalone views (~1,200 LOC)
`WelcomeScreen`, `LibraryView`, `BudgetDashboard`, `YearOverviewView`,
`CrossYearView`, `CrossYearMatrix`, `MonthlyBarsChart`, `YtdSlideOver`,
`YtdDualStrip`, `ReportsView`, `YearEndNudge`.

### Phase 7 — MonthBudgetView + row blocks (~900 LOC)
Largest single view. Extract into a folder with sibling row blocks.

### Phase 8 — IPC wrappers (~200 LOC)
Typed wrappers for `invoke` and `listen` calls.

### Phase 9 — App-level hooks (~600 LOC)
`useWorkspaceState`, `useMenuListeners`, `useViewRouter`.

### Phase 10 — Polish
Path aliases, top-of-file map, final cleanup.
