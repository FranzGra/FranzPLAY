import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { type FormEvent, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { ComboBox } from "./ComboBox";

const fruits = ["Mele", "Pere", "Prugne", "Uva"];

function Fruits({
  start = "",
  onChange = () => {},
}: {
  start?: string;
  onChange?: (v: string) => void;
}) {
  const [value, setValue] = useState(start);
  return (
    <>
      <label htmlFor="fruit">Frutta</label>
      <ComboBox
        id="fruit"
        value={value}
        options={fruits}
        toggleLabel="Elenco della frutta"
        newLabel={(text) => `Nuova: «${text}»`}
        onChange={(v) => {
          setValue(v);
          onChange(v);
        }}
      />
      <button type="button">Altro</button>
    </>
  );
}

function shownChoices() {
  return screen.getAllByRole("option").map((o) => o.textContent);
}

describe("ComboBox", () => {
  it("opens the whole list with a click, even with words in the field", async () => {
    const user = userEvent.setup();
    render(<Fruits start="Ciao" />);
    const field = screen.getByRole("combobox", { name: "Frutta" });
    expect(field).toHaveAttribute("aria-expanded", "false");
    await user.click(field);
    expect(field).toHaveAttribute("aria-expanded", "true");
    expect(field).toHaveValue("Ciao");
    expect(shownChoices()).toEqual(fruits);
    expect(field).toHaveAttribute("aria-controls", screen.getByRole("listbox").id);
  });

  it("opens and closes the whole list with the arrow", async () => {
    const user = userEvent.setup();
    render(<Fruits start="Pere" />);
    const arrow = screen.getByRole("button", { name: "Elenco della frutta" });
    await user.click(arrow);
    expect(shownChoices()).toEqual(fruits);
    expect(screen.getByRole("option", { name: "Pere" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("combobox")).toHaveFocus();
    await user.click(arrow);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("narrows the list while typing, and keeps words that are not in it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Fruits onChange={onChange} />);
    const field = screen.getByRole("combobox");
    await user.type(field, "pr");
    expect(shownChoices()).toEqual(["Prugne", "Nuova: «pr»"]);
    await user.type(field, "x");
    expect(shownChoices()).toEqual(["Nuova: «prx»"]);
    await user.click(screen.getByRole("button", { name: "Altro" }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(field).toHaveValue("prx");
    expect(onChange).toHaveBeenLastCalledWith("prx");
  });

  it("works with the keyboard: arrows, Enter and Esc", async () => {
    const user = userEvent.setup();
    // What holds the field, like a window, must not hear the Esc that closes the list.
    const heard: string[] = [];
    const listen = (event: KeyboardEvent) => heard.push(event.key);
    document.addEventListener("keydown", listen);
    render(<Fruits />);
    const field = screen.getByRole("combobox");
    await user.tab();
    expect(field).toHaveFocus();
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    await user.keyboard("{ArrowDown}");
    expect(shownChoices()).toEqual(fruits);
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowUp}");
    expect(field).toHaveAttribute(
      "aria-activedescendant",
      screen.getByRole("option", { name: "Mele" }).id,
    );
    await user.keyboard("{ArrowDown}{Enter}");
    expect(field).toHaveValue("Pere");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    await user.keyboard("{ArrowDown}");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(field).toHaveValue("Pere");
    document.removeEventListener("keydown", listen);
    expect(heard).not.toContain("Escape");
  });

  it("does not send the form on Enter while the list is open", async () => {
    const user = userEvent.setup();
    const submit = vi.fn((event: FormEvent) => event.preventDefault());
    render(
      <form onSubmit={submit}>
        <Fruits />
      </form>,
    );
    await user.type(screen.getByRole("combobox"), "Nuova{Enter}");
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox")).toHaveValue("Nuova");
    await user.keyboard("{Enter}");
    expect(submit).toHaveBeenCalledOnce();
  });

  it("can be emptied", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Fruits start="Uva" onChange={onChange} />);
    await user.clear(screen.getByRole("combobox"));
    expect(onChange).toHaveBeenLastCalledWith("");
    expect(shownChoices()).toEqual(fruits);
  });
});
