import { screen } from "@testing-library/react";
import { mockFetchJSON, renderApp } from "../../test/render";

describe("profile page", () => {
  it("has the upload button, disabled until uploading exists", () => {
    mockFetchJSON({ status: "ok", version: "test" });
    renderApp("/profilo");
    expect(screen.getByRole("button", { name: /Carica un video/ })).toBeDisabled();
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
