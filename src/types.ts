export type IncomeEntryDto = {
  id: number;
  incomeLineId: number;
  receivedOn: string | null;
  label: string;
  amountCents: number;
  sortOrder: number;
};

export type IncomeLineDto = {
  id: number;
  lineIdentity: string;
  name: string;
  sortOrder: number;
  plannedCents: number;
  actualCents: number;
  varianceCents: number;
  entries: IncomeEntryDto[];
};

export type TransactionDto = {
  id: number;
  expenseLineId: number;
  occurredOn: string | null;
  payee: string;
  amountCents: number;
  sortOrder: number;
};

export type ExpenseLineDto = {
  id: number;
  bucketId: number;
  lineIdentity: string;
  name: string;
  sortOrder: number;
  plannedCents: number;
  isNeutralTransfer: boolean;
  isSinkingFund: boolean;
  annualEstimateCents: number | null;
  dueMonthHint: number | null;
  actualCents: number;
  varianceCents: number;
  transactions: TransactionDto[];
};

export type ExpenseBucketDto = {
  id: number;
  name: string;
  sortOrder: number;
  lines: ExpenseLineDto[];
};

export type MonthSummary = {
  incomePlannedCents: number;
  incomeActualCents: number;
  incomeVarianceCents: number;
  expenseNetPlannedCents: number;
  expenseNetActualCents: number;
  expenseNetVarianceCents: number;
  neutralExpensePlannedCents: number;
  neutralExpenseActualCents: number;
  netPlannedCents: number;
  netActualCents: number;
  netVarianceCents: number;
};

export type YtdTotals = {
  year: number;
  throughMonth: string;
  incomeActualCents: number;
  expenseNetActualCents: number;
  netActualCents: number;
};

export type MonthView = {
  yearMonth: string;
  monthId: number;
  periodStart: string;
  periodEnd: string;
  tabLabel: string;
  incomeLines: IncomeLineDto[];
  expenseBuckets: ExpenseBucketDto[];
  summary: MonthSummary;
  /** YTD aggregated by budget period (which periods have closed up to this month). */
  ytd: YtdTotals;
  /** YTD aggregated by transaction date (occurredOn / receivedOn) within the calendar year. */
  ytdByDate: YtdTotals;
};

export type MonthRow = {
  id: number;
  yearMonth: string;
  periodStart: string;
  periodEnd: string;
  tabLabel: string;
  yearId: number | null;
  yearLabel: string;
  /** 1-12 for clean calendar months; null for any leftover non-calendar period. */
  calendarMonth: number | null;
};

export type YearRow = {
  id: number;
  yearLabel: string;
  sortOrder: number;
  /** Total scaffolded months for the year (always 12 once auto-scaffold runs). */
  monthCount: number;
  /** Months with at least one income entry or non-neutral transaction. */
  trackedMonthCount: number;
  incomeActualCents: number;
  expenseNetActualCents: number;
  netActualCents: number;
};

export type DuplicateYearArgs = {
  destYearLabel: string;
  mode: "perMonth" | "singleSource";
  sourceMonthId?: number;
};

export type WorkspaceMeta = {
  yearLabel: string;
  displayName: string | null;
  fileUuid: string;
  schemaVersion: number;
  createdAt: string;
  updatedAt: string;
};

export type ExternalRenameInfo = {
  yearLabel: string;
  fileBasename: string;
  isDefaultWorkspace: boolean;
  matches: boolean;
};

export type BucketRollup = {
  name: string;
  plannedCents: number;
  actualCents: number;
  varianceCents: number;
};

export type MonthSummaryRow = {
  monthId: number;
  label: string;
  periodStart: string;
  periodEnd: string;
  incomePlannedCents: number;
  incomeActualCents: number;
  expenseNetPlannedCents: number;
  expenseNetActualCents: number;
  netPlannedCents: number;
  netActualCents: number;
};

export type YearOverview = {
  yearLabel: string;
  incomePlannedCents: number;
  incomeActualCents: number;
  expenseNetPlannedCents: number;
  expenseNetActualCents: number;
  netPlannedCents: number;
  netActualCents: number;
  buckets: BucketRollup[];
  months: MonthSummaryRow[];
};

export type RecentFile = {
  path: string;
  yearLabel: string;
  lastOpenedAt: string;
};

export type AppSettings = {
  defaultFolder: string | null;
  recentFiles: RecentFile[];
  sidebarCollapsed: boolean;
};

export type LibraryEntry = {
  path: string;
  yearLabel: string;
  displayName: string | null;
  fileUuid: string;
  lastModified: string;
  sizeBytes: number;
  incomeActualCents: number;
  expenseNetActualCents: number;
  netActualCents: number;
  monthCount: number;
  /** Months that have at least one income entry or non-neutral
   * transaction. Optional for backward compatibility with cached
   * library indexes written before this field existed. */
  trackedMonthCount?: number;
  /** Distinct calendar years in this budget, sorted descending. */
  yearLabels?: string[];
  /** Convenience count; equals `yearLabels?.length ?? 0`. */
  yearCount?: number;
  encrypted: boolean;
  provider?: string | null;
  isConflictCopy?: boolean;
  lastEditedAt?: string | null;
};

export type CloudFolderProbe = {
  provider: string;
  path: string;
  exists: boolean;
  isDefault: boolean;
  workspaceCount: number;
};

export type WorkspaceLineCatalogEntry = {
  lineKind: "income" | "expense";
  lineIdentity: string;
  displayName: string;
  bucketName: string | null;
};

export type CalendarMonthBucket = {
  month: number;
  totalCents: number;
};

export type CalendarReportEntry = {
  id: number;
  occurredOn: string | null;
  label: string;
  amountCents: number;
};

export type LineCalendarReport = {
  year: number;
  lineKind: string;
  lineIdentity: string;
  displayName: string;
  rangeStart: string;
  rangeEnd: string;
  totalCents: number;
  monthly: CalendarMonthBucket[];
  entries: CalendarReportEntry[];
};

export type MultiLineCalendarRow = {
  lineKind: string;
  lineIdentity: string;
  displayName: string;
  totalCents: number;
};

export type MultiLineCalendarReport = {
  year: number;
  rangeStart: string;
  rangeEnd: string;
  rows: MultiLineCalendarRow[];
  combinedMonthly: CalendarMonthBucket[];
  combinedTotalCents: number;
};

export type LineRef = {
  lineKind: "income" | "expense";
  lineIdentity: string;
};

export type ReportsViewSeed = {
  year: number;
  asOf: string | null;
  selected: LineRef[];
};

export type CrossYearColumn = {
  yearId: number;
  yearLabel: string;
  incomePlannedCents: number;
  incomeActualCents: number;
  expensePlannedCents: number;
  expenseActualCents: number;
  netPlannedCents: number;
  netActualCents: number;
  trackedMonthCount: number;
};

export type CrossYearCell = {
  plannedCents: number;
  actualCents: number;
};

export type CrossYearBucketRow = {
  bucketName: string;
  cells: CrossYearCell[];
  totalPlannedCents: number;
  totalActualCents: number;
};

export type CrossYearLineRow = {
  lineKind: "income" | "expense";
  lineIdentity: string;
  displayName: string;
  bucketName: string | null;
  cells: CrossYearCell[];
  totalPlannedCents: number;
  totalActualCents: number;
};

export type CrossYearOverview = {
  columns: CrossYearColumn[];
  bucketRows: CrossYearBucketRow[];
  lineRows: CrossYearLineRow[];
};
