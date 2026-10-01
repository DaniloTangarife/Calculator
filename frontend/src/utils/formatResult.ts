// formatResult turns a backend result into a display-friendly string,
// rounding away floating-point noise (e.g. 0.30000000000000004) while
// preserving up to 10 significant digits.
export function formatResult(value: number): string {
  if (!Number.isFinite(value)) {
    return "Error";
  }
  const rounded = Number(value.toPrecision(10)).toString();
  // JS's own toString uses a plain ASCII hyphen for a negative sign,
  // which reads visually inconsistent next to the proper minus sign
  // (OPERATOR_SYMBOLS.subtract, "−") shown everywhere else in the
  // expression. Only the leading sign is swapped — a "-" that shows up
  // later, in an exponent like "1e-7", is left alone.
  return rounded.startsWith("-") ? `−${rounded.slice(1)}` : rounded;
}
