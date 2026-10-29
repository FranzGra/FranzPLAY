import { screen, waitFor, within } from "@testing-library/react";
import { videoJSON } from "../../test/fixtures";
import { renderApp, signedIn } from "../../test/render";
import { tileColor } from "./color";

describe("categories", () => {
  it("lists the categories with their videos", async () => {
    renderApp("/categorie", {
      ...signedIn(),
      "GET /api/categories": {
        body: [
          { name: "Gite & mare", videos: 3, color: "", image: null },
          { name: "Scuola", videos: 1, color: "", image: null },
        ],
      },
    });
    const link = await screen.findByRole("link", { name: /Gite & mare/ });
    expect(link).toHaveAttribute("href", "/categorie/Gite%20%26%20mare");
    expect(within(link).getByText("3 video")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Scuola/ })).toBeInTheDocument();
  });

  it("shows the color and image the administrator chose", async () => {
    renderApp("/categorie", {
      ...signedIn(),
      "GET /api/categories": {
        body: [
          {
            name: "Vacanze",
            videos: 3,
            color: "#e11d48",
            image: "/api/category-images/1-0123456789abcdef.jpg",
          },
        ],
      },
    });
    const link = await screen.findByRole("link", { name: /Vacanze/ });
    expect(link.style.getPropertyValue("--tile-color")).toBe("#e11d48");
    expect(link.querySelector("img")).toHaveAttribute(
      "src",
      "/api/category-images/1-0123456789abcdef.jpg",
    );
  });

  it("draws a colored folder card for a category without an image", async () => {
    renderApp("/categorie", {
      ...signedIn(),
      "GET /api/categories": {
        body: [
          {
            name: "Scuola",
            videos: 2,
            color: "",
            image: null,
            cover: "/api/covers/1.jpg",
          },
        ],
      },
    });
    const link = await screen.findByRole("link", { name: /Scuola/ });
    // Not the cover of a video: the card of the old FranzPLAY, in a color
    // that is always the same for the same name.
    expect(link.querySelector("img")).toBeNull();
    expect(link.querySelector("svg")).not.toBeNull();
    expect(link.style.getPropertyValue("--tile-color")).toBe(
      tileColor({ name: "Scuola", color: "" }),
    );
  });

  it("stands the poster found in the folder in the corner of the card", async () => {
    renderApp("/categorie", {
      ...signedIn(),
      "GET /api/categories": {
        body: [
          {
            name: "Viaggi",
            videos: 4,
            color: "",
            image: null,
            poster: "/api/category-pictures/1-7fq2.jpg",
          },
        ],
      },
    });
    const link = await screen.findByRole("link", { name: /Viaggi/ });
    expect(link).toHaveAttribute("data-poster");
    expect(link).not.toHaveAttribute("data-image");
    expect(link.querySelector("img")).toHaveAttribute("src", "/api/category-pictures/1-7fq2.jpg");
    // No folder drawn: the poster takes its place.
    expect(link.querySelector("svg")).toBeNull();
  });

  it("prefers the wide picture to the poster on the card", async () => {
    renderApp("/categorie", {
      ...signedIn(),
      "GET /api/categories": {
        body: [
          {
            name: "Viaggi",
            videos: 4,
            color: "",
            image: "/api/category-pictures/2-3k9x.jpg",
            poster: "/api/category-pictures/1-7fq2.jpg",
          },
        ],
      },
    });
    const link = await screen.findByRole("link", { name: /Viaggi/ });
    expect(link).toHaveAttribute("data-image");
    expect(link.querySelectorAll("img")).toHaveLength(1);
    expect(link.querySelector("img")).toHaveAttribute("src", "/api/category-pictures/2-3k9x.jpg");
  });

  it("explains where categories come from when there are none", async () => {
    renderApp("/categorie");
    expect(
      await screen.findByRole("heading", { name: "Ancora nessuna categoria" }),
    ).toBeInTheDocument();
  });

  it("goes back to the categories with a pill button", async () => {
    renderApp("/categorie/Scuola", {
      ...signedIn(),
      "GET /api/videos": { body: { videos: [], total: 0 } },
    });
    await screen.findByRole("heading", { level: 1, name: "Scuola" });
    // The menu has a Categorie link too: the way back is the pill one.
    const back = screen
      .getAllByRole("link", { name: "Categorie" })
      .find((l) => l.classList.contains("glass"));
    expect(back).toHaveAttribute("href", "/categorie");
    expect(back?.querySelector("svg")).not.toBeNull();
  });

  it("shows the videos of one category", async () => {
    const { server } = renderApp("/categorie/Gite%20%26%20mare", {
      ...signedIn(),
      "GET /api/videos": { body: { videos: [videoJSON({ category: "Gite & mare" })], total: 1 } },
    });
    expect(
      await screen.findByRole("heading", { level: 1, name: "Gite & mare" }),
    ).toBeInTheDocument();
    expect(await screen.findByRole("list", { name: "Video di Gite & mare" })).toBeInTheDocument();
    const url = new URL(server.requests.find((r) => r.url.includes("/api/videos"))?.url ?? "");
    expect(url.searchParams.get("category")).toBe("Gite & mare");
  });

  it("opens a category with pictures with a band: picture behind, poster beside the name", async () => {
    renderApp("/categorie/Viaggi", {
      ...signedIn(),
      "GET /api/videos": { body: { videos: [], total: 0 } },
      "GET /api/categories": {
        body: [
          {
            name: "Viaggi",
            videos: 4,
            color: "",
            image: "/api/category-pictures/2-3k9x.jpg",
            poster: "/api/category-pictures/1-7fq2.jpg",
          },
        ],
      },
    });
    // The plain title first, then the band when the pictures arrive.
    const band = await waitFor(() => {
      const found = screen.getByRole("heading", { level: 1, name: "Viaggi" }).closest("header");
      expect(found).not.toBeNull();
      return found;
    });
    const sources = [...(band?.querySelectorAll("img") ?? [])].map((i) => i.getAttribute("src"));
    expect(sources).toEqual([
      "/api/category-pictures/2-3k9x.jpg",
      "/api/category-pictures/1-7fq2.jpg",
    ]);
    expect(band).not.toHaveAttribute("data-blur");
    expect(screen.getByText("4 video")).toBeInTheDocument();
  });

  it("blurs the poster behind the band when there is no wide picture", async () => {
    renderApp("/categorie/Viaggi", {
      ...signedIn(),
      "GET /api/videos": { body: { videos: [], total: 0 } },
      "GET /api/categories": {
        body: [
          {
            name: "Viaggi",
            videos: 4,
            color: "",
            image: null,
            poster: "/api/category-pictures/1-7fq2.jpg",
          },
        ],
      },
    });
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { level: 1, name: "Viaggi" }).closest("header"),
      ).toHaveAttribute("data-blur"),
    );
  });
});
