import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { VideoRow } from "./VideoRow";
function setup() {
    render(_jsx(MemoryRouter, { children: _jsxs(VideoRow, { title: "Ultimi arrivati", children: [_jsx("li", { children: "uno" }), _jsx("li", { children: "due" })] }) }));
    return screen.getByRole("list");
}
// size gives the row the measures jsdom does not calculate, and tells it
// it scrolled.
function size(list, scrollLeft, clientWidth, scrollWidth) {
    Object.defineProperty(list, "clientWidth", { value: clientWidth, configurable: true });
    Object.defineProperty(list, "scrollWidth", { value: scrollWidth, configurable: true });
    list.scrollLeft = scrollLeft;
    act(() => {
        fireEvent.scroll(list);
    });
}
describe("VideoRow arrows", () => {
    it("shows no arrows when every card fits", () => {
        const list = setup();
        size(list, 0, 1000, 1000);
        expect(screen.queryByRole("button", { name: /Avanti/ })).not.toBeInTheDocument();
    });
    it("moves the row and knows where it ends", async () => {
        const user = userEvent.setup();
        const list = setup();
        const scrollBy = vi.fn();
        list.scrollBy = scrollBy;
        size(list, 0, 1000, 3000);
        const back = screen.getByRole("button", { name: "Indietro: Ultimi arrivati" });
        const forward = screen.getByRole("button", { name: "Avanti: Ultimi arrivati" });
        expect(back).toBeDisabled();
        await user.click(forward);
        expect(scrollBy).toHaveBeenCalledWith({ left: 800, behavior: "smooth" });
        size(list, 2000, 1000, 3000);
        expect(back).toBeEnabled();
        expect(forward).toBeDisabled();
    });
});
