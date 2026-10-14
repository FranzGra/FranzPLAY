import { screen, within } from "@testing-library/react";
import { renderApp, signedIn } from "../../test/render";

const gb = 1024 ** 3;

const overview = {
  version: "1.2.3",
  videos: { present: 40, hidden: 2, missing: 3, analysed: 40, playable: 30, noCover: 0 },
  categories: 5,
  people: 4,
  admins: 1,
  comments: 12,
  jobs: { waiting: 0, failed: 2 },
  disks: [
    { folder: "/dati", data: true, total: 100 * gb, free: 60 * gb, error: false },
    { folder: "/mnt/usb", data: false, total: 0, free: 0, error: true },
  ],
  problems: [
    { kind: "disk_unread", severity: "critical", folder: "/mnt/usb" },
    { kind: "failed_jobs", severity: "warning", count: 2 },
    { kind: "missing_videos", severity: "warning", count: 3 },
  ],
};

describe("administration summary", () => {
  it("opens first in the administration", async () => {
    renderApp("/admin", { ...signedIn(), "GET /api/overview": { body: overview } });
    const sections = await screen.findByRole("navigation", {
      name: "Sezioni dell'amministrazione",
    });
    expect(await screen.findByRole("heading", { name: "Da sistemare" })).toBeInTheDocument();
    expect(within(sections).getByRole("link", { name: "Riepilogo" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("says what needs attention, the numbers and the disks", async () => {
    renderApp("/admin/riepilogo", { ...signedIn(), "GET /api/overview": { body: overview } });
    const problems = await screen.findByRole("list", { name: "Da sistemare" });
    const rows = within(problems).getAllByRole("listitem");
    expect(rows[0]).toHaveTextContent("Non si riesce a leggere /mnt/usb");
    expect(rows[1]).toHaveTextContent("2 lavori non sono riusciti.");
    expect(rows[2]).toHaveTextContent("3 video non si trovano più nelle cartelle.");
    expect(
      within(rows[1] as HTMLElement).getByRole("link", { name: "Vedi i lavori" }),
    ).toHaveAttribute("href", "/admin/lavori");

    expect(
      screen.getByText("75% pronti per tutti i dispositivi", { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getByText("1 amministratore", { exact: false })).toBeInTheDocument();

    const disks = screen.getByRole("list", { name: "Dischi" });
    expect(disks).toHaveTextContent("liberi 60 GB su 100 GB");
    expect(
      screen.getByRole("meter", { name: "Cartella dati di FranzPLAY: 40% usato" }),
    ).toBeInTheDocument();
    expect(disks).toHaveTextContent("non si riesce a leggere");
    expect(screen.getByText("FranzPLAY versione 1.2.3")).toBeInTheDocument();
  });

  it("says when all is well", async () => {
    renderApp("/admin/riepilogo", {
      ...signedIn(),
      "GET /api/overview": { body: { ...overview, problems: [] } },
    });
    expect(await screen.findByText(/Tutto a posto/)).toBeInTheDocument();
  });
});
