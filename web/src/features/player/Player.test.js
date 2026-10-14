import { Fragment as _Fragment, jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { doubleClickWithin, doubleTapWithin, failureText, hideAfter, Player, pickTrack, } from "./Player";
// jsdom has no real video: these stand-ins make play() and pause() behave.
function fakeMedia() {
    const play = vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(function () {
        Object.defineProperty(this, "paused", { value: false, configurable: true });
        this.dispatchEvent(new Event("play"));
        return Promise.resolve();
    });
    const pause = vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function () {
        Object.defineProperty(this, "paused", { value: true, configurable: true });
        this.dispatchEvent(new Event("pause"));
    });
    return { play, pause };
}
function setup(props = {}) {
    const media = fakeMedia();
    const user = userEvent.setup();
    const result = render(_jsx(Player, { src: "/api/videos/7/stream", poster: null, ...props }));
    const video = result.container.querySelector("video");
    Object.defineProperty(video, "duration", { value: 245, configurable: true });
    fireEvent.durationChange(video);
    return { user, video, unmount: result.unmount, ...media };
}
afterEach(() => window.localStorage.clear());
// refuse makes the browser refuse to start the video by itself: always,
// or only with sound.
function refuse(play, always) {
    const allowed = play.getMockImplementation();
    play.mockImplementation(function () {
        if (always || !this.muted) {
            return Promise.reject(new DOMException("needs a click first", "NotAllowedError"));
        }
        return allowed?.call(this) ?? Promise.resolve();
    });
}
describe("player starting by itself", () => {
    it("starts right away, only once, looking like it plays", () => {
        const { video, play } = setup({ autoPlay: true });
        expect(play).toHaveBeenCalledTimes(1);
        expect(video.muted).toBe(false);
        fireEvent.loadedMetadata(video);
        expect(play).toHaveBeenCalledTimes(1);
        expect(screen.queryByRole("button", { name: "Guarda" })).not.toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Pausa (k)" })).toBeInTheDocument();
    });
    it("shows the pause icon and loading while the video is on its way", async () => {
        const { play, pause } = fakeMedia();
        play.mockImplementation(() => new Promise(() => { })); // never ready
        const user = userEvent.setup();
        render(_jsx(Player, { src: "/api/videos/7/stream", poster: null, autoPlay: true }));
        expect(screen.getByRole("status", { name: "Caricamento" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "Guarda" })).not.toBeInTheDocument();
        // Pause while it is on its way: it stays still, with the play button.
        await user.click(screen.getByRole("button", { name: "Pausa (k)" }));
        expect(pause).toHaveBeenCalled();
        expect(screen.getByRole("button", { name: "Riproduci (k)" })).toBeInTheDocument();
        expect(screen.queryByRole("status", { name: "Caricamento" })).not.toBeInTheDocument();
    });
    it("has a theater button only when the page offers theater mode", async () => {
        const { unmount } = setup();
        expect(screen.queryByRole("button", { name: /Teatro/ })).not.toBeInTheDocument();
        fireEvent.keyDown(document.body, { key: "t" }); // nothing to do, nothing breaks
        unmount();
        const onTheater = vi.fn();
        const { user } = setup({ onTheater });
        await user.click(screen.getByRole("button", { name: "Modalità Teatro (t)" }));
        fireEvent.keyDown(document.body, { key: "t" });
        expect(onTheater).toHaveBeenCalledTimes(2);
    });
    it("does not start without autoPlay", () => {
        const { video, play } = setup();
        fireEvent.loadedMetadata(video);
        expect(play).not.toHaveBeenCalled();
        expect(screen.getByRole("button", { name: "Guarda" })).toBeInTheDocument();
    });
    it("starts without sound when the browser wants so, and offers the sound", async () => {
        const { play } = fakeMedia();
        refuse(play, false);
        const user = userEvent.setup();
        const { container } = render(_jsx(Player, { src: "/api/videos/7/stream", poster: null, autoPlay: true }));
        const video = container.querySelector("video");
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
    it("brings back the play button when the browser refuses even without sound", async () => {
        const { play } = fakeMedia();
        refuse(play, true);
        const { container } = render(_jsx(Player, { src: "/api/videos/7/stream", poster: null, autoPlay: true }));
        const video = container.querySelector("video");
        await vi.waitFor(() => expect(play).toHaveBeenCalledTimes(2));
        await vi.waitFor(() => expect(video.muted).toBe(false));
        expect(await screen.findByRole("button", { name: "Guarda" })).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Riproduci (k)" })).toBeInTheDocument();
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
    it("jumps 15 seconds with the buttons, within the video", async () => {
        const { user, video } = setup();
        video.currentTime = 100;
        await user.click(screen.getByRole("button", { name: "Avanti di 15 secondi (l)" }));
        expect(video.currentTime).toBe(115);
        await user.click(screen.getByRole("button", { name: "Indietro di 15 secondi (j)" }));
        await user.click(screen.getByRole("button", { name: "Indietro di 15 secondi (j)" }));
        expect(video.currentTime).toBe(85);
        video.currentTime = 240;
        await user.click(screen.getByRole("button", { name: "Avanti di 15 secondi (l)" }));
        expect(video.currentTime).toBe(245);
    });
    it("answers the keys, as on YouTube", async () => {
        const { user, video, play } = setup();
        video.currentTime = 50;
        await user.keyboard("{ArrowRight}");
        expect(video.currentTime).toBe(65);
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
        const { container } = render(_jsxs(_Fragment, { children: [_jsx("input", { "aria-label": "Cerca" }), _jsx(Player, { src: "/x", poster: null })] }));
        const video = container.querySelector("video");
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
    it("slides the settings pages in the way the person goes", async () => {
        const { user } = setup();
        await user.click(screen.getByRole("button", { name: "Impostazioni" }));
        const page = () => screen.getByRole("dialog").firstElementChild;
        // The first page opens with the panel: it does not slide.
        expect(page()).not.toHaveAttribute("data-direction");
        await user.click(screen.getByRole("button", { name: /Velocità/ }));
        expect(page()).toHaveAttribute("data-direction", "forward");
        await user.click(screen.getByRole("button", { name: "Velocità" }));
        expect(page()).toHaveAttribute("data-direction", "back");
    });
    it("closes the settings with a click on the picture, without pausing", async () => {
        const { user, play } = setup();
        await user.click(screen.getByRole("button", { name: "Impostazioni" }));
        const surface = document.querySelector("[class*=surface]");
        await user.click(surface);
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
        expect(play).not.toHaveBeenCalled();
        await user.click(surface);
        await waitFor(() => expect(play).toHaveBeenCalled());
    });
    it("remembers the volume for the next video", async () => {
        const first = setup();
        fireEvent.change(screen.getByRole("slider", { name: "Volume" }), { target: { value: "0.35" } });
        expect(first.video.volume).toBe(0.35);
        const { container } = render(_jsx(Player, { src: "/y", poster: null }));
        expect(container.querySelector("video")?.volume).toBe(0.35);
    });
    it("turns the volume with the mouse wheel, in steps of 5 %, without scrolling the page", () => {
        const { video } = setup();
        const slider = screen.getByRole("slider", { name: "Volume" });
        fireEvent.change(slider, { target: { value: "0.5" } });
        const wheel = (deltaY) => {
            const event = new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true });
            act(() => {
                slider.dispatchEvent(event);
            });
            return event;
        };
        expect(wheel(100).defaultPrevented).toBe(true);
        wheel(100);
        expect(video.volume).toBe(0.4);
        expect(slider).toHaveValue("0.4");
        for (let i = 0; i < 20; i++)
            wheel(-100);
        expect(video.volume).toBe(1);
        expect(slider).toHaveValue("1");
    });
    it("shows where the video is on the timeline", () => {
        const { video } = setup();
        video.currentTime = 62;
        fireEvent.timeUpdate(video);
        const timeline = screen.getByRole("slider", { name: "Posizione nel video" });
        expect(timeline).toHaveAttribute("aria-valuetext", "1:02 di 4:05");
        expect(screen.getByText("1:02")).toBeInTheDocument();
    });
    it("shows how much is left with a click on the time, and remembers it", async () => {
        const { user, video, unmount } = setup();
        video.currentTime = 62;
        fireEvent.timeUpdate(video);
        await user.click(screen.getByRole("button", { name: "Mostra quanto manca" }));
        expect(screen.getByText("-3:03")).toBeInTheDocument();
        expect(window.localStorage.getItem("franzplay.timeLeft")).toBe("true");
        unmount();
        setup();
        expect(screen.getByText("-4:05")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "Mostra il tempo passato" }));
        expect(screen.getByText("0:00")).toBeInTheDocument();
    });
    it("starts again at the end when Ripeti is on", async () => {
        const onPosition = vi.fn();
        const { user, video, play } = setup({ onPosition });
        await user.click(screen.getByRole("button", { name: "Guarda" }));
        await user.click(screen.getByRole("button", { name: "Impostazioni" }));
        const repeat = screen.getByRole("switch", { name: "Ripeti" });
        expect(repeat).toHaveAttribute("aria-checked", "false");
        await user.click(repeat);
        expect(repeat).toHaveAttribute("aria-checked", "true");
        play.mockClear();
        video.currentTime = 245;
        fireEvent.ended(video);
        expect(video.currentTime).toBe(0);
        expect(play).toHaveBeenCalledTimes(1);
        expect(onPosition).not.toHaveBeenCalledWith(245);
        await user.click(repeat);
        video.currentTime = 245;
        fireEvent.timeUpdate(video);
        fireEvent.ended(video);
        expect(video.currentTime).toBe(245);
        expect(onPosition).toHaveBeenLastCalledWith(245);
    });
    it("explains a video the browser cannot play", () => {
        const { video } = setup({ unsupportedHint: "Formato non adatto." });
        fireEvent.error(video);
        expect(screen.getByRole("alert")).toHaveTextContent("Formato non adatto.");
    });
    it("says when the browser cannot read the format", () => {
        const { video } = setup();
        Object.defineProperty(video, "error", { value: { code: 4 } });
        fireEvent.error(video);
        expect(screen.getByRole("alert")).toHaveTextContent("Questo browser non sa leggere il formato");
    });
});
const italian = {
    key: "it.srt",
    lang: "it",
    label: "Italiano",
    src: "/api/videos/7/subtitles/it.srt",
};
const english = {
    key: "en.vtt",
    lang: "en",
    label: "Inglese",
    src: "/api/videos/7/subtitles/en.vtt",
};
describe("subtitles", () => {
    it("has a subtitles button only usable when there are subtitles", () => {
        setup();
        expect(screen.getByRole("button", { name: "Nessun sottotitolo per questo video" })).toBeDisabled();
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
        await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^Sottotitoli/ }));
        await user.click(screen.getByRole("button", { name: "Italiano" }));
        expect(JSON.parse(window.localStorage.getItem("franzplay.subtitles") ?? "")).toEqual({
            on: true,
            lang: "it",
        });
        await user.click(screen.getByRole("button", { name: "Impostazioni" }));
        expect(within(screen.getByRole("dialog")).getByRole("button", { name: /^Sottotitoli/ })).toHaveTextContent("Italiano");
    });
    it("explains how to add subtitles to a video without", async () => {
        const { user } = setup();
        await user.click(screen.getByRole("button", { name: "Impostazioni" }));
        await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^Sottotitoli/ }));
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
    const findAudio = vi.fn(async (stream, at) => ({
        start: Math.floor(at / 5) * 5, // a keyframe every 5 seconds
        src: `/api/videos/7/audio/${stream}/stream?at=${at}`,
    }));
    afterEach(() => findAudio.mockClear());
    async function chooseInSettings(user, label) {
        await user.click(screen.getByRole("button", { name: "Impostazioni" }));
        await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: /^Audio/ }));
        await user.click(screen.getByRole("button", { name: label }));
    }
    it("offers no choice with only one sound track", async () => {
        const { user } = setup({ audio: audio.slice(0, 1), findAudio });
        await user.click(screen.getByRole("button", { name: "Impostazioni" }));
        expect(screen.queryByRole("button", { name: /^Audio/ })).not.toBeInTheDocument();
    });
    it("lets Safari switch the language itself, with no video made by the server", async () => {
        vi.stubGlobal("AudioTrackList", class {
        });
        const { user, video } = setup({ audio, findAudio, length: 245 });
        const tracks = [{ enabled: true }, { enabled: false }];
        Object.defineProperty(video, "audioTracks", { value: tracks });
        Object.defineProperty(video, "readyState", { value: HTMLMediaElement.HAVE_METADATA });
        const src = video.getAttribute("src");
        await chooseInSettings(user, "Inglese");
        await waitFor(() => expect(tracks).toEqual([{ enabled: false }, { enabled: true }]));
        expect(findAudio).not.toHaveBeenCalled();
        expect(video.getAttribute("src")).toBe(src);
        await user.click(screen.getByRole("button", { name: "Impostazioni" }));
        expect(within(screen.getByRole("dialog")).getByRole("button", { name: /^Audio/ })).toHaveTextContent("Inglese");
        vi.unstubAllGlobals();
    });
    it("on Safari, opens in the language chosen last time once the file is read", async () => {
        vi.stubGlobal("AudioTrackList", class {
        });
        window.localStorage.setItem("franzplay.audio", '"en"');
        const { video } = setup({ audio, findAudio });
        const tracks = [{ enabled: true }, { enabled: false }];
        Object.defineProperty(video, "audioTracks", { value: tracks });
        expect(tracks[1]?.enabled).toBe(false); // not read yet
        Object.defineProperty(video, "readyState", { value: HTMLMediaElement.HAVE_METADATA });
        fireEvent.loadedMetadata(video);
        await waitFor(() => expect(tracks).toEqual([{ enabled: false }, { enabled: true }]));
        expect(findAudio).not.toHaveBeenCalled();
        vi.unstubAllGlobals();
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
        expect(within(screen.getByRole("dialog")).getByRole("button", { name: /^Audio/ })).toHaveTextContent("Inglese");
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
        await user.click(screen.getByRole("button", { name: "Avanti di 15 secondi (l)" }));
        expect(findAudio).toHaveBeenLastCalledWith(2, 15);
        expect(video.getAttribute("src")).toBe("/api/videos/7/audio/2/stream?at=15");
    });
    it("opens in the language chosen last time", async () => {
        window.localStorage.setItem("franzplay.audio", '"en"');
        const { video } = setup({ audio, findAudio, startAt: 33 });
        expect(findAudio).toHaveBeenCalledWith(2, 33);
        await vi.waitFor(() => expect(video.getAttribute("src")).toBe("/api/videos/7/audio/2/stream?at=33"));
        expect(video.getAttribute("preload")).toBe("none");
        fireEvent.loadedMetadata(video);
        expect(video.currentTime).toBe(3);
    });
    it("says so when the language cannot be changed", async () => {
        const quiet = vi.spyOn(console, "error").mockImplementation(() => { });
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
describe("failureText", () => {
    it.each([
        [2, undefined, "La connessione"],
        [4, undefined, "non sa leggere il formato"],
        [undefined, undefined, "spostato o danneggiato"],
        [4, "Copia in arrivo.", "Copia in arrivo."],
    ])("code %s, hint %s", (code, hint, want) => {
        expect(failureText(code, hint)).toContain(want);
    });
});
describe("player on a touch screen", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());
    // playing sets up a player whose video plays, with a picture 300 wide.
    function playing() {
        const { video, play, pause } = setup();
        Object.defineProperty(video, "paused", { value: false, configurable: true });
        fireEvent.play(video);
        const root = document.querySelector("[data-controls]");
        const surface = document.querySelector("[data-surface]");
        vi.spyOn(surface, "getBoundingClientRect").mockReturnValue({ left: 0, width: 300 });
        const fullscreen = vi.fn(() => Promise.resolve());
        root.requestFullscreen = fullscreen;
        return { video, root, surface, fullscreen, play, pause };
    }
    // tap is a finger touching the picture at x and lifting: the browser
    // also says the finger left the player.
    function tap(surface, root, x = 150) {
        fireEvent.pointerDown(surface, { pointerType: "touch", clientX: x });
        fireEvent.pointerUp(surface, { pointerType: "touch", clientX: x });
        fireEvent.pointerLeave(root, { pointerType: "touch" });
    }
    function wait(ms) {
        act(() => {
            vi.advanceTimersByTime(ms);
        });
    }
    it("shows the controls on a tap and keeps them up while the finger is away", () => {
        const { root, surface } = playing();
        wait(hideAfter);
        expect(root).toHaveAttribute("data-controls", "hidden");
        tap(surface, root);
        expect(root).toHaveAttribute("data-controls", "visible");
        wait(hideAfter - 100);
        expect(root).toHaveAttribute("data-controls", "visible");
        wait(100);
        expect(root).toHaveAttribute("data-controls", "hidden");
    });
    it("keeps the controls up while a finger uses them", () => {
        const { root, surface } = playing();
        wait(hideAfter);
        tap(surface, root);
        wait(hideAfter - 100);
        const forward = screen.getByRole("button", { name: "Avanti di 15 secondi (l)" });
        fireEvent.pointerDown(forward, { pointerType: "touch" });
        wait(hideAfter - 100);
        expect(root).toHaveAttribute("data-controls", "visible");
    });
    it("hides the controls on a second tap, a moment later", () => {
        const { root, surface } = playing();
        wait(hideAfter);
        tap(surface, root);
        wait(doubleTapWithin + 1);
        expect(root).toHaveAttribute("data-controls", "visible");
        tap(surface, root);
        wait(doubleTapWithin);
        expect(root).toHaveAttribute("data-controls", "hidden");
    });
    it("jumps 15 seconds on a double tap on the sides, never full screen", () => {
        const { video, root, surface, fullscreen } = playing();
        video.currentTime = 100;
        tap(surface, root, 280);
        tap(surface, root, 280);
        fireEvent.doubleClick(surface);
        expect(video.currentTime).toBe(115);
        tap(surface, root, 20);
        wait(doubleTapWithin + 1);
        tap(surface, root, 20);
        tap(surface, root, 20);
        fireEvent.doubleClick(surface);
        expect(video.currentTime).toBe(100);
        expect(fullscreen).not.toHaveBeenCalled();
        expect(root).toHaveAttribute("data-controls", "visible");
    });
    it("goes full screen on a double tap in the middle", () => {
        const { video, root, surface, fullscreen } = playing();
        video.currentTime = 100;
        tap(surface, root, 150);
        tap(surface, root, 150);
        fireEvent.doubleClick(surface);
        expect(fullscreen).toHaveBeenCalledTimes(1);
        expect(video.currentTime).toBe(100);
    });
    it("goes full screen on a double click of the mouse, without pausing", () => {
        const { surface, fullscreen, play, pause } = playing();
        play.mockClear();
        fireEvent.pointerUp(surface, { pointerType: "mouse" });
        wait(doubleClickWithin / 2);
        fireEvent.pointerUp(surface, { pointerType: "mouse" });
        fireEvent.doubleClick(surface);
        wait(doubleClickWithin * 2);
        expect(fullscreen).toHaveBeenCalled();
        expect(pause).not.toHaveBeenCalled();
    });
    it("pauses on a single click of the mouse, a moment later", () => {
        const { surface, fullscreen, play, pause } = playing();
        play.mockClear();
        fireEvent.pointerUp(surface, { pointerType: "mouse" });
        wait(doubleClickWithin - 1);
        expect(pause).not.toHaveBeenCalled();
        wait(1);
        expect(pause).toHaveBeenCalledTimes(1);
        expect(fullscreen).not.toHaveBeenCalled();
    });
    it("keeps the video playing after a slow double click", () => {
        const { surface, fullscreen, play, pause } = playing();
        play.mockClear();
        fireEvent.pointerUp(surface, { pointerType: "mouse" });
        wait(doubleClickWithin + 100); // the first click already paused
        fireEvent.pointerUp(surface, { pointerType: "mouse" });
        fireEvent.doubleClick(surface);
        wait(doubleClickWithin * 2);
        expect(fullscreen).toHaveBeenCalled();
        expect(pause).toHaveBeenCalledTimes(1);
        expect(play).toHaveBeenCalledTimes(1);
    });
    it("does not undo an older click when a double click follows it", () => {
        const { surface, fullscreen, play, pause } = playing();
        fireEvent.pointerUp(surface, { pointerType: "mouse" });
        wait(1000); // a lone click: paused
        expect(pause).toHaveBeenCalledTimes(1);
        play.mockClear();
        fireEvent.pointerUp(surface, { pointerType: "mouse" });
        wait(doubleClickWithin / 2);
        fireEvent.pointerUp(surface, { pointerType: "mouse" });
        fireEvent.doubleClick(surface);
        wait(doubleClickWithin * 2);
        expect(fullscreen).toHaveBeenCalled();
        expect(play).not.toHaveBeenCalled();
    });
});
