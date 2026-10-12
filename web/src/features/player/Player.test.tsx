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

// refuse makes the browser refuse to start the video by itself: always,
// or only with sound.
function refuse(play: ReturnType<typeof fakeMedia>["play"], always: boolean) {
  const allowed = play.getMockImplementation();
  play.mockImplementation(function (this: HTMLMediaElement) {
    if (always || !this.muted) {
      return Promise.reject(new DOMException("needs a click first", "NotAllowedError"));
    }
    return allowed?.call(this) ?? Promise.resolve();
  });
}

describe("player starting by itself", () => {
  it("starts when ready, only once", () => {
    const { video, play, pause } = setup({ autoPlay: true });
    expect(play).not.toHaveBeenCalled();
    fireEvent.loadedMetadata(video);
    expect(play).toHaveBeenCalledTimes(1);
    expect(video.muted).toBe(false);
    pause.getMockImplementation()?.call(video);
    fireEvent.loadedMetadata(video);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("does not start without autoPlay", () => {
    const { video, play } = setup();
    fireEvent.loadedMetadata(video);
    expect(play).not.toHaveBeenCalled();
  });

  it("starts without sound when the browser wants so, and offers the sound", async () => {
    const { user, video, play } = setup({ autoPlay: true });
    refuse(play, false);
    fireEvent.loadedMetadata(video);
    const unmute = await screen.findByRole("button", { name: "Attiva l'audio" });
    expect(play).toHaveBeenCalledTimes(2);
    expect(video.muted).toBe(true);
    expect(screen.getByRole("button", { name: "Riattiva l'audio (m)" })).toBeInTheDocument();

    await user.click(unmute);
    expect(video.muted).toBe(false);
    expect(screen.queryByRole("button", { name: "Attiva l'audio" })).not.toBeInTheDocument();
    // The silence was the browser's choice, not the person's: not remembered.
    expect(window.localStorage.getItem("franzplay.muted")).toBe("false");
  });

  it("keeps the play button when the browser refuses even without sound", async () => {
    const { video, play } = setup({ autoPlay: true });
    refuse(play, true);
    fireEvent.loadedMetadata(video);
    await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(video.muted).toBe(false));
    expect(screen.getByRole("button", { name: "Guarda" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Attiva l'audio" })).not.toBeInTheDocument();
  });
});

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

describe("sound tracks", () => {
  const audio = [
    { stream: 1, lang: "it", label: "Italiano", default: true },
    { stream: 2, lang: "en", label: "Inglese", default: false },
  ];
  const findAudio = vi.fn(async (stream: number, at: number) => ({
    start: Math.floor(at / 5) * 5, // a keyframe every 5 seconds
    src: `/api/videos/7/audio/${stream}/stream?at=${at}`,
  }));
  afterEach(() => findAudio.mockClear());

  async function chooseInSettings(user: ReturnType<typeof userEvent.setup>, label: string) {
    await user.click(screen.getByRole("button", { name: "Impostazioni" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^Audio/ }));
    await user.click(screen.getByRole("button", { name: label }));
  }

  it("offers no choice with only one sound track", async () => {
    const { user } = setup({ audio: audio.slice(0, 1), findAudio });
    await user.click(screen.getByRole("button", { name: "Impostazioni" }));
    expect(screen.queryByRole("button", { name: /^Audio/ })).not.toBeInTheDocument();
  });

  it("plays another language from where the video was, and remembers it", async () => {
    const { user, video } = setup({ audio, findAudio, length: 245 });
    video.currentTime = 12;
    fireEvent.timeUpdate(video);
    await chooseInSettings(user, "Inglese");

    expect(findAudio).toHaveBeenCalledWith(2, 12);
    expect(video.getAttribute("src")).toBe("/api/videos/7/audio/2/stream?at=12");
    expect(window.localStorage.getItem("franzplay.audio")).toBe('"en"');

    // The new video starts at 10 seconds: the player goes 2 seconds in and
    // counts the time of the whole video.
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(2);
    video.currentTime = 5;
    fireEvent.timeUpdate(video);
    expect(screen.getByText("0:15")).toBeInTheDocument();
    expect(screen.getByText(/4:05/)).toBeInTheDocument(); // the server's duration

    await user.click(screen.getByRole("button", { name: "Impostazioni" }));
    expect(
      within(screen.getByRole("dialog")).getByRole("button", { name: /^Audio/ }),
    ).toHaveTextContent("Inglese");
  });

  it("keeps playing in the new language", async () => {
    const { user, video, play } = setup({ audio, findAudio });
    await user.click(screen.getByRole("button", { name: "Guarda" }));
    play.mockClear();
    await chooseInSettings(user, "Inglese");
    expect(video.getAttribute("src")).toContain("/audio/2/");
    expect(play).toHaveBeenCalledTimes(1);
  });

  it("goes back to the original language", async () => {
    const { user, video } = setup({ audio, findAudio });
    await chooseInSettings(user, "Inglese");
    expect(video.getAttribute("src")).toContain("/audio/2/");
    await chooseInSettings(user, "Italiano");
    expect(video.getAttribute("src")).toBe("/api/videos/7/stream");
    expect(findAudio).toHaveBeenCalledTimes(1);
  });

  it("asks the server again for a time not downloaded yet", async () => {
    const { user, video } = setup({ audio, findAudio, length: 245 });
    await chooseInSettings(user, "Inglese");
    fireEvent.loadedMetadata(video);
    await user.click(screen.getByRole("button", { name: "Avanti di 10 secondi (l)" }));
    expect(findAudio).toHaveBeenLastCalledWith(2, 10);
    expect(video.getAttribute("src")).toBe("/api/videos/7/audio/2/stream?at=10");
  });

  it("opens in the language chosen last time", async () => {
    window.localStorage.setItem("franzplay.audio", '"en"');
    const { video } = setup({ audio, findAudio, startAt: 33 });
    expect(findAudio).toHaveBeenCalledWith(2, 33);
    await vi.waitFor(() =>
      expect(video.getAttribute("src")).toBe("/api/videos/7/audio/2/stream?at=33"),
    );
    expect(video.getAttribute("preload")).toBe("none");
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(3);
  });

  it("says so when the language cannot be changed", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    const refuse = vi.fn(async () => {
      throw new Error("busy");
    });
    const { user, video } = setup({ audio, findAudio: refuse });
    await chooseInSettings(user, "Inglese");
    expect(await screen.findByRole("status")).toHaveTextContent(/non si riesce a cambiare lingua/);
    expect(video.getAttribute("src")).toBe("/api/videos/7/stream");
    quiet.mockRestore();
  });

  it("goes back to the original language when the server cannot make the other", async () => {
    const { user, video } = setup({ audio, findAudio });
    await chooseInSettings(user, "Inglese");
    fireEvent.error(video);
    expect(await screen.findByRole("status")).toHaveTextContent(/non si riesce a caricare/);
    expect(video.getAttribute("src")).toBe("/api/videos/7/stream");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
