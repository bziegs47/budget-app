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
