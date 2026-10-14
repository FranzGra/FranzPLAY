import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ShareButton } from "./ShareButton";

function setup() {
  const user = userEvent.setup();
  render(<ShareButton title="Gita al mare" path="/video/7" />);
  return { user, url: `${window.location.origin}/video/7` };
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, "share");
});

describe("share button", () => {
  it("opens the phone's share panel when there is one", async () => {
    const { user, url } = setup();
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    await user.click(screen.getByRole("button", { name: "Condividi" }));
    expect(share).toHaveBeenCalledWith({ title: "Gita al mare", url });
    expect(screen.getByRole("button", { name: "Condividi" })).toBeInTheDocument();
  });

  it("does nothing more when the person closes the share panel", async () => {
    const { user } = setup();
    const share = vi.fn().mockRejectedValue(new DOMException("closed", "AbortError"));
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    await user.click(screen.getByRole("button", { name: "Condividi" }));
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Condividi" })).toBeInTheDocument();
  });

  it("copies the link where there is no share panel", async () => {
    const { user, url } = setup();
    vi.stubGlobal("isSecureContext", true);
    await user.click(screen.getByRole("button", { name: "Condividi" }));
    expect(await screen.findByRole("button", { name: "Link copiato" })).toBeInTheDocument();
    expect(await navigator.clipboard.readText()).toBe(url);
  });

  it("copies the link also on plain http", async () => {
    const { user, url } = setup();
    vi.stubGlobal("isSecureContext", false);
    let copied = "";
    const execCommand = vi.fn(() => {
      copied = document.querySelector("textarea")?.value ?? "";
      return true;
    });
    Object.defineProperty(document, "execCommand", { value: execCommand, configurable: true });
    await user.click(screen.getByRole("button", { name: "Condividi" }));
    expect(await screen.findByRole("button", { name: "Link copiato" })).toBeInTheDocument();
    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(copied).toBe(url);
    expect(document.querySelector("textarea")).toBeNull();
  });

  it("says so when the link cannot be copied", async () => {
    const { user } = setup();
    vi.stubGlobal("isSecureContext", false);
    Object.defineProperty(document, "execCommand", { value: () => false, configurable: true });
    vi.spyOn(console, "error").mockImplementation(() => {});
    await user.click(screen.getByRole("button", { name: "Condividi" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("non si riesce a copiare");
  });
});
