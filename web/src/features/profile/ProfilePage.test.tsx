import { screen, within } from "@testing-library/react";
import { mockFetchJSON, renderApp } from "../../test/render";

describe("profile page", () => {
  it("has the upload button, disabled until uploading exists", () => {
    mockFetchJSON({ status: "ok", version: "test" });
    renderApp("/profilo");
    expect(screen.getByRole("button", { name: /Carica un video/ })).toBeDisabled();
  });

  it("links only to pages the menus do not already show", () => {
    mockFetchJSON({ status: "ok", version: "test" });
    renderApp("/profilo");
    const pages = screen.getByRole("navigation", { name: "Le tue pagine" });
    expect(within(pages).getByRole("link", { name: /Cronologia/ })).toBeInTheDocument();
    expect(within(pages).queryByRole("link", { name: /Categorie/ })).not.toBeInTheDocument();
    expect(within(pages).queryByRole("link", { name: /playlist/i })).not.toBeInTheDocument();
  });

  it("shows the server version", async () => {
    const fetchMock = mockFetchJSON({ status: "ok", version: "1.2.3" });
    renderApp("/profilo");
    expect(await screen.findByText("FranzPLAY versione 1.2.3")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/health", expect.anything());
  });

  it("says so when the server does not answer properly", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockFetchJSON({ status: "down" }, 500);
    renderApp("/profilo");
    expect(await screen.findByText("Il server non risponde.")).toBeInTheDocument();
  });
});
