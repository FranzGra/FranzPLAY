import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NewSecret } from "./NewSecret";

// shaking finds the pad or grid showing an error.
const shaking = () => document.querySelector('[class*="shake"]');

describe("new PIN or pattern", () => {
  it("shakes only after a mistake, never when it appears", async () => {
    const user = userEvent.setup();
    render(<NewSecret allowed={["password", "pin", "pattern"]} onChange={() => {}} />);
    await user.click(screen.getByRole("radio", { name: "PIN" }));
    expect(shaking()).toBeNull();
    await user.click(screen.getByRole("radio", { name: "Sequenza" }));
    expect(shaking()).toBeNull();

    // Too few dots: a mistake, so it shakes.
    const draw = async (keys: string) => {
      screen.getByRole("button", { name: /^Punto 7/ }).focus();
      await user.keyboard(keys);
      await user.click(screen.getByRole("button", { name: "Fatto" }));
    };
    await draw(" {ArrowUp} ");
    expect(shaking()).not.toBeNull();

    // The next step is a new grid: the old mistake does not shake it.
    await draw(" {ArrowUp} {ArrowUp} {ArrowRight} {ArrowRight} ");
    await user.click(await screen.findByRole("button", { name: "Continua" }));
    expect(screen.getByText("Ridisegnala per confermare")).toBeInTheDocument();
    expect(shaking()).toBeNull();

    // Back to the PIN and to the pattern again: still calm.
    await user.click(screen.getByRole("radio", { name: "PIN" }));
    expect(shaking()).toBeNull();
    await user.keyboard("123456");
    await user.click(await screen.findByRole("button", { name: "Continua" }));
    expect(shaking()).toBeNull();
    await user.keyboard("654321");
    expect(shaking()).not.toBeNull();
  });
});
