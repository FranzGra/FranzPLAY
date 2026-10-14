import { jsx as _jsx } from "react/jsx-runtime";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { usePresence } from "./presence";
function Panel({ open }) {
    const panel = usePresence(open ? true : null);
    if (!panel.shown)
        return null;
    return (_jsx("div", { ref: panel.ref, "data-testid": "panel", "data-leaving": panel.leaving || undefined, children: "Pannello" }));
}
// playsAnimation makes the browser say the panel has a CSS animation, as a
// real one would with var(--motion-pop-out).
function playsAnimation() {
    const real = window.getComputedStyle;
    vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
        const style = real(element);
        if (element instanceof HTMLElement && element.dataset.testid === "panel") {
            return { ...style, animationName: "pop-out" };
        }
        return style;
    });
}
describe("usePresence", () => {
    it("shows at once and goes at once when nothing moves", () => {
        const { rerender } = render(_jsx(Panel, { open: false }));
        expect(screen.queryByTestId("panel")).not.toBeInTheDocument();
        rerender(_jsx(Panel, { open: true }));
        expect(screen.getByTestId("panel")).not.toHaveAttribute("data-leaving");
        rerender(_jsx(Panel, { open: false }));
        expect(screen.queryByTestId("panel")).not.toBeInTheDocument();
    });
    it("stays while its leaving move plays, and goes when it ends", () => {
        playsAnimation();
        const { rerender } = render(_jsx(Panel, { open: true }));
        rerender(_jsx(Panel, { open: false }));
        const panel = screen.getByTestId("panel");
        expect(panel).toHaveAttribute("data-leaving");
        // The end of a move inside the panel is not the panel's.
        const inner = document.createElement("span");
        panel.append(inner);
        fireEvent.animationEnd(inner);
        expect(screen.getByTestId("panel")).toBeInTheDocument();
        fireEvent.animationEnd(panel);
        expect(screen.queryByTestId("panel")).not.toBeInTheDocument();
    });
    it("comes back if opened again while leaving", () => {
        playsAnimation();
        const { rerender } = render(_jsx(Panel, { open: true }));
        rerender(_jsx(Panel, { open: false }));
        rerender(_jsx(Panel, { open: true }));
        expect(screen.getByTestId("panel")).not.toHaveAttribute("data-leaving");
    });
    it("goes anyway if the browser never says the move ended", () => {
        vi.useFakeTimers();
        try {
            playsAnimation();
            const { rerender } = render(_jsx(Panel, { open: true }));
            rerender(_jsx(Panel, { open: false }));
            expect(screen.getByTestId("panel")).toBeInTheDocument();
            act(() => vi.advanceTimersByTime(600));
            expect(screen.queryByTestId("panel")).not.toBeInTheDocument();
        }
        finally {
            vi.useRealTimers();
        }
    });
});
