import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Player } from "./Player";

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
  return { user, video, ...media };
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
