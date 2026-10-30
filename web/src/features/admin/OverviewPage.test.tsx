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
    const problems = await screen.findByRole("region", { name: /Da sistemare/ });
    const titles = within(problems).getAllByRole("heading", { level: 3 });
    expect(titles.map((t) => t.textContent)).toEqual([
      "Non si legge /mnt/usb",
      "2 lavori non sono riusciti",
      "3 video non si trovano più",
    ]);
    expect(within(problems).getByRole("link", { name: "Vedi quali" })).toHaveAttribute(
      "href",
      "/admin/video?show=missing",
    );
    expect(within(problems).getByRole("button", { name: "Riprova tutti" })).toBeInTheDocument();

    const numbers = screen.getByRole("region", { name: "In numeri" });
    expect(numbers).toHaveTextContent("75% pronti per tutti i browser");
    expect(numbers).toHaveTextContent("1 amministratore");
    expect(within(numbers).getByRole("link", { name: /Persone/ })).toHaveAttribute(
      "href",
      "/admin/persone",
    );

    const disks = screen.getByRole("region", { name: "Spazio sui dischi" });
    expect(disks).toHaveTextContent("60 GB liberi su 100 GB");
    expect(
      within(disks).getByRole("meter", { name: "Cartella dati di FranzPLAY: 40% usato" }),
    ).toBeInTheDocument();
    expect(disks).toHaveTextContent("Non si legge");
    expect(screen.getByRole("region", { name: "Il sito" })).toHaveTextContent("1.2.3");
  });

  it("says when all is well", async () => {
    renderApp("/admin/riepilogo", {
      ...signedIn(),
      "GET /api/overview": { body: { ...overview, problems: [] } },
    });
    expect(await screen.findByText(/Tutto a posto/)).toBeInTheDocument();
  });
});
