// formatResult turns a backend result into a display-friendly string,
// rounding away floating-point noise (e.g. 0.30000000000000004) while
// preserving up to 10 significant digits.
export function formatResult(value: number): string {
  if (Number.isNaN(value)) {
    return "Error";
  }
  // An overflowing calculation (e.g. 4^1000) legitimately produces
  // +/-Infinity, not an error — a physical calculator shows the
  // infinity symbol for this, not a failure message.
  if (!Number.isFinite(value)) {
    return value > 0 ? "∞" : "−∞";
  }
  const rounded = Number(value.toPrecision(10)).toString();
  // JS's own toString uses a plain ASCII hyphen for a negative sign,
  // which reads visually inconsistent next to the proper minus sign
  // (OPERATOR_SYMBOLS.subtract, "−") shown everywhere else in the
  // expression. Only the leading sign is swapped — a "-" that shows up
  // later, in an exponent like "1e-7", is left alone.
  return rounded.startsWith("-") ? `−${rounded.slice(1)}` : rounded;
}
