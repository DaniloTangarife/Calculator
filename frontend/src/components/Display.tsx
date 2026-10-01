interface DisplayProps {
  expression: string;
  preview: string | null;
  result: string | null;
  error: string | null;
}

// The error message shares the same small line the live preview uses
// (styled to stand out a little from a normal preview), rather than a
// separate alert banner — so a mistake reads as "here's why", not as an
// alarm, and what was actually typed (e.g. "9÷0") stays fully visible
// instead of being hidden.
export function Display({ expression, preview, result, error }: DisplayProps) {
  const isEditing = result === null;

  let secondaryLine = " ";
  if (isEditing) {
    if (error !== null) {
      secondaryLine = error;
    } else if (preview !== null) {
      secondaryLine = `= ${preview}`;
    }
  }

  return (
    <div className="display">
      <div className="display-main" role="status" aria-live="polite" data-testid="display-expression">
        {result ?? expression}
        {isEditing && <span className="cursor" aria-hidden="true" />}
      </div>
      <div
        className={`display-preview${error ? " display-preview-error" : ""}`}
        role={error ? "alert" : undefined}
        data-testid="display-preview"
      >
        {secondaryLine}
      </div>
    </div>
  );
}
