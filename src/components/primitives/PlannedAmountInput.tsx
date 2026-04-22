import "./PlannedAmountInput.css";

function selectAllOnFocus(e: React.FocusEvent<HTMLInputElement>) {
  e.currentTarget.select();
}

export function PlannedAmountInput({
  value,
  onChange,
  onBlur,
  invalid = false,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  invalid?: boolean;
}) {
  const cls = `currency-field${invalid ? " is-invalid" : ""}`;
  return (
    <span className={cls}>
      <span className="currency-symbol">$</span>
      <input
        className="input-money"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={selectAllOnFocus}
        onBlur={onBlur}
        inputMode="decimal"
        autoComplete="off"
        aria-label="Planned amount (USD)"
        aria-invalid={invalid || undefined}
      />
      {invalid && (
        <span className="currency-field-error">Couldn't read amount</span>
      )}
    </span>
  );
}
