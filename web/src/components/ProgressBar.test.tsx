import { render, screen } from "@testing-library/react";
import { BusyRing, clampPercent, ProgressBar } from "./ProgressBar";

describe("progress bar", () => {
  it("fills as much as is done, and says it", () => {
    render(<ProgressBar percent={42.26} label="Scarico il modello medium" />);
    const bar = screen.getByRole("progressbar", { name: "Scarico il modello medium" });
    expect(bar).toHaveAttribute("aria-valuenow", "42.3");
    expect(bar).toHaveAttribute("aria-valuetext", "42%");
    expect(bar).not.toHaveAttribute("data-indeterminate");
    expect(bar.firstElementChild).toHaveStyle({ width: "42.3%" });
  });

  it("runs back and forth when how much is done is not known", () => {
    render(<ProgressBar percent={null} label="Copertina di Mare" size="small" />);
    const bar = screen.getByRole("progressbar", { name: "Copertina di Mare" });
    expect(bar).not.toHaveAttribute("aria-valuenow");
    expect(bar).toHaveAttribute("aria-valuetext", "In corso");
    expect(bar).toHaveAttribute("data-indeterminate", "true");
    expect(bar).toHaveAttribute("data-size", "small");
  });

  it("stays between 0 and 100", () => {
    expect(clampPercent(-5)).toBe(0);
    expect(clampPercent(150)).toBe(100);
    expect(clampPercent(Number.NaN)).toBe(0);
    render(<ProgressBar percent={130} label="Disco" working={false} tone="danger" />);
    const bar = screen.getByRole("progressbar", { name: "Disco" });
    expect(bar).toHaveAttribute("aria-valuenow", "100");
    expect(bar).not.toHaveAttribute("data-working");
    expect(bar).toHaveAttribute("data-tone", "danger");
  });

  it("has a ring that says what it waits for only when asked", () => {
    const { container, rerender } = render(<BusyRing />);
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
    rerender(<BusyRing label="Controllo in corso" />);
    expect(screen.getByRole("status")).toHaveTextContent("Controllo in corso");
  });
});
