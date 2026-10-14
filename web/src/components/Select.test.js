import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { Select } from "./Select";
const sizes = [
    { value: 1, label: "1 GB" },
    { value: 5, label: "5 GB" },
    { value: 10, label: "10 GB" },
    { value: 50, label: "50 GB" },
];
function Sizes({ onChange = () => { } }) {
    const [value, setValue] = useState(5);
    return (_jsx(Select, { "aria-label": "Spazio", value: value, options: sizes, onChange: (v) => {
            setValue(v);
            onChange(v);
        } }));
}
describe("Select", () => {
    it("shows the chosen words and opens its list with the mouse", async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(_jsx(Sizes, { onChange: onChange }));
        const box = screen.getByRole("combobox", { name: "Spazio" });
        expect(box).toHaveTextContent("5 GB");
        expect(box).toHaveAttribute("aria-expanded", "false");
        expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
        await user.click(box);
        expect(box).toHaveAttribute("aria-expanded", "true");
        expect(screen.getByRole("option", { name: "5 GB" })).toHaveAttribute("aria-selected", "true");
        await user.click(screen.getByRole("option", { name: "50 GB" }));
        expect(onChange).toHaveBeenCalledWith(50);
        expect(box).toHaveTextContent("50 GB");
        expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
        expect(box).toHaveFocus();
    });
    it("works with the keyboard like the browser's own", async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(_jsx(Sizes, { onChange: onChange }));
        const box = screen.getByRole("combobox", { name: "Spazio" });
        box.focus();
        await user.keyboard("{ArrowDown}");
        expect(screen.getByRole("listbox")).toBeInTheDocument();
        // It opens on the chosen one.
        expect(box.getAttribute("aria-activedescendant")).toBe(screen.getByRole("option", { name: "5 GB" }).id);
        await user.keyboard("{ArrowDown}{ArrowDown}{Enter}");
        expect(onChange).toHaveBeenLastCalledWith(50);
        await user.keyboard("{End}{Escape}");
        expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
        expect(onChange).toHaveBeenCalledTimes(1);
        // Typing jumps to a choice that starts with those letters.
        await user.keyboard("1");
        await user.keyboard("{Enter}");
        expect(onChange).toHaveBeenLastCalledWith(1);
    });
    it("closes without choosing when clicking elsewhere", async () => {
        const user = userEvent.setup();
        const onChange = vi.fn();
        render(_jsxs(_Fragment, { children: [_jsx(Sizes, { onChange: onChange }), _jsx("p", { children: "Fuori" })] }));
        await user.click(screen.getByRole("combobox", { name: "Spazio" }));
        await user.click(screen.getByText("Fuori"));
        expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
        expect(onChange).not.toHaveBeenCalled();
    });
    it("does not open while disabled", async () => {
        const user = userEvent.setup();
        render(_jsx(Select, { "aria-label": "Spazio", value: 1, options: sizes, onChange: () => { }, disabled: true }));
        await user.click(screen.getByRole("combobox", { name: "Spazio" }));
        expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    });
});
