import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useRef, useState, } from "react";
import { Icon } from "../../components/Icon";
import { formatDuration } from "../../lib/format";
import { usePresence } from "../../lib/presence";
import { loadSetting, saveSetting } from "../../lib/storage";
import { bufferedEnd, clampTime, clampVolume, insideRanges, keyAction, nativeAudio, originalAudio, pickAudio, skipSeconds, tapZone, wheelStep, wheelVolume, } from "./controls";
import styles from "./Player.module.css";
import { SettingsMenu } from "./SettingsMenu";
import { defaultSubtitleStyle, linesAt, parseSubtitleStyle, subtitleCSS } from "./subtitleStyle";
import { Timeline } from "./Timeline";
// reportEvery is how often, in seconds of video, onPosition hears the
// position while the video plays.
const reportEvery = 10;
// hideAfter is how long the controls stay visible after the last movement
// or touch, while the video plays.
export const hideAfter = 3000;
// doubleTapWithin is how close two taps must be to count as a double tap.
export const doubleTapWithin = 300;
// doubleClickWithin is how long a click of the mouse waits before playing
// or pausing: if a second click comes first, it was a double click, which
// only goes full screen.
export const doubleClickWithin = 200;
// slowDoubleClick is the longest double click computers allow by default.
const slowDoubleClick = 500;
const parseVolume = (data) => {
    if (typeof data !== "number" || data < 0 || data > 1)
        throw new Error("bad volume");
    return data;
};
const parseMuted = (data) => {
    if (typeof data !== "boolean")
        throw new Error("bad muted");
    return data;
};
const parseSubtitleChoice = (data) => {
    const d = (typeof data === "object" && data !== null ? data : {});
    if (typeof d.on !== "boolean" || typeof d.lang !== "string")
        throw new Error("bad subtitle choice");
    return { on: d.on, lang: d.lang };
};
// pickTrack chooses the subtitles to show when a video opens.
export function pickTrack(tracks, choice) {
    if (!choice.on || tracks.length === 0)
        return null;
    const base = (lang) => lang.toLowerCase().split("-")[0];
    const same = tracks.find((t) => t.lang === choice.lang) ??
        tracks.find((t) => base(t.lang) === base(choice.lang));
    return (same ?? tracks[0])?.key ?? null;
}
const parseTimeLeft = (data) => {
    if (typeof data !== "boolean")
        throw new Error("bad time left");
    return data;
};
const parseLang = (data) => {
    if (typeof data !== "string")
        throw new Error("bad language");
    return data;
};
// showNoticeFor is how long a short message stays over the video.
const showNoticeFor = 5000;
function rangesOf(list) {
    return Array.from({ length: list.length }, (_, i) => ({
        start: list.start(i),
        end: list.end(i),
    }));
}
function sameLines(a, b) {
    return a.length === b.length && a.every((line, i) => line === b[i]);
}
const noTracks = [];
const noAudio = [];
// startPlaying starts the video. The browser may refuse to start a video by
// itself: that is not an error.
function startPlaying(v) {
    v.play().catch((error) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) {
            console.warn("play refused", error);
        }
    });
}
// playByItself starts a video nobody pressed play on. Browsers allow that
// with sound only after the person clicked something on the site (like
// the video in a list); otherwise they allow it only without sound. So:
// with sound if allowed, else without and onSilenced, else not at all
// and onRefused (the big play button comes back).
function playByItself(v, onSilenced, onRefused) {
    v.play().catch((error) => {
        if (!(error instanceof DOMException && error.name === "NotAllowedError")) {
            if (!(error instanceof DOMException && error.name === "AbortError")) {
                console.warn("play refused", error);
                onRefused();
            }
            return;
        }
        if (v.muted) {
            onRefused();
            return;
        }
        v.muted = true;
        v.play()
            .then(onSilenced)
            .catch(() => {
            v.muted = false;
            onRefused();
        });
    });
}
// Player is FranzPLAY's video player, made to feel like YouTube's: a big
// timeline, big buttons, ±10 seconds with buttons, keys and double taps,
// speed in the settings, full screen.
export function Player({ src, poster, unsupportedHint, onUnsupported, subtitles = noTracks, startAt = 0, onPosition, preview, audio = noAudio, findAudio, length = null, autoPlay = false, theater = false, onTheater, }) {
    const root = useRef(null);
    const video = useRef(null);
    const volumeBox = useRef(null);
    const [playing, setPlaying] = useState(false);
    const [started, setStarted] = useState(false);
    const [time, setTime] = useState(0);
    const [duration, setDuration] = useState(Number.NaN);
    const [buffered, setBuffered] = useState(0);
    const [waiting, setWaiting] = useState(false);
    // failed is the browser's error code when the video stopped (0 = none
    // given): null while it plays fine.
    const [failed, setFailed] = useState(null);
    const [volume, setVolume] = useState(() => loadSetting("volume", parseVolume, 1));
    const [muted, setMuted] = useState(() => loadSetting("muted", parseMuted, false));
    // silenced: the browser let the video start by itself only without
    // sound. Not the person's choice, so it is not remembered.
    const [silenced, setSilenced] = useState(false);
    // starting: the video was asked to start by itself and is on its way.
    // It already looks like it plays (pause icon, loading circle), so a
    // click on a video feels immediate; the big play button only comes
    // back if the browser refuses. The ref is for the click handlers.
    const [starting, setStartingState] = useState(autoPlay);
    const startingRef = useRef(autoPlay);
    const setStarting = useCallback((value) => {
        startingRef.current = value;
        setStartingState(value);
    }, []);
    const [speed, setSpeed] = useState(1);
    // repeat starts the video again when it ends. Only for this video.
    const [repeat, setRepeat] = useState(false);
    const repeatRef = useRef(repeat);
    useEffect(() => {
        repeatRef.current = repeat;
    }, [repeat]);
    // timeLeft shows how much is left instead of the time passed.
    const [timeLeft, setTimeLeft] = useState(() => loadSetting("timeLeft", parseTimeLeft, false));
    const [fullscreen, setFullscreen] = useState(false);
    const [menuOpen, setMenuOpen] = useState(false);
    const [active, setActive] = useState(true); // the person moved recently
    const [flash, setFlash] = useState(null);
    // The settings menu and the big play button leave softly.
    const menu = usePresence(menuOpen ? true : null);
    const bigPlay = usePresence(!started && !starting && failed === null ? true : null);
    const [track, setTrack] = useState(() => pickTrack(subtitles, loadSetting("subtitles", parseSubtitleChoice, { on: false, lang: "" })));
    const [subtitleStyle, setSubtitleStyle] = useState(() => loadSetting("subtitleStyle", parseSubtitleStyle, defaultSubtitleStyle));
    const [caption, setCaption] = useState([]);
    const [notice, setNotice] = useState(null);
    // The sound track playing, when it is not the original one. The ref is
    // for the video's events, which must not wait for a new render.
    const [sound, setSound] = useState(null);
    const soundRef = useRef(null);
    // nativeStream is the sound track the browser itself plays, when it can
    // switch them (Safari): null = the original one.
    const [nativeStream, setNativeStream] = useState(null);
    const nativeRef = useRef(null);
    // nativeWanted is a sound track asked for before the browser knew them.
    const nativeWanted = useRef(null);
    // Where to go once the video with another sound track has loaded.
    const pending = useRef(null);
    // Counts the changes of sound track: an answer to an old one is ignored.
    const switches = useRef(0);
    const lengthRef = useRef(length);
    useEffect(() => {
        lengthRef.current = length;
    }, [length]);
    // The subtitles may arrive after the player: choose again when they do.
    useEffect(() => {
        setTrack(pickTrack(subtitles, loadSetting("subtitles", parseSubtitleChoice, { on: false, lang: "" })));
    }, [subtitles]);
    const hideTimer = useRef(undefined);
    const lastTap = useRef(0);
    // What pressed the picture last: a double tap of a finger must not also
    // count as a double click, which goes full screen.
    const lastPointer = useRef("");
    const tapTimer = useRef(undefined);
    useEffect(() => () => window.clearTimeout(tapTimer.current), []);
    // A click of the mouse waiting to see if a second one comes, and when
    // the last lone click that played or paused was made (a slow double
    // click undoes it).
    const clickTimer = useRef(undefined);
    const clickToggledAt = useRef(0);
    useEffect(() => () => window.clearTimeout(clickTimer.current), []);
    // What onPosition knows: the time now, the last one told, and whether
    // the video was played at all (opening a video is not watching it).
    const position = useRef({ time: startAt, told: startAt, played: false });
    const onPositionRef = useRef(onPosition);
    useEffect(() => {
        onPositionRef.current = onPosition;
    }, [onPosition]);
    const tell = useCallback(() => {
        const p = position.current;
        if (!p.played || p.time === p.told)
            return;
        p.told = p.time;
        onPositionRef.current?.(p.time);
    }, []);
    // Closing the page or leaving the video tells where it was left.
    useEffect(() => {
        window.addEventListener("pagehide", tell);
        return () => {
            window.removeEventListener("pagehide", tell);
            tell();
        };
    }, [tell]);
    // The video element follows the state chosen here.
    useEffect(() => {
        const v = video.current;
        if (!v)
            return;
        v.volume = volume;
        v.muted = muted || silenced;
        saveSetting("volume", volume);
        saveSetting("muted", muted);
    }, [volume, muted, silenced]);
    useEffect(() => {
        if (video.current)
            video.current.playbackRate = speed;
    }, [speed]);
    // A new video starts from scratch.
    // biome-ignore lint/correctness/useExhaustiveDependencies: src is the reason to reset
    useEffect(() => {
        setSilenced(false);
        setStarted(false);
        setFailed(null);
        setTime(0);
        setDuration(Number.NaN);
        setBuffered(0);
        nativeRef.current = null;
        nativeWanted.current = null;
        setNativeStream(null);
        // Asked right away, not when the first bytes arrive: the browser
        // then loads the video to play it, not only to read its length.
        const v = video.current;
        setStarting(autoPlay && v !== null);
        if (autoPlay && v) {
            playByItself(v, () => setSilenced(true), () => setStarting(false));
        }
    }, [src]);
    // The browser loads the chosen subtitles; FranzPLAY draws them itself,
    // so they can have the style chosen in the settings.
    useEffect(() => {
        const list = video.current?.textTracks;
        setCaption([]);
        if (!list)
            return;
        let shown = null;
        for (let i = 0; i < list.length; i++) {
            const t = list[i];
            const key = subtitles[i]?.key;
            t.mode = key !== undefined && key === track ? "hidden" : "disabled";
            if (t.mode === "hidden")
                shown = t;
        }
        const v = video.current;
        if (!shown || !v)
            return;
        const current = shown;
        // The time of the whole video: with another sound track the video
        // element counts from where the server's copy starts.
        const update = () => {
            const time = v.currentTime + (soundRef.current?.offset ?? 0);
            const lines = linesAt((current.cues ?? []), time);
            setCaption((before) => (sameLines(before, lines) ? before : lines));
        };
        current.addEventListener("cuechange", update);
        v.addEventListener("timeupdate", update);
        return () => {
            current.removeEventListener("cuechange", update);
            v.removeEventListener("timeupdate", update);
        };
    }, [track, subtitles]);
    const chooseTrack = useCallback((key) => {
        setTrack(key);
        const lang = subtitles.find((t) => t.key === key)?.lang ?? "";
        saveSetting("subtitles", { on: key !== null, lang });
    }, [subtitles]);
    const chooseStyle = useCallback((style) => {
        setSubtitleStyle(style);
        saveSetting("subtitleStyle", style);
    }, []);
    useEffect(() => {
        const onChange = () => setFullscreen(document.fullscreenElement === root.current);
        document.addEventListener("fullscreenchange", onChange);
        return () => document.removeEventListener("fullscreenchange", onChange);
    }, []);
    const showControls = useCallback(() => {
        setActive(true);
        window.clearTimeout(hideTimer.current);
        hideTimer.current = window.setTimeout(() => setActive(false), hideAfter);
    }, []);
    useEffect(() => () => window.clearTimeout(hideTimer.current), []);
    const showFlash = useCallback((icon) => setFlash({ icon, key: Date.now() }), []);
    const togglePlay = useCallback(() => {
        const v = video.current;
        if (!v)
            return;
        if (startingRef.current) {
            // Still on its way: the person wants it to stay still.
            setStarting(false);
            v.pause();
        }
        else if (v.paused || v.ended) {
            startPlaying(v);
        }
        else {
            v.pause();
        }
    }, [setStarting]);
    // realTime and realDuration are those of the whole video, whatever the
    // sound track.
    const realTime = useCallback((v) => v.currentTime + (soundRef.current?.offset ?? 0), []);
    const realDuration = useCallback((v) => (soundRef.current ? (lengthRef.current ?? Number.NaN) : v.duration), []);
    // switchNatively asks the browser itself to play a sound track (null:
    // the original one) when it can: Safari, which does not play the video
    // the server makes while it plays. The file and its copy hold every
    // sound track in the order of the list. It reports whether it did.
    const switchNatively = useCallback((v, stream) => {
        const tracks = nativeAudio(v);
        const want = stream ?? originalAudio(audio)?.stream ?? null;
        const index = audio.findIndex((a) => a.stream === want);
        if (!tracks || tracks.length !== audio.length || index < 0)
            return false;
        Array.from(tracks).forEach((track, i) => {
            track.enabled = i === index;
        });
        const chosen = want === originalAudio(audio)?.stream ? null : want;
        nativeRef.current = chosen;
        setNativeStream(chosen);
        return true;
    }, [audio]);
    // switchAudio plays the video with a sound track (null: the original
    // one), from at seconds.
    const switchAudio = useCallback(async (stream, at, play) => {
        const turn = ++switches.current;
        const v0 = video.current;
        if (v0 && !soundRef.current && nativeAudio(v0)) {
            if (v0.readyState < HTMLMediaElement.HAVE_METADATA) {
                // The browser knows the tracks once the start of the file is read.
                nativeWanted.current = { stream };
                return;
            }
            if (switchNatively(v0, stream))
                return;
        }
        let next = null;
        if (stream !== null && stream !== originalAudio(audio)?.stream) {
            if (!findAudio)
                return;
            try {
                const found = await findAudio(stream, at);
                next = { stream, src: found.src, offset: found.start };
            }
            catch (error) {
                if (turn !== switches.current)
                    return;
                console.error(error);
                setNotice("Adesso non si riesce a cambiare lingua: riprova tra poco.");
                return;
            }
            if (turn !== switches.current)
                return;
        }
        const v = video.current;
        const same = (next?.src ?? src) === (soundRef.current?.src ?? src);
        pending.current = same ? null : { at, play };
        soundRef.current = next;
        setSound(next);
        setTime(at);
        if (v && same) {
            // Same address: the video is already there, only the time moves.
            v.currentTime = Math.max(0, at - (next?.offset ?? 0));
            if (play)
                startPlaying(v);
        }
    }, [audio, findAudio, src, switchNatively]);
    const seekTo = useCallback((t) => {
        const v = video.current;
        if (!v)
            return;
        const target = clampTime(t, realDuration(v));
        setTime(target);
        const s = soundRef.current;
        if (!s) {
            v.currentTime = target;
            return;
        }
        // The server's copy is made while it plays: a time not downloaded
        // yet is asked for again.
        const local = target - s.offset;
        if (local >= 0 && insideRanges(rangesOf(v.buffered), local)) {
            v.currentTime = local;
        }
        else {
            void switchAudio(s.stream, target, !v.paused);
        }
    }, [realDuration, switchAudio]);
    // A new address does not load by itself (preload "none" for the server's
    // copies): playing it does, and the time is set once it has loaded.
    // biome-ignore lint/correctness/useExhaustiveDependencies: a new sound is the reason to start
    useEffect(() => {
        const v = video.current;
        if (v && pending.current?.play)
            startPlaying(v);
    }, [sound]);
    // The language chosen last time, if this video has it.
    useEffect(() => {
        const want = pickAudio(audio, loadSetting("audio", parseLang, ""));
        const now = soundRef.current?.stream ?? nativeRef.current ?? originalAudio(audio)?.stream ?? null;
        if (want === null || want === now)
            return;
        const v = video.current;
        void switchAudio(want, position.current.time, v ? !v.paused : false);
    }, [audio, switchAudio]);
    const chooseAudio = useCallback((stream) => {
        const v = video.current;
        if (!v)
            return;
        saveSetting("audio", audio.find((a) => a.stream === stream)?.lang ?? "");
        void switchAudio(stream, realTime(v), !v.paused);
    }, [audio, realTime, switchAudio]);
    useEffect(() => {
        if (notice === null)
            return;
        const timer = window.setTimeout(() => setNotice(null), showNoticeFor);
        return () => window.clearTimeout(timer);
    }, [notice]);
    const toggleFullscreen = useCallback(() => {
        const el = root.current;
        const v = video.current;
        if (document.fullscreenElement) {
            document.exitFullscreen().catch((error) => console.warn("exit fullscreen", error));
        }
        else if (el?.requestFullscreen) {
            el.requestFullscreen().catch((error) => console.warn("fullscreen refused", error));
        }
        else {
            v?.webkitEnterFullscreen?.(); // iPhone: only the video itself can go full screen
        }
    }, []);
    const run = useCallback((action) => {
        const v = video.current;
        if (!v)
            return;
        switch (action.kind) {
            case "toggle-play":
                showFlash(v.paused && !startingRef.current ? "play" : "pause");
                togglePlay();
                break;
            case "seek-by":
                seekTo(realTime(v) + action.seconds);
                showFlash(action.seconds < 0 ? "back15" : "forward15");
                break;
            case "seek-to-fraction":
                if (Number.isFinite(realDuration(v)))
                    seekTo(realDuration(v) * action.fraction);
                break;
            case "volume-by": {
                const next = clampVolume(v.volume + action.amount);
                setVolume(next);
                setMuted(next === 0);
                setSilenced(false);
                showFlash(next === 0 ? "muted" : "volume");
                break;
            }
            case "toggle-mute":
                setSilenced(false);
                setMuted(!v.muted);
                showFlash(v.muted ? "volume" : "muted");
                break;
            case "toggle-fullscreen":
                toggleFullscreen();
                break;
            case "toggle-theater":
                onTheater?.();
                break;
            case "toggle-subtitles":
                if (subtitles.length > 0) {
                    // Turned on for the first time: the language of the browser, if there.
                    chooseTrack(track === null ? pickTrack(subtitles, { on: true, lang: navigator.language }) : null);
                }
                break;
        }
        showControls();
    }, [
        seekTo,
        realTime,
        realDuration,
        showControls,
        showFlash,
        toggleFullscreen,
        onTheater,
        togglePlay,
        subtitles,
        track,
        chooseTrack,
    ]);
    // Keys work anywhere on the page, as on YouTube, except while typing.
    useEffect(() => {
        function onKeyDown(event) {
            if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented)
                return;
            if (event.key === "Escape") {
                setMenuOpen(false);
                return;
            }
            const target = event.target;
            if (target?.closest("input, textarea, select, [contenteditable='true']"))
                return;
            // Space and Enter on a focused button press that button.
            if (target?.closest("button") && (event.key === " " || event.key === "Enter"))
                return;
            const action = keyAction(event.key);
            if (!action)
                return;
            event.preventDefault();
            run(action);
        }
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, [run]);
    // The mouse wheel over the volume turns it up or down in small steps,
    // and does not scroll the page. React listens to the wheel without the
    // right to stop the page, so the listener is added by hand.
    useEffect(() => {
        const box = volumeBox.current;
        if (!box)
            return;
        let rest = 0;
        const onWheel = (event) => {
            const v = video.current;
            if (!v)
                return;
            event.preventDefault();
            const turn = wheelVolume(rest, event.deltaY, event.deltaMode);
            rest = turn.rest;
            if (turn.steps === 0)
                return;
            const from = v.muted ? 0 : v.volume;
            const next = clampVolume(from + turn.steps * wheelStep);
            v.volume = next; // right away: the next notch may come before React
            setVolume(next);
            setMuted(next === 0);
            setSilenced(false);
        };
        box.addEventListener("wheel", onWheel, { passive: false });
        return () => box.removeEventListener("wheel", onWheel);
    }, []);
    // On a touch screen a tap shows the controls, a double tap on the sides
    // jumps and one in the middle goes full screen; with a mouse a click
    // plays or pauses.
    function onSurfacePointerUp(event) {
        lastPointer.current = event.pointerType;
        if (menuOpen) {
            setMenuOpen(false); // a click outside the menu closes it, and does nothing else
            return;
        }
        if (event.pointerType !== "touch") {
            if (clickTimer.current !== undefined) {
                // The second click of a double click: full screen comes with it.
                window.clearTimeout(clickTimer.current);
                clickTimer.current = undefined;
                return;
            }
            const clickedAt = Date.now();
            clickTimer.current = window.setTimeout(() => {
                clickTimer.current = undefined;
                clickToggledAt.current = clickedAt;
                run({ kind: "toggle-play" });
            }, doubleClickWithin);
            return;
        }
        const now = Date.now();
        const rect = event.currentTarget.getBoundingClientRect();
        const zone = tapZone(event.clientX, rect.left, rect.width);
        if (now - lastTap.current < doubleTapWithin) {
            // A double tap on the sides jumps; in the middle it goes full screen.
            window.clearTimeout(tapTimer.current); // the first tap was half of this
            if (zone === "middle") {
                toggleFullscreen();
            }
            else {
                run({ kind: "seek-by", seconds: zone === "back" ? -skipSeconds : skipSeconds });
            }
            lastTap.current = 0;
            return;
        }
        lastTap.current = now;
        if (active && started && playing) {
            // A tap on visible controls hides them, but only once it is clear it
            // is not the first half of a double tap.
            window.clearTimeout(tapTimer.current);
            tapTimer.current = window.setTimeout(() => {
                window.clearTimeout(hideTimer.current);
                setActive(false);
            }, doubleTapWithin);
        }
        else {
            showControls();
        }
    }
    // A double click of the mouse only goes full screen. If it was slower
    // than doubleClickWithin, its first click already played or paused:
    // that is undone, so the video stays as it was.
    function onSurfaceDoubleClick() {
        if (lastPointer.current !== "mouse")
            return;
        window.clearTimeout(clickTimer.current);
        clickTimer.current = undefined;
        if (Date.now() - clickToggledAt.current < slowDoubleClick)
            togglePlay();
        clickToggledAt.current = 0;
        toggleFullscreen();
    }
    function onProgress(event) {
        const v = event.currentTarget;
        const ranges = Array.from({ length: v.buffered.length }, (_, i) => ({
            start: v.buffered.start(i),
            end: v.buffered.end(i),
        }));
        setBuffered(bufferedEnd(ranges, v.currentTime) + (soundRef.current?.offset ?? 0));
    }
    const controlsVisible = !playing || active || menuOpen;
    return (_jsxs("div", { ref: root, className: styles.root, "data-controls": controlsVisible ? "visible" : "hidden", "data-theater": theater ? "on" : undefined, onPointerMove: (event) => event.pointerType !== "touch" && showControls(), 
        // A finger on a button of the controls keeps them up a while longer.
        onPointerDown: (event) => {
            if (event.pointerType === "touch" && event.target !== event.currentTarget) {
                if (!event.target.dataset.surface)
                    showControls();
            }
        }, 
        // Only the mouse leaves: a finger "leaves" every time it lifts.
        onPointerLeave: (event) => event.pointerType === "mouse" && playing && setActive(false), children: [_jsx("video", { ref: video, className: styles.video, src: sound?.src ?? src, poster: poster ?? undefined, 
                // The server makes a sound track only while it is watched.
                preload: sound ? "none" : "metadata", playsInline: true, onPlay: () => {
                    position.current.played = true;
                    setStarting(false);
                    setPlaying(true);
                    setStarted(true);
                    showControls();
                }, onPause: () => {
                    setPlaying(false);
                    tell();
                }, onEnded: (event) => {
                    if (repeatRef.current) {
                        // From the start again; the time left is not "watched to the end".
                        const s = soundRef.current;
                        if (s) {
                            void switchAudio(s.stream, 0, true);
                        }
                        else {
                            event.currentTarget.currentTime = 0;
                            startPlaying(event.currentTarget);
                        }
                        return;
                    }
                    setPlaying(false);
                    tell();
                }, onTimeUpdate: (event) => {
                    const v = event.currentTarget;
                    if (pending.current)
                        return; // still the time of the video left
                    const now = realTime(v);
                    setTime(now);
                    position.current.time = now;
                    if (!v.paused && Math.abs(now - position.current.told) >= reportEvery)
                        tell();
                }, onSeeked: (event) => {
                    position.current.time = realTime(event.currentTarget);
                    if (event.currentTarget.paused)
                        tell();
                }, onDurationChange: (event) => setDuration(realDuration(event.currentTarget)), onLoadedMetadata: (event) => {
                    const v = event.currentTarget;
                    setDuration(realDuration(v));
                    const wanted = nativeWanted.current;
                    if (wanted) {
                        nativeWanted.current = null;
                        void switchAudio(wanted.stream, realTime(v), !v.paused);
                    }
                    const p = pending.current;
                    if (p) {
                        // Another sound track: go back to where the person was.
                        pending.current = null;
                        v.currentTime = Math.max(0, p.at - (soundRef.current?.offset ?? 0));
                        return;
                    }
                    // Start where the person stopped, if that is still inside the video.
                    if (startAt > 0 && v.currentTime === 0 && !(startAt >= v.duration)) {
                        v.currentTime = startAt;
                        setTime(startAt);
                    }
                }, onProgress: onProgress, onWaiting: () => setWaiting(true), onPlaying: () => setWaiting(false), onCanPlay: () => setWaiting(false), onError: (e) => {
                    if (soundRef.current) {
                        // The server could not make this sound track: back to the original.
                        setNotice("Questa lingua adesso non si riesce a caricare: riprova tra poco.");
                        void switchAudio(null, position.current.time, false);
                        return;
                    }
                    const code = e.currentTarget.error?.code ?? 0;
                    setStarting(false);
                    setFailed(code);
                    if (code !== 2)
                        onUnsupported?.(); // 2: the network, not the format
                }, children: subtitles.map((t) => (_jsx("track", { kind: "subtitles", src: t.src, srcLang: t.lang || undefined, label: t.label }, t.key))) }), _jsx("div", { className: styles.surface, "data-surface": "true", onPointerUp: onSurfacePointerUp, 
                // A double click of the mouse goes full screen; taps are counted above.
                onDoubleClick: onSurfaceDoubleClick, "aria-hidden": "true" }), caption.length > 0 && (_jsx("div", { className: styles.captions, "data-position": subtitleStyle.position, "aria-live": "off", children: caption.map((line, i) => (_jsx("span", { className: styles.captionLine, style: subtitleCSS(subtitleStyle), children: line }, i))) })), ((waiting && playing) || (starting && failed === null)) && (_jsx("div", { className: styles.spinner, role: "status", "aria-label": "Caricamento" })), flash && (_jsx("div", { className: styles.flash, "aria-hidden": "true", children: _jsx(Icon, { name: flash.icon, size: 36 }) }, flash.key)), bigPlay.shown && (_jsx("button", { ref: bigPlay.ref, type: "button", className: styles.bigPlay, onClick: togglePlay, "aria-label": "Guarda", "data-leaving": bigPlay.leaving || undefined, tabIndex: bigPlay.leaving ? -1 : undefined, children: _jsx(Icon, { name: "play", size: 40 }) })), silenced && (_jsxs("button", { type: "button", className: `glass ${styles.unmute}`, onClick: () => run({ kind: "toggle-mute" }), children: [_jsx(Icon, { name: "muted", size: 20 }), "Attiva l'audio"] })), notice && (_jsx("div", { className: `glass ${styles.notice}`, role: "status", children: notice })), failed !== null && (_jsxs("div", { className: styles.failure, role: "alert", children: [_jsx("p", { className: styles.failureTitle, children: "Questo video non si riesce a riprodurre" }), _jsx("p", { className: styles.failureText, children: failureText(failed, unsupportedHint) })] })), menu.shown && (_jsx(SettingsMenu, { ref: menu.ref, leaving: menu.leaving, speed: speed, onSpeed: setSpeed, tracks: subtitles, track: track, audio: audio, audioStream: sound?.stream ?? nativeStream ?? originalAudio(audio)?.stream ?? null, onAudio: chooseAudio, onTrack: chooseTrack, subtitleStyle: subtitleStyle, onSubtitleStyle: chooseStyle, repeat: repeat, onRepeat: setRepeat, onClose: () => setMenuOpen(false) })), _jsxs("div", { className: styles.controls, children: [_jsx(Timeline, { time: time, duration: duration, buffered: buffered, onSeek: seekTo, preview: preview }), _jsxs("div", { className: styles.bar, children: [_jsx("button", { type: "button", className: styles.button, onClick: () => run({ kind: "toggle-play" }), "aria-label": playing || starting ? "Pausa (k)" : "Riproduci (k)", children: _jsx("span", { className: styles.swap, children: _jsx(Icon, { name: playing || starting ? "pause" : "play", size: 26 }) }, playing || starting ? "pause" : "play") }), _jsx("button", { type: "button", className: styles.button, onClick: () => run({ kind: "seek-by", seconds: -skipSeconds }), "aria-label": "Indietro di 15 secondi (j)", children: _jsx(Icon, { name: "back15", size: 26 }) }), _jsx("button", { type: "button", className: styles.button, onClick: () => run({ kind: "seek-by", seconds: skipSeconds }), "aria-label": "Avanti di 15 secondi (l)", children: _jsx(Icon, { name: "forward15", size: 26 }) }), _jsxs("div", { ref: volumeBox, className: styles.volume, children: [_jsx("button", { type: "button", className: styles.button, onClick: () => run({ kind: "toggle-mute" }), "aria-label": muted || silenced ? "Riattiva l'audio (m)" : "Disattiva l'audio (m)", children: _jsx("span", { className: styles.swap, children: _jsx(Icon, { name: muted || silenced || volume === 0 ? "muted" : "volume", size: 26 }) }, String(muted || silenced || volume === 0)) }), _jsx("input", { type: "range", className: styles.volumeSlider, min: 0, max: 1, step: 0.05, value: muted || silenced ? 0 : volume, style: { "--level": `${(muted || silenced ? 0 : volume) * 100}%` }, "aria-label": "Volume", onChange: (event) => {
                                            const next = clampVolume(Number(event.target.value));
                                            setVolume(next);
                                            setMuted(next === 0);
                                            setSilenced(false);
                                        } })] }), _jsxs("button", { type: "button", className: styles.time, onClick: () => {
                                    setTimeLeft(!timeLeft);
                                    saveSetting("timeLeft", !timeLeft);
                                }, disabled: !Number.isFinite(duration), "aria-label": timeLeft ? "Mostra il tempo passato" : "Mostra quanto manca", title: timeLeft ? "Mostra il tempo passato" : "Mostra quanto manca", children: [timeLeft && Number.isFinite(duration)
                                        ? `-${formatDuration(duration - time)}`
                                        : formatDuration(time), Number.isFinite(duration) && (_jsxs("span", { className: styles.total, children: [" / ", formatDuration(duration)] }))] }), _jsx("span", { className: styles.spacer }), _jsx("button", { type: "button", className: styles.button, onClick: () => run({ kind: "toggle-subtitles" }), disabled: subtitles.length === 0, "aria-pressed": track !== null, "aria-label": subtitles.length === 0 ? "Nessun sottotitolo per questo video" : "Sottotitoli (c)", title: subtitles.length === 0 ? "Nessun sottotitolo per questo video" : undefined, children: _jsx(Icon, { name: "subtitles", size: 26 }) }), _jsx("button", { type: "button", className: styles.button, onClick: () => setMenuOpen((open) => !open), "aria-label": "Impostazioni", "aria-expanded": menuOpen, children: _jsx(Icon, { name: "settings", size: 24 }) }), onTheater && (_jsx("button", { type: "button", className: `${styles.button} ${styles.theaterButton}`, onClick: onTheater, "aria-label": theater ? "Visualizzazione normale (t)" : "Modalità Teatro (t)", title: theater ? "Visualizzazione normale (t)" : "Modalità Teatro (t)", children: _jsx(Icon, { name: theater ? "theaterExit" : "theater", size: 24 }) })), _jsx("button", { type: "button", className: styles.button, onClick: toggleFullscreen, "aria-label": fullscreen ? "Esci da schermo intero (f)" : "Schermo intero (f)", children: _jsx(Icon, { name: fullscreen ? "exitFullscreen" : "fullscreen", size: 24 }) })] })] })] }));
}
// failureText explains why a video stopped, from the browser's error code
// (MediaError.code). hint, when given, is what the page already knows about
// a format not every browser plays.
export function failureText(code, hint) {
    if (hint) {
        return hint;
    }
    switch (code) {
        case 2: // MEDIA_ERR_NETWORK
            return "La connessione con FranzPLAY si è interrotta. Controlla la rete e riprova.";
        case 3: // MEDIA_ERR_DECODE
        case 4: // MEDIA_ERR_SRC_NOT_SUPPORTED
            return "Questo browser non sa leggere il formato di questo video. Prova con un altro browser, come Chrome, Safari o Firefox.";
        default:
            return "Il file potrebbe essere stato spostato o danneggiato. Riprova più tardi.";
    }
}
