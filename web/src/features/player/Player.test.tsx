import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SubtitleTrack } from "../../api/videos";
import { Player, pickTrack } from "./Player";

// jsdom has no real video: these stand-ins make play() and pause() behave.
function fakeMedia() {
  const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    Object.defineProperty(this, "paused", { value: false, configurable: true });
    this.dispatchEvent(new Event("play"));
    return Promise.resolve();
  });
  const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    Object.defineProperty(this, "paused", { value: true, configurable: true });
    this.dispatchEvent(new Event("pause"));
  });
  return { play, pause };
}

function setup(props: Partial<Parameters<typeof Player>[0]> = {}) {
  const media = fakeMedia();
  const user = userEvent.setup();
  const result = render(<Player src="/api/videos/7/stream" poster={null} {...props} />);
  const video = result.container.querySelector("video") as HTMLVideoElement;
  Object.defineProperty(video, "duration", { value: 245, configurable: true });
  fireEvent.durationChange(video);
  return { user, video, unmount: result.unmount, ...media };
}

afterEach(() => window.localStorage.clear());

describe("player", () => {
  it("plays the stream and pauses", async () => {
    const { user, video, play, pause } = setup();
    expect(video).toHaveAttribute("src", "/api/videos/7/stream");

    await user.click(screen.getByRole("button", { name: "Guarda" }));
    expect(play).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Guarda" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Pausa (k)" }));
    expect(pause).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Riproduci (k)" })).toBeInTheDocument();
  });

  it("jumps 10 seconds with the buttons, within the video", async () => {
    const { user, video } = setup();
    video.currentTime = 100;
    await user.click(screen.getByRole("button", { name: "Avanti di 10 secondi (l)" }));
    expect(video.currentTime).toBe(110);
    await user.click(screen.getByRole("button", { name: "Indietro di 10 secondi (j)" }));
    await user.click(screen.getByRole("button", { name: "Indietro di 10 secondi (j)" }));
    expect(video.currentTime).toBe(90);

    video.currentTime = 240;
    await user.click(screen.getByRole("button", { name: "Avanti di 10 secondi (l)" }));
    expect(video.currentTime).toBe(245);
  });

  it("answers the keys, as on YouTube", async () => {
    const { user, video, play } = setup();
    video.currentTime = 50;
    await user.keyboard("{ArrowRight}");
    expect(video.currentTime).toBe(60);
    await user.keyboard("j");
    expect(video.currentTime).toBe(50);
    await user.keyboard("5");
    expect(video.currentTime).toBe(122.5);
    await user.keyboard("k");
    expect(play).toHaveBeenCalled();
    await user.keyboard("m");
    expect(video.muted).toBe(true);
  });

  it("leaves the keys alone while typing", async () => {
    const media = fakeMedia();
    const user = userEvent.setup();
    const { container } = render(
      <>
        <input aria-label="Cerca" />
        <Player src="/x" poster={null} />
      </>,
    );
    const video = container.querySelector("video") as HTMLVideoElement;
    await user.type(screen.getByLabelText("Cerca"), "k l");
    expect(media.play).not.toHaveBeenCalled();
    expect(video.currentTime).toBe(0);
  });

  it("changes speed from the settings", async () => {
    const { user, video } = setup();
    await user.click(screen.getByRole("button", { name: "Impostazioni" }));
    await user.click(screen.getByRole("button", { name: /Velocità/ }));
    await user.click(screen.getByRole("button", { name: "1,5×" }));
    expect(video.playbackRate).toBe(1.5);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Impostazioni" }));
    expect(screen.getByRole("button", { name: /Velocità/ })).toHaveTextContent("1,5×");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("closes the settings with a click on the picture, without pausing", async () => {
    const { user, play } = setup();
    await user.click(screen.getByRole("button", { name: "Impostazioni" }));
    const surface = document.querySelector("[class*=surface]") as HTMLElement;
    await user.click(surface);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(play).not.toHaveBeenCalled();
    await user.click(surface);
    expect(play).toHaveBeenCalled();
  });

  it("remembers the volume for the next video", async () => {
    const first = setup();
    fireEvent.change(screen.getByRole("slider", { name: "Volume" }), { target: { value: "0.35" } });
    expect(first.video.volume).toBe(0.35);

    const { container } = render(<Player src="/y" poster={null} />);
    expect(container.querySelector("video")?.volume).toBe(0.35);
  });

  it("shows where the video is on the timeline", () => {
    const { video } = setup();
    video.currentTime = 62;
    fireEvent.timeUpdate(video);
    const timeline = screen.getByRole("slider", { name: "Posizione nel video" });
    expect(timeline).toHaveAttribute("aria-valuetext", "1:02 di 4:05");
    expect(screen.getByText("1:02")).toBeInTheDocument();
  });

  it("explains a video the browser cannot play", () => {
    const { video } = setup({ unsupportedHint: "Formato non adatto." });
    fireEvent.error(video);
    expect(screen.getByRole("alert")).toHaveTextContent("Formato non adatto.");
  });
});

const italian: SubtitleTrack = {
  key: "it.srt",
  lang: "it",
  label: "Italiano",
  src: "/api/videos/7/subtitles/it.srt",
};
const english: SubtitleTrack = {
  key: "en.vtt",
  lang: "en",
  label: "Inglese",
  src: "/api/videos/7/subtitles/en.vtt",
};

describe("subtitles", () => {
  it("has a subtitles button only usable when there are subtitles", () => {
    setup();
    expect(
      screen.getByRole("button", { name: "Nessun sottotitolo per questo video" }),
    ).toBeDisabled();
  });

  it("turns subtitles on and off, and remembers it", async () => {
    const { user } = setup({ subtitles: [english, italian] });
    expect(document.querySelectorAll("track")).toHaveLength(2);
    const cc = screen.getByRole("button", { name: "Sottotitoli (c)" });
    expect(cc).toHaveAttribute("aria-pressed", "false");

    await user.click(cc);
    expect(cc).toHaveAttribute("aria-pressed", "true");
    expect(JSON.parse(window.localStorage.getItem("franzplay.subtitles") ?? "")).toEqual({
      on: true,
      lang: "en",
    });

    await user.keyboard("c");
    expect(cc).toHaveAttribute("aria-pressed", "false");
  });

  it("chooses the language in the settings", async () => {
    const { user } = setup({ subtitles: [english, italian] });
    await user.click(screen.getByRole("button", { name: "Impostazioni" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: /^Sottotitoli/ }),
    );
    await user.click(screen.getByRole("button", { name: "Italiano" }));
    expect(JSON.parse(window.localStorage.getItem("franzplay.subtitles") ?? "")).toEqual({
      on: true,
      lang: "it",
    });
    await user.click(screen.getByRole("button", { name: "Impostazioni" }));
    expect(
      within(screen.getByRole("dialog")).getByRole("button", { name: /^Sottotitoli/ }),
    ).toHaveTextContent("Italiano");
  });

  it("explains how to add subtitles to a video without", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Impostazioni" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: /^Sottotitoli/ }),
    );
    expect(screen.getByText(/mare\.it\.srt/)).toBeInTheDocument();
  });

  it("changes and remembers the subtitle style", async () => {
    const { user } = setup();
    await user.click(screen.getByRole("button", { name: "Impostazioni" }));
    await user.click(screen.getByRole("button", { name: /Stile dei sottotitoli/ }));
    await user.click(screen.getByRole("button", { name: /Colore/ }));
    await user.click(screen.getByRole("button", { name: "Giallo" }));
    await user.click(screen.getByRole("button", { name: /Dimensione/ }));
    await user.click(screen.getByRole("button", { name: "Molto grande" }));
    expect(screen.getByRole("button", { name: /Colore/ })).toHaveTextContent("Giallo");
    expect(screen.getByText("Così appariranno i sottotitoli")).toHaveStyle({ color: "#ffe14d" });
    expect(JSON.parse(window.localStorage.getItem("franzplay.subtitleStyle") ?? "")).toMatchObject({
      color: "yellow",
      size: "huge",
    });
  });
});

describe("pickTrack", () => {
  it.each([
    [{ on: false, lang: "it" }, null],
    [{ on: true, lang: "it" }, "it.srt"],
    [{ on: true, lang: "de" }, "en.vtt"], // the language is not there: the first one
    [{ on: true, lang: "it-IT" }, "it.srt"], // the browser's language, by its first part
  ])("%j", (choice, want) => {
    expect(pickTrack([english, italian], choice)).toBe(want);
  });

  it("shows nothing without subtitles", () => {
    expect(pickTrack([], { on: true, lang: "it" })).toBeNull();
  });
});

describe("where the video was left", () => {
  it("starts from the position given", () => {
    const { video } = setup({ startAt: 100 });
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(100);
  });

  it("starts from the beginning when the position is past the end", () => {
    const { video } = setup({ startAt: 300 });
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(0);
  });

  it("tells the position on pause, while playing and when closing", async () => {
    const onPosition = vi.fn();
    const { user, video } = setup({ onPosition });

    await user.click(screen.getByRole("button", { name: "Guarda" }));
    video.currentTime = 4;
    fireEvent.timeUpdate(video);
    expect(onPosition).not.toHaveBeenCalled(); // not yet 10 seconds

    video.currentTime = 12;
    fireEvent.timeUpdate(video);
    expect(onPosition).toHaveBeenLastCalledWith(12);

    video.currentTime = 15;
    fireEvent.timeUpdate(video);
    await user.click(screen.getByRole("button", { name: "Pausa (k)" }));
    expect(onPosition).toHaveBeenLastCalledWith(15);
    expect(onPosition).toHaveBeenCalledTimes(2);

    video.currentTime = 50;
    fireEvent.seeked(video);
    expect(onPosition).toHaveBeenLastCalledWith(50);

    video.currentTime = 60;
    fireEvent.timeUpdate(video);
    window.dispatchEvent(new Event("pagehide"));
    expect(onPosition).toHaveBeenLastCalledWith(60);
    expect(onPosition).toHaveBeenCalledTimes(4);
  });

  it("tells nothing when the video was only opened", () => {
    const onPosition = vi.fn();
    const { video, unmount } = setup({ onPosition, startAt: 100 });
    fireEvent.loadedMetadata(video);
    unmount();
    expect(onPosition).not.toHaveBeenCalled();
  });

  it("tells the position when the player closes", async () => {
    const onPosition = vi.fn();
    const { user, video, unmount } = setup({ onPosition });
    await user.click(screen.getByRole("button", { name: "Guarda" }));
    video.currentTime = 7;
    fireEvent.timeUpdate(video);
    unmount();
    expect(onPosition).toHaveBeenCalledWith(7);
  });
});
