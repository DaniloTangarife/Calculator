import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Calculator } from "./Calculator";

function mockFetchOnce(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    }),
  );
}

describe("Calculator", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("computes 2 + 3 through the backend and shows the result big once equals is pressed", async () => {
    const user = userEvent.setup();
    mockFetchOnce(200, { result: 5 });
    render(<Calculator />);

    await user.click(screen.getByText("2"));
    await user.click(screen.getByLabelText("Add"));
    await user.click(screen.getByText("3"));
    await user.click(screen.getByLabelText("Equals"));

    expect(await screen.findByTestId("display-expression")).toHaveTextContent("5");
  });

  it("shows a live preview as soon as the first pair is typed, without pressing another operator", async () => {
    const user = userEvent.setup();
    mockFetchOnce(200, { result: 81 });
    render(<Calculator />);

    await user.click(screen.getByText("9"));
    await user.click(screen.getByLabelText("Multiply"));
    await user.click(screen.getByText("9"));

    expect(screen.getByTestId("display-expression")).toHaveTextContent("9×9");
    expect(await screen.findByTestId("display-preview")).toHaveTextContent("= 81");
  });

  it("shows the backend's error message inline, keeping the typed expression visible", async () => {
    const user = userEvent.setup();
    mockFetchOnce(400, { error: { code: "DIVISION_BY_ZERO", message: "division by zero" } });
    render(<Calculator />);

    await user.click(screen.getByText("1"));
    await user.click(screen.getByLabelText("Divide"));
    await user.click(screen.getByText("0"));
    await user.click(screen.getByLabelText("Equals"));

    expect(await screen.findByRole("alert")).toHaveTextContent("Can't divide by zero");
    expect(screen.getByTestId("display-expression")).toHaveTextContent("1÷0");
  });

  it("clears the display back to 0", async () => {
    const user = userEvent.setup();
    render(<Calculator />);

    await user.click(screen.getByText("9"));
    expect(screen.getByTestId("display-expression")).toHaveTextContent("9");

    await user.click(screen.getByText("C"));
    expect(screen.getByTestId("display-expression")).toHaveTextContent("0");
  });

  it("supports typing an expression and pressing Enter with the physical keyboard", async () => {
    const user = userEvent.setup();
    mockFetchOnce(200, { result: 6 });
    render(<Calculator />);

    await user.keyboard("9-3");
    expect(screen.getByTestId("display-expression")).toHaveTextContent("9−3");

    await user.keyboard("{Enter}");
    expect(await screen.findByTestId("display-expression")).toHaveTextContent("6");
  });

  it("supports Backspace and Escape from the physical keyboard", async () => {
    const user = userEvent.setup();
    render(<Calculator />);

    await user.keyboard("123");
    expect(screen.getByTestId("display-expression")).toHaveTextContent("123");

    await user.keyboard("{Backspace}");
    expect(screen.getByTestId("display-expression")).toHaveTextContent("12");

    await user.keyboard("{Escape}");
    expect(screen.getByTestId("display-expression")).toHaveTextContent("0");
  });

  it("supports parentheses from the physical keyboard", async () => {
    const user = userEvent.setup();
    mockFetchOnce(200, { result: 5 });
    render(<Calculator />);

    await user.keyboard("(2+3)");
    expect(await screen.findByTestId("display-expression")).toHaveTextContent("(2+3)");
  });

  it("shows sqrt as √16 with its value already previewed", async () => {
    const user = userEvent.setup();
    mockFetchOnce(200, { result: 4 });
    render(<Calculator />);

    await user.click(screen.getByText("1"));
    await user.click(screen.getByText("6"));
    await user.click(screen.getByLabelText("Square root"));

    expect(await screen.findByTestId("display-expression")).toHaveTextContent("√16");
    expect(await screen.findByTestId("display-preview")).toHaveTextContent("= 4");
  });

  it("treats a number followed directly by ( as multiplication", async () => {
    const user = userEvent.setup();
    mockFetchOnce(200, { result: 18 });
    render(<Calculator />);

    await user.click(screen.getByText("9"));
    await user.click(screen.getByLabelText("Open parenthesis"));
    expect(screen.getByTestId("display-expression")).toHaveTextContent("9×(");

    await user.click(screen.getByText("2"));
    await user.click(screen.getByLabelText("Close parenthesis"));
    expect(screen.getByTestId("display-expression")).toHaveTextContent("9×(2)");

    await user.click(screen.getByLabelText("Equals"));
    expect(await screen.findByTestId("display-expression")).toHaveTextContent("18");
  });

  it("has a backspace button and parenthesis buttons on the keypad", () => {
    render(<Calculator />);

    expect(screen.getByLabelText("Backspace")).toBeInTheDocument();
    expect(screen.getByLabelText("Open parenthesis")).toBeInTheDocument();
    expect(screen.getByLabelText("Close parenthesis")).toBeInTheDocument();
  });
});
