import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { parseVideo, type Video } from "../../api/videos";
import { videoJSON } from "../../test/fixtures";
import { hoverDelay, pressDelay } from "./useClipPreview";
import { VideoCard } from "./VideoCard";

const now = new Date("2026-10-12T08:00:00Z");

function video(overrides: Record<string, unknown> = {}): Video {
  return parseVideo(videoJSON({ clip: "/api/clips/7-0a1b2c3d.mp4", ...overrides }));
}

// show puts the cards on a page; opening a video shows "Pagina del video".
function show(...videos: Video[]) {
  render(
    <MemoryRouter>
      <Routes>
        <Route path="/" element={videos.map((v) => <VideoCard key={v.id} video={v} now={now} />)} />
        <Route path="/video/:id" element={<p>Pagina del video</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

// card finds the card of a video by its title.
function card(title = "Mare 2024") {
  return screen.getByRole("link", { name: new RegExp(title) });
}

function wait(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("clip on the video card", () => {
  it("plays while the mouse rests on the card", () => {
    show(video());
    fireEvent.pointerEnter(card(), { pointerType: "mouse" });
    expect(screen.queryByTestId("clip")).not.toBeInTheDocument();
    wait(hoverDelay);
    const clip = screen.getByTestId("clip");
    expect(clip).toHaveAttribute("src", "/api/clips/7-0a1b2c3d.mp4");
    expect((clip as HTMLVideoElement).muted).toBe(true);

    fireEvent.pointerLeave(card(), { pointerType: "mouse" });
    expect(screen.queryByTestId("clip")).not.toBeInTheDocument();
  });

  it("does not play when the mouse only passes over", () => {
    show(video());
    fireEvent.pointerEnter(card(), { pointerType: "mouse" });
    wait(hoverDelay - 100);
    fireEvent.pointerLeave(card(), { pointerType: "mouse" });
    wait(hoverDelay);
    expect(screen.queryByTestId("clip")).not.toBeInTheDocument();
  });

  it("plays one clip at a time", () => {
    show(video(), video({ id: 8, title: "Neve", clip: "/api/clips/8-0a.mp4" }));
    fireEvent.pointerEnter(card(), { pointerType: "mouse" });
    wait(hoverDelay);
    // A finger on another card: the first clip stops.
    fireEvent.pointerDown(card("Neve"), { pointerType: "touch", clientX: 0, clientY: 0 });
    wait(pressDelay);
    const clips = screen.getAllByTestId("clip");
    expect(clips).toHaveLength(1);
    expect(clips[0]).toHaveAttribute("src", "/api/clips/8-0a.mp4");
  });

  it("plays while a finger presses the card, and stays on the page", () => {
    show(video());
    fireEvent.pointerDown(card(), { pointerType: "touch", clientX: 10, clientY: 10 });
    wait(pressDelay);
    expect(screen.getByTestId("clip")).toBeInTheDocument();

    fireEvent.pointerUp(card(), { pointerType: "touch" });
    fireEvent.click(card());
    expect(screen.queryByText("Pagina del video")).not.toBeInTheDocument();
    expect(screen.getByTestId("clip")).toBeInTheDocument();

    // A tap after that opens the video, as always.
    fireEvent.pointerDown(card(), { pointerType: "touch", clientX: 10, clientY: 10 });
    fireEvent.pointerUp(card(), { pointerType: "touch" });
    fireEvent.click(card());
    expect(screen.getByText("Pagina del video")).toBeInTheDocument();
  });

  it("opens the video on a quick tap", () => {
    show(video());
    fireEvent.pointerDown(card(), { pointerType: "touch", clientX: 10, clientY: 10 });
    wait(pressDelay / 2);
    fireEvent.pointerUp(card(), { pointerType: "touch" });
    fireEvent.click(card());
    expect(screen.getByText("Pagina del video")).toBeInTheDocument();
  });

  it("does not play while the finger scrolls the page", () => {
    show(video());
    fireEvent.pointerDown(card(), { pointerType: "touch", clientX: 10, clientY: 10 });
    fireEvent.pointerMove(card(), { pointerType: "touch", clientX: 10, clientY: 60 });
    wait(pressDelay);
    expect(screen.queryByTestId("clip")).not.toBeInTheDocument();
  });

  it("plays the sharp clip on a good connection", () => {
    show(video({ clipHD: "/api/clips-hd/7-0a1b2c3d.mp4" }));
    fireEvent.pointerEnter(card(), { pointerType: "mouse" });
    wait(hoverDelay);
    expect(screen.getByTestId("clip")).toHaveAttribute("src", "/api/clips-hd/7-0a1b2c3d.mp4");
  });

  it("plays the light clip on a slow connection", () => {
    vi.stubGlobal("navigator", { ...navigator, connection: { effectiveType: "3g", downlink: 1 } });
    try {
      show(video({ clipHD: "/api/clips-hd/7-0a1b2c3d.mp4" }));
      fireEvent.pointerEnter(card(), { pointerType: "mouse" });
      wait(hoverDelay);
      expect(screen.getByTestId("clip")).toHaveAttribute("src", "/api/clips/7-0a1b2c3d.mp4");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does nothing for a video with no clip yet", () => {
    show(video({ clip: null }));
    fireEvent.pointerEnter(card(), { pointerType: "mouse" });
    wait(hoverDelay);
    expect(screen.queryByTestId("clip")).not.toBeInTheDocument();
  });
});

describe("likes on the video card", () => {
  it("shows how many people like the video", () => {
    show(video({ likes: 3 }), video({ id: 8, title: "Lago", likes: 1 }));
    expect(card()).toHaveTextContent(/3 persone a cui piace/);
    expect(card("Lago")).toHaveTextContent(/1 mi piace/);
  });

  it("says nothing when nobody likes it yet", () => {
    show(video({ likes: 0 }));
    expect(card()).not.toHaveTextContent(/piace/);
  });
});
