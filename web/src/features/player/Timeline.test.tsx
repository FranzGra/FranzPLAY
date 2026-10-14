import { fireEvent, render, screen } from "@testing-library/react";
import { Timeline } from "./Timeline";

const preview = {
  src: "/api/previews/7-0a1b2c3d.jpg",
  gap: 2,
  count: 45,
  columns: 10,
  width: 480,
  height: 270,
};

// point moves the pointer over the timeline, at fraction of its width.
function point(fraction: number) {
  const slider = screen.getByRole("slider", { name: "Posizione nel video" });
  vi.spyOn(slider, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 1000, 24));
  fireEvent.pointerMove(slider, { clientX: fraction * 1000 });
}

describe("timeline", () => {
  it("shows the frame of the time pointed at", () => {
    render(<Timeline time={0} duration={90} buffered={0} onSeek={() => {}} preview={preview} />);
    expect(screen.queryByTestId("preview")).not.toBeInTheDocument();
    point(0.5); // 45 seconds: frame 22, third row
    const frame = screen.getByTestId("preview");
    expect(frame).toHaveTextContent("0:45");
    const image = frame.firstElementChild as HTMLElement;
    expect(image.style.backgroundImage).toBe('url("/api/previews/7-0a1b2c3d.jpg")');
    expect(image.style.backgroundPosition).toBe("22.2222% 50%");
    expect(image.style.backgroundSize).toBe("1000% 500%");

    fireEvent.pointerLeave(screen.getByRole("slider"));
    expect(screen.queryByTestId("preview")).not.toBeInTheDocument();
  });

  it("shows only the time while the previews are not ready", () => {
    render(<Timeline time={0} duration={90} buffered={0} onSeek={() => {}} preview={null} />);
    point(0.5);
    expect(screen.queryByTestId("preview")).not.toBeInTheDocument();
    expect(screen.getByText("0:45")).toBeInTheDocument();
  });
});
