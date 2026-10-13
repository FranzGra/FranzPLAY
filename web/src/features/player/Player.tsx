import {
  type PointerEvent,
  type SyntheticEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import type { AudioStart, AudioTrack } from "../../api/audio";
import type { Preview, SubtitleTrack } from "../../api/videos";
import { Icon } from "../../components/Icon";
import { formatDuration } from "../../lib/format";
import { loadSetting, saveSetting } from "../../lib/storage";
import {
  type Action,
  bufferedEnd,
  clampTime,
  clampVolume,
  insideRanges,
  keyAction,
  originalAudio,
  pickAudio,
  skipSeconds,
  tapZone,
} from "./controls";
import styles from "./Player.module.css";
import { SettingsMenu } from "./SettingsMenu";
import { defaultSubtitleStyle, linesAt, parseSubtitleStyle, subtitleCSS } from "./subtitleStyle";
import { Timeline } from "./Timeline";

type PlayerProps = {
  src: string;
  poster: string | null;
  // unsupportedHint explains why the video may not play, when the server
  // already knows the browser may not manage its format.
  unsupportedHint?: string;
  // subtitles found next to the video file.
  subtitles?: SubtitleTrack[];
  // startAt is where to start, in seconds: where the person stopped last time.
  startAt?: number;
  // onPosition hears where the video is, to remember it: every few seconds
  // while it plays, on pause, after a jump, at the end, and when the player
  // closes. Only once the video has been played.
  onPosition?: (seconds: number) => void;
  // preview holds small frames of the video, shown over the timeline.
  preview?: Preview | null;
  // audio lists the sound tracks, when there is a choice of language.
  audio?: AudioTrack[];
  // findAudio asks the server where to play a sound track from.
  findAudio?: (stream: number, at: number) => Promise<AudioStart>;
  // length is the duration the server knows, in seconds: a sound track
  // made while it plays cannot tell its own.
  length?: number | null;
  // autoPlay starts the video as soon as it is ready.
  autoPlay?: boolean;
};

// reportEvery is how often, in seconds of video, onPosition hears the
// position while the video plays.
const reportEvery = 10;

// hideAfter is how long the controls stay visible after the last movement,
// while the video plays.
const hideAfter = 2500;
// doubleTapWithin is how close two taps must be to count as a double tap.
const doubleTapWithin = 300;

type Flash = { icon: "back10" | "forward10" | "play" | "pause" | "volume" | "muted"; key: number };

const parseVolume = (data: unknown) => {
  if (typeof data !== "number" || data < 0 || data > 1) throw new Error("bad volume");
  return data;
};
const parseMuted = (data: unknown) => {
  if (typeof data !== "boolean") throw new Error("bad muted");
  return data;
};

// SubtitleChoice is remembered between videos: whether subtitles are on,
// and in which language.
type SubtitleChoice = { on: boolean; lang: string };
const parseSubtitleChoice = (data: unknown): SubtitleChoice => {
  const d = (typeof data === "object" && data !== null ? data : {}) as Record<string, unknown>;
  if (typeof d.on !== "boolean" || typeof d.lang !== "string")
    throw new Error("bad subtitle choice");
  return { on: d.on, lang: d.lang };
};

// pickTrack chooses the subtitles to show when a video opens.
export function pickTrack(tracks: SubtitleTrack[], choice: SubtitleChoice): string | null {
  if (!choice.on || tracks.length === 0) return null;
  const base = (lang: string) => lang.toLowerCase().split("-")[0];
  const same =
    tracks.find((t) => t.lang === choice.lang) ??
    tracks.find((t) => base(t.lang) === base(choice.lang));
  return (same ?? tracks[0])?.key ?? null;
}

const parseTimeLeft = (data: unknown) => {
  if (typeof data !== "boolean") throw new Error("bad time left");
  return data;
};

const parseLang = (data: unknown) => {
  if (typeof data !== "string") throw new Error("bad language");
  return data;
};

// Sound is a sound track other than the original one. The server makes the
// video with it while it plays, starting at offset seconds: the video
// element counts its time from there.
type Sound = { stream: number; src: string; offset: number };

// showNoticeFor is how long a short message stays over the video.
const showNoticeFor = 5000;

function rangesOf(list: TimeRanges): { start: number; end: number }[] {
  return Array.from({ length: list.length }, (_, i) => ({
    start: list.start(i),
    end: list.end(i),
  }));
}

function sameLines(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((line, i) => line === b[i]);
}

const noTracks: SubtitleTrack[] = [];
const noAudio: AudioTrack[] = [];

// startPlaying starts the video. The browser may refuse to start a video by
// itself: that is not an error.
function startPlaying(v: HTMLVideoElement) {
  v.play().catch((error: unknown) => {
    if (!(error instanceof DOMException && error.name === "AbortError")) {
      console.warn("play refused", error);
    }
  });
}

// playByItself starts a video nobody pressed play on. Browsers allow that
// with sound only after the person clicked something on the site (like
// the video in a list); otherwise they allow it only without sound. So:
// with sound if allowed, else without and onSilenced, else not at all
// (the big play button stays).
function playByItself(v: HTMLVideoElement, onSilenced: () => void) {
  v.play().catch((error: unknown) => {
    if (!(error instanceof DOMException && error.name === "NotAllowedError")) {
      if (!(error instanceof DOMException && error.name === "AbortError")) {
        console.warn("play refused", error);
      }
      return;
    }
    if (v.muted) return;
    v.muted = true;
    v.play()
      .then(onSilenced)
      .catch(() => {
        v.muted = false;
      });
  });
}

// Player is FranzPLAY's video player, made to feel like YouTube's: a big
// timeline, big buttons, ±10 seconds with buttons, keys and double taps,
// speed in the settings, full screen.
export function Player({
  src,
  poster,
  unsupportedHint,
  subtitles = noTracks,
  startAt = 0,
  onPosition,
  preview,
  audio = noAudio,
  findAudio,
  length = null,
  autoPlay = false,
}: PlayerProps) {
  const root = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(Number.NaN);
  const [buffered, setBuffered] = useState(0);
  const [waiting, setWaiting] = useState(false);
  // failed says why the video stopped: null while it plays fine.
  const [failed, setFailed] = useState<string | null>(null);
  const [volume, setVolume] = useState(() => loadSetting("volume", parseVolume, 1));
  const [muted, setMuted] = useState(() => loadSetting("muted", parseMuted, false));
  // silenced: the browser let the video start by itself only without
  // sound. Not the person's choice, so it is not remembered.
  const [silenced, setSilenced] = useState(false);
  // Whether starting by itself was already tried for this video.
  const autoTried = useRef(false);
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
  const [flash, setFlash] = useState<Flash | null>(null);
  const [track, setTrack] = useState<string | null>(() =>
    pickTrack(subtitles, loadSetting("subtitles", parseSubtitleChoice, { on: false, lang: "" })),
  );
  const [subtitleStyle, setSubtitleStyle] = useState(() =>
    loadSetting("subtitleStyle", parseSubtitleStyle, defaultSubtitleStyle),
  );
  const [caption, setCaption] = useState<string[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  // The sound track playing, when it is not the original one. The ref is
  // for the video's events, which must not wait for a new render.
  const [sound, setSound] = useState<Sound | null>(null);
  const soundRef = useRef<Sound | null>(null);
  // Where to go once the video with another sound track has loaded.
  const pending = useRef<{ at: number; play: boolean } | null>(null);
  // Counts the changes of sound track: an answer to an old one is ignored.
  const switches = useRef(0);
  const lengthRef = useRef(length);
  useEffect(() => {
    lengthRef.current = length;
  }, [length]);
  // The subtitles may arrive after the player: choose again when they do.
  useEffect(() => {
    setTrack(
      pickTrack(subtitles, loadSetting("subtitles", parseSubtitleChoice, { on: false, lang: "" })),
    );
  }, [subtitles]);
  const hideTimer = useRef<number | undefined>(undefined);
  const lastTap = useRef(0);

  // What onPosition knows: the time now, the last one told, and whether
  // the video was played at all (opening a video is not watching it).
  const position = useRef({ time: startAt, told: startAt, played: false });
  const onPositionRef = useRef(onPosition);
  useEffect(() => {
    onPositionRef.current = onPosition;
  }, [onPosition]);
  const tell = useCallback(() => {
    const p = position.current;
    if (!p.played || p.time === p.told) return;
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
    if (!v) return;
    v.volume = volume;
    v.muted = muted || silenced;
    saveSetting("volume", volume);
    saveSetting("muted", muted);
  }, [volume, muted, silenced]);

  useEffect(() => {
    if (video.current) video.current.playbackRate = speed;
  }, [speed]);

  // A new video starts from scratch.
  // biome-ignore lint/correctness/useExhaustiveDependencies: src is the reason to reset
  useEffect(() => {
    autoTried.current = false;
    setSilenced(false);
    setStarted(false);
    setFailed(null);
    setTime(0);
    setDuration(Number.NaN);
    setBuffered(0);
  }, [src]);

  // The browser loads the chosen subtitles; FranzPLAY draws them itself,
  // so they can have the style chosen in the settings.
  useEffect(() => {
    const list = video.current?.textTracks;
    setCaption([]);
    if (!list) return;
    let shown: TextTrack | null = null;
    for (let i = 0; i < list.length; i++) {
      const t = list[i] as TextTrack;
      const key = subtitles[i]?.key;
      t.mode = key !== undefined && key === track ? "hidden" : "disabled";
      if (t.mode === "hidden") shown = t;
    }
    const v = video.current;
    if (!shown || !v) return;
    const current = shown;
    // The time of the whole video: with another sound track the video
    // element counts from where the server's copy starts.
    const update = () => {
      const time = v.currentTime + (soundRef.current?.offset ?? 0);
      const lines = linesAt((current.cues ?? []) as ArrayLike<VTTCue>, time);
      setCaption((before) => (sameLines(before, lines) ? before : lines));
    };
    current.addEventListener("cuechange", update);
    v.addEventListener("timeupdate", update);
    return () => {
      current.removeEventListener("cuechange", update);
      v.removeEventListener("timeupdate", update);
    };
  }, [track, subtitles]);

  const chooseTrack = useCallback(
    (key: string | null) => {
      setTrack(key);
      const lang = subtitles.find((t) => t.key === key)?.lang ?? "";
      saveSetting("subtitles", { on: key !== null, lang });
    },
    [subtitles],
  );

  const chooseStyle = useCallback((style: typeof subtitleStyle) => {
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

  const showFlash = useCallback((icon: Flash["icon"]) => setFlash({ icon, key: Date.now() }), []);

  const togglePlay = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (v.paused || v.ended) {
      startPlaying(v);
    } else {
      v.pause();
    }
  }, []);

  // realTime and realDuration are those of the whole video, whatever the
  // sound track.
  const realTime = useCallback(
    (v: HTMLVideoElement) => v.currentTime + (soundRef.current?.offset ?? 0),
    [],
  );
  const realDuration = useCallback(
    (v: HTMLVideoElement) => (soundRef.current ? (lengthRef.current ?? Number.NaN) : v.duration),
    [],
  );

  // switchAudio plays the video with a sound track (null: the original
  // one), from at seconds.
  const switchAudio = useCallback(
    async (stream: number | null, at: number, play: boolean) => {
      const turn = ++switches.current;
      let next: Sound | null = null;
      if (stream !== null && stream !== originalAudio(audio)?.stream) {
        if (!findAudio) return;
        try {
          const found = await findAudio(stream, at);
          next = { stream, src: found.src, offset: found.start };
        } catch (error) {
          if (turn !== switches.current) return;
          console.error(error);
          setNotice("Adesso non si riesce a cambiare lingua: riprova tra poco.");
          return;
        }
        if (turn !== switches.current) return;
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
        if (play) startPlaying(v);
      }
    },
    [audio, findAudio, src],
  );

  const seekTo = useCallback(
    (t: number) => {
      const v = video.current;
      if (!v) return;
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
      } else {
        void switchAudio(s.stream, target, !v.paused);
      }
    },
    [realDuration, switchAudio],
  );

  // A new address does not load by itself (preload "none" for the server's
  // copies): playing it does, and the time is set once it has loaded.
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new sound is the reason to start
  useEffect(() => {
    const v = video.current;
    if (v && pending.current?.play) startPlaying(v);
  }, [sound]);

  // The language chosen last time, if this video has it.
  useEffect(() => {
    const want = pickAudio(audio, loadSetting("audio", parseLang, ""));
    const now = soundRef.current?.stream ?? originalAudio(audio)?.stream ?? null;
    if (want === null || want === now) return;
    const v = video.current;
    void switchAudio(want, position.current.time, v ? !v.paused : false);
  }, [audio, switchAudio]);

  const chooseAudio = useCallback(
    (stream: number) => {
      const v = video.current;
      if (!v) return;
      saveSetting("audio", audio.find((a) => a.stream === stream)?.lang ?? "");
      void switchAudio(stream, realTime(v), !v.paused);
    },
    [audio, realTime, switchAudio],
  );

  useEffect(() => {
    if (notice === null) return;
    const timer = window.setTimeout(() => setNotice(null), showNoticeFor);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const toggleFullscreen = useCallback(() => {
    const el = root.current;
    const v = video.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch((error: unknown) => console.warn("exit fullscreen", error));
    } else if (el?.requestFullscreen) {
      el.requestFullscreen().catch((error: unknown) => console.warn("fullscreen refused", error));
    } else {
      v?.webkitEnterFullscreen?.(); // iPhone: only the video itself can go full screen
    }
  }, []);

  const run = useCallback(
    (action: Action) => {
      const v = video.current;
      if (!v) return;
      switch (action.kind) {
        case "toggle-play":
          showFlash(v.paused ? "play" : "pause");
          togglePlay();
          break;
        case "seek-by":
          seekTo(realTime(v) + action.seconds);
          showFlash(action.seconds < 0 ? "back10" : "forward10");
          break;
        case "seek-to-fraction":
          if (Number.isFinite(realDuration(v))) seekTo(realDuration(v) * action.fraction);
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
        case "toggle-subtitles":
          if (subtitles.length > 0) {
            // Turned on for the first time: the language of the browser, if there.
            chooseTrack(
              track === null ? pickTrack(subtitles, { on: true, lang: navigator.language }) : null,
            );
          }
          break;
      }
      showControls();
    },
    [
      seekTo,
      realTime,
      realDuration,
      showControls,
      showFlash,
      toggleFullscreen,
      togglePlay,
      subtitles,
      track,
      chooseTrack,
    ],
  );

  // Keys work anywhere on the page, as on YouTube, except while typing.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
      if (event.key === "Escape") {
        setMenuOpen(false);
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      // Space and Enter on a focused button press that button.
      if (target?.closest("button") && (event.key === " " || event.key === "Enter")) return;
      const action = keyAction(event.key);
      if (!action) return;
      event.preventDefault();
      run(action);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [run]);

  // On a touch screen a tap shows the controls and a double tap on the
  // sides jumps; with a mouse a click plays or pauses.
  function onSurfacePointerUp(event: PointerEvent<HTMLDivElement>) {
    if (menuOpen) {
      setMenuOpen(false); // a click outside the menu closes it, and does nothing else
      return;
    }
    if (event.pointerType !== "touch") {
      run({ kind: "toggle-play" });
      return;
    }
    const now = Date.now();
    const rect = event.currentTarget.getBoundingClientRect();
    const zone = tapZone(event.clientX, rect.left, rect.width);
    if (now - lastTap.current < doubleTapWithin && zone !== "middle") {
      run({ kind: "seek-by", seconds: zone === "back" ? -skipSeconds : skipSeconds });
      lastTap.current = 0;
      return;
    }
    lastTap.current = now;
    if (active && started) {
      setActive(false);
    } else {
      showControls();
    }
  }

  function onProgress(event: SyntheticEvent<HTMLVideoElement>) {
    const v = event.currentTarget;
    const ranges = Array.from({ length: v.buffered.length }, (_, i) => ({
      start: v.buffered.start(i),
      end: v.buffered.end(i),
    }));
    setBuffered(bufferedEnd(ranges, v.currentTime) + (soundRef.current?.offset ?? 0));
  }

  const controlsVisible = !playing || active || menuOpen;
  return (
    <div
      ref={root}
      className={styles.root}
      data-controls={controlsVisible ? "visible" : "hidden"}
      onPointerMove={(event) => event.pointerType !== "touch" && showControls()}
      onPointerLeave={() => playing && setActive(false)}
    >
      {/* biome-ignore lint/a11y/useMediaCaption: many home videos have no subtitles; when they do, they are tracks below */}
      <video
        ref={video}
        className={styles.video}
        src={sound?.src ?? src}
        poster={poster ?? undefined}
        // The server makes a sound track only while it is watched.
        preload={sound ? "none" : "metadata"}
        playsInline
        onPlay={() => {
          position.current.played = true;
          setPlaying(true);
          setStarted(true);
          showControls();
        }}
        onPause={() => {
          setPlaying(false);
          tell();
        }}
        onEnded={(event) => {
          if (repeatRef.current) {
            // From the start again; the time left is not "watched to the end".
            const s = soundRef.current;
            if (s) {
              void switchAudio(s.stream, 0, true);
            } else {
              event.currentTarget.currentTime = 0;
              startPlaying(event.currentTarget);
            }
            return;
          }
          setPlaying(false);
          tell();
        }}
        onTimeUpdate={(event) => {
          const v = event.currentTarget;
          if (pending.current) return; // still the time of the video left
          const now = realTime(v);
          setTime(now);
          position.current.time = now;
          if (!v.paused && Math.abs(now - position.current.told) >= reportEvery) tell();
        }}
        onSeeked={(event) => {
          position.current.time = realTime(event.currentTarget);
          if (event.currentTarget.paused) tell();
        }}
        onDurationChange={(event) => setDuration(realDuration(event.currentTarget))}
        onLoadedMetadata={(event) => {
          const v = event.currentTarget;
          setDuration(realDuration(v));
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
          if (autoPlay && !autoTried.current && !position.current.played) {
            autoTried.current = true;
            playByItself(v, () => setSilenced(true));
          }
        }}
        onProgress={onProgress}
        onWaiting={() => setWaiting(true)}
        onPlaying={() => setWaiting(false)}
        onCanPlay={() => setWaiting(false)}
        onError={(e) => {
          if (soundRef.current) {
            // The server could not make this sound track: back to the original.
            setNotice("Questa lingua adesso non si riesce a caricare: riprova tra poco.");
            void switchAudio(null, position.current.time, false);
            return;
          }
          setFailed(failureText(e.currentTarget.error?.code, unsupportedHint));
        }}
      >
        {subtitles.map((t) => (
          <track
            key={t.key}
            kind="subtitles"
            src={t.src}
            srcLang={t.lang || undefined}
            label={t.label}
          />
        ))}
      </video>

      {/* The surface catches clicks and taps on the picture. */}
      <div
        className={styles.surface}
        onPointerUp={onSurfacePointerUp}
        onDoubleClick={(event) => {
          if ((event.nativeEvent as globalThis.PointerEvent).pointerType !== "touch") {
            toggleFullscreen();
          }
        }}
        aria-hidden="true"
      />

      {caption.length > 0 && (
        <div className={styles.captions} data-position={subtitleStyle.position} aria-live="off">
          {caption.map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines of one cue have no other identity
            <span key={i} className={styles.captionLine} style={subtitleCSS(subtitleStyle)}>
              {line}
            </span>
          ))}
        </div>
      )}

      {waiting && playing && (
        <div className={styles.spinner} role="status" aria-label="Caricamento" />
      )}

      {flash && (
        <div key={flash.key} className={styles.flash} aria-hidden="true">
          <Icon name={flash.icon} size={36} />
        </div>
      )}

      {!started && !failed && (
        <button type="button" className={styles.bigPlay} onClick={togglePlay} aria-label="Guarda">
          <Icon name="play" size={40} />
        </button>
      )}

      {silenced && (
        <button
          type="button"
          className={`glass ${styles.unmute}`}
          onClick={() => run({ kind: "toggle-mute" })}
        >
          <Icon name="muted" size={20} />
          Attiva l'audio
        </button>
      )}

      {notice && (
        <div className={`glass ${styles.notice}`} role="status">
          {notice}
        </div>
      )}

      {failed && (
        <div className={styles.failure} role="alert">
          <p className={styles.failureTitle}>Questo video non si riesce a riprodurre</p>
          <p className={styles.failureText}>{failed}</p>
        </div>
      )}

      {menuOpen && (
        <SettingsMenu
          speed={speed}
          onSpeed={setSpeed}
          tracks={subtitles}
          track={track}
          audio={audio}
          audioStream={sound?.stream ?? originalAudio(audio)?.stream ?? null}
          onAudio={chooseAudio}
          onTrack={chooseTrack}
          subtitleStyle={subtitleStyle}
          onSubtitleStyle={chooseStyle}
          repeat={repeat}
          onRepeat={setRepeat}
          onClose={() => setMenuOpen(false)}
        />
      )}

      <div className={styles.controls}>
        <Timeline
          time={time}
          duration={duration}
          buffered={buffered}
          onSeek={seekTo}
          preview={preview}
        />
        <div className={styles.bar}>
          <button
            type="button"
            className={styles.button}
            onClick={() => run({ kind: "toggle-play" })}
            aria-label={playing ? "Pausa (k)" : "Riproduci (k)"}
          >
            <Icon name={playing ? "pause" : "play"} size={26} />
          </button>
          <button
            type="button"
            className={styles.button}
            onClick={() => run({ kind: "seek-by", seconds: -skipSeconds })}
            aria-label="Indietro di 10 secondi (j)"
          >
            <Icon name="back10" size={26} />
          </button>
          <button
            type="button"
            className={styles.button}
            onClick={() => run({ kind: "seek-by", seconds: skipSeconds })}
            aria-label="Avanti di 10 secondi (l)"
          >
            <Icon name="forward10" size={26} />
          </button>
          <div className={styles.volume}>
            <button
              type="button"
              className={styles.button}
              onClick={() => run({ kind: "toggle-mute" })}
              aria-label={muted || silenced ? "Riattiva l'audio (m)" : "Disattiva l'audio (m)"}
            >
              <Icon name={muted || silenced || volume === 0 ? "muted" : "volume"} size={26} />
            </button>
            <input
              type="range"
              className={styles.volumeSlider}
              min={0}
              max={1}
              step={0.05}
              value={muted || silenced ? 0 : volume}
              aria-label="Volume"
              onChange={(event) => {
                const next = clampVolume(Number(event.target.value));
                setVolume(next);
                setMuted(next === 0);
                setSilenced(false);
              }}
            />
          </div>
          <button
            type="button"
            className={styles.time}
            onClick={() => {
              setTimeLeft(!timeLeft);
              saveSetting("timeLeft", !timeLeft);
            }}
            disabled={!Number.isFinite(duration)}
            aria-label={timeLeft ? "Mostra il tempo passato" : "Mostra quanto manca"}
            title={timeLeft ? "Mostra il tempo passato" : "Mostra quanto manca"}
          >
            {timeLeft && Number.isFinite(duration)
              ? `-${formatDuration(duration - time)}`
              : formatDuration(time)}
            {Number.isFinite(duration) && (
              <span className={styles.total}> / {formatDuration(duration)}</span>
            )}
          </button>
          <span className={styles.spacer} />
          <button
            type="button"
            className={styles.button}
            onClick={() => run({ kind: "toggle-subtitles" })}
            disabled={subtitles.length === 0}
            aria-pressed={track !== null}
            aria-label={
              subtitles.length === 0 ? "Nessun sottotitolo per questo video" : "Sottotitoli (c)"
            }
            title={subtitles.length === 0 ? "Nessun sottotitolo per questo video" : undefined}
          >
            <Icon name="subtitles" size={26} />
          </button>

          <button
            type="button"
            className={styles.button}
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="Impostazioni"
            aria-expanded={menuOpen}
          >
            <Icon name="settings" size={24} />
          </button>

          <button
            type="button"
            className={styles.button}
            onClick={toggleFullscreen}
            aria-label={fullscreen ? "Esci da schermo intero (f)" : "Schermo intero (f)"}
          >
            <Icon name={fullscreen ? "exitFullscreen" : "fullscreen"} size={24} />
          </button>
        </div>
      </div>
    </div>
  );
}

// failureText explains why a video stopped, from the browser's error code
// (MediaError.code). hint, when given, is what the page already knows about
// a format not every browser plays.
export function failureText(code: number | undefined, hint?: string): string {
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
