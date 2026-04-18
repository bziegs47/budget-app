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
  rolloverInCents: number;
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
  rolloverInCents: number;
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
  ytd: YtdTotals;
};

export type MonthRow = {
  id: number;
  yearMonth: string;
  periodStart: string;
  periodEnd: string;
  tabLabel: string;
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
  encrypted: boolean;
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
