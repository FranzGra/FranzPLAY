import { screen, within } from "@testing-library/react";
import { renderApp, signedIn } from "../../test/render";

const gb = 1024 ** 3;

const overview = {
  version: "1.2.3",
  videos: {
    present: 40,
    eligible: 40,
    short: 0,
    problems: 0,
    hidden: 2,
    missing: 3,
    analysed: 40,
    playable: 30,
    noCover: 0,
  },
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
  damaged: [],
  inContainer: false,
};

const brokenFile = {
  id: 7,
  title: "Gita",
  path: "/videos/Mare/gita.mp4",
  size: 2048,
  kind: "damaged",
  detail: "exit status 1: moov atom not found",
};

describe("administration summary", () => {
  it("says in one line when no file has problems", async () => {
    renderApp("/admin/riepilogo", { ...signedIn(), "GET /api/overview": { body: overview } });
    const card = await screen.findByRole("region", { name: /File con problemi/ });
    expect(card).toHaveTextContent("Nessun file rovinato");
    expect(within(card).queryByRole("list")).not.toBeInTheDocument();
  });

  it("says where the damaged files are and what they have, and deletes nothing", async () => {
    renderApp("/admin/riepilogo", {
      ...signedIn(),
      "GET /api/overview": {
        body: {
          ...overview,
          videos: { ...overview.videos, eligible: 37, short: 2, problems: 1 },
          damaged: [brokenFile],
          inContainer: true,
        },
      },
    });
    const card = await screen.findByRole("region", { name: /File con problemi/ });
    const list = within(card).getByRole("list", { name: "File con problemi" });
    expect(list).toHaveTextContent("/videos/Mare/gita.mp4");
    expect(list).toHaveTextContent("Il file è rovinato o incompleto");
    expect(list).toHaveTextContent("moov atom not found");
    expect(list).toHaveTextContent("2 KB");
    expect(within(list).getByRole("link", { name: "Apri la scheda di Gita" })).toHaveAttribute(
      "href",
      "/admin/video/7",
    );
    expect(card).toHaveTextContent("FranzPLAY non cancella questi file");
    expect(card).toHaveTextContent("I percorsi sono quelli visti dentro il container");
    expect(within(card).queryByRole("button")).not.toBeInTheDocument();
    const numbers = screen.getByRole("region", { name: "In numeri" });
    expect(numbers).toHaveTextContent("37 idonei · 2 scartati · 1 con problemi");
  });

  it("says when the list holds only the first files", async () => {
    renderApp("/admin/riepilogo", {
      ...signedIn(),
      "GET /api/overview": {
        body: {
          ...overview,
          videos: { ...overview.videos, problems: 250 },
          damaged: [brokenFile],
        },
      },
    });
    const card = await screen.findByRole("region", { name: /File con problemi/ });
    expect(card).toHaveTextContent("Sono i primi 1 di 250");
    expect(card).not.toHaveTextContent("visti dentro il container");
  });

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
