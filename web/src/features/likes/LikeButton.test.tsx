import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { fakeServer } from "../../test/render";
import { LikeButton } from "./LikeButton";

function setup(routes: Parameters<typeof fakeServer>[0]) {
  const server = fakeServer(routes);
  const user = userEvent.setup();
  render(<LikeButton videoId={7} />);
  return { user, server };
}

describe("like button", () => {
  it("shows how many people like the video", async () => {
    setup({ "GET /api/videos/7/like": { body: { liked: false, count: 3 } } });
    const button = await screen.findByRole("button", { name: "Mi piace" });
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(button).toHaveTextContent("3");
    expect(screen.getByText("Piace a 3 persone")).toBeInTheDocument();
  });

  it("likes and unlikes", async () => {
    const { user, server } = setup({
      "GET /api/videos/7/like": { body: { liked: false, count: 0 } },
      "PUT /api/videos/7/like": { body: { liked: true, count: 1 } },
      "DELETE /api/videos/7/like": { body: { liked: false, count: 0 } },
    });
    const button = await screen.findByRole("button", { name: "Mi piace" });
    await user.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByText("Piace a 1 persona")).toBeInTheDocument();
    await screen.findByRole("button", { name: "Mi piace", pressed: true });
    expect(button).toBeEnabled();

    await user.click(button);
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(server.requests.map((r) => r.method)).toEqual(["GET", "PUT", "DELETE"]);
  });

  it("goes back when the server refuses", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { user } = setup({
      "GET /api/videos/7/like": { body: { liked: false, count: 2 } },
      "PUT /api/videos/7/like": { status: 500, body: { error: "internal error" } },
    });
    await user.click(await screen.findByRole("button", { name: "Mi piace" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Non sono riuscito a salvare");
    expect(screen.getByRole("button", { name: "Mi piace" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByText("Piace a 2 persone")).toBeInTheDocument();
  });

  it("does not appear when the like does not load", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    setup({ "GET /api/videos/7/like": { status: 500, body: { error: "internal error" } } });
    await vi.waitFor(() => expect(error).toHaveBeenCalled());
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
