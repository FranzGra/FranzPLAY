import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { parseVideo } from "../../api/videos";
import { videoJSON } from "../../test/fixtures";
import { hoverDelay, middleCard, settleDelay } from "./useClipPreview";
import { VideoCard } from "./VideoCard";
const now = new Date("2026-10-12T08:00:00Z");
function video(overrides = {}) {
    return parseVideo(videoJSON({ clip: "/api/clips/7-0a1b2c3d.mp4", ...overrides }));
}
// show puts the cards on a page; opening a video shows "Pagina del video".
function show(...videos) {
    render(_jsx(MemoryRouter, { children: _jsxs(Routes, { children: [_jsx(Route, { path: "/", element: videos.map((v) => _jsx(VideoCard, { video: v, now: now }, v.id)) }), _jsx(Route, { path: "/video/:id", element: _jsx("p", { children: "Pagina del video" }) })] }) }));
}
// card finds the card of a video by its title.
function card(title = "Mare 2024") {
    return screen.getByRole("link", { name: new RegExp(title) });
}
function wait(ms) {
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
        expect(clip.muted).toBe(true);
        fireEvent.pointerLeave(card(), { pointerType: "mouse" });
        expect(screen.queryByTestId("clip")).not.toBeInTheDocument();
    });
    it("waits a full second of the mouse resting before playing", () => {
        show(video());
        fireEvent.pointerEnter(card(), { pointerType: "mouse" });
        wait(999);
        expect(screen.queryByTestId("clip")).not.toBeInTheDocument();
        wait(1);
        expect(screen.getByTestId("clip")).toBeInTheDocument();
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
        fireEvent.pointerEnter(card("Neve"), { pointerType: "mouse" });
        wait(hoverDelay);
        const clips = screen.getAllByTestId("clip");
        expect(clips).toHaveLength(1);
        expect(clips[0]).toHaveAttribute("src", "/api/clips/8-0a.mp4");
    });
    it("does not play under a finger: a finger on a card is scrolling", () => {
        show(video());
        fireEvent.pointerEnter(card(), { pointerType: "touch" });
        fireEvent.pointerDown(card(), { pointerType: "touch", clientX: 10, clientY: 10 });
        wait(hoverDelay);
        expect(screen.queryByTestId("clip")).not.toBeInTheDocument();
    });
});
describe("clip on a touch screen", () => {
    // A phone 400 wide and 800 tall; each card's cover is where boxes says,
    // by title.
    function phone(boxes) {
        vi.stubGlobal("matchMedia", (query) => ({ matches: query === "(hover: none)" }));
        vi.stubGlobal("innerWidth", 400);
        vi.stubGlobal("innerHeight", 800);
        vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function () {
            const title = this.closest("a")?.querySelector("h3")?.textContent ?? "";
            const at = boxes[title] ?? {
                top: -1000,
            };
            return { left: at.left ?? 16, top: at.top, width: 368, height: 207 };
        });
        return boxes;
    }
    const two = () => [video(), video({ id: 8, title: "Neve", clip: "/api/clips/8-0a.mp4" })];
    it("plays the card in the middle of the screen once the page is still", () => {
        phone({ "Mare 2024": { top: 20 }, Neve: { top: 300 } });
        show(...two());
        wait(settleDelay - 1);
        expect(screen.queryByTestId("clip")).not.toBeInTheDocument();
        wait(1);
        const clips = screen.getAllByTestId("clip");
        expect(clips).toHaveLength(1);
        expect(clips[0]).toHaveAttribute("src", "/api/clips/8-0a.mp4");
    });
    it("waits while the page scrolls, then moves to the new middle card", () => {
        const boxes = phone({ "Mare 2024": { top: 20 }, Neve: { top: 300 } });
        show(...two());
        wait(settleDelay);
        // The finger scrolls back up: Mare comes to the middle.
        boxes["Mare 2024"].top = 300;
        boxes.Neve.top = 580;
        for (let i = 0; i < 5; i++) {
            fireEvent.scroll(document);
            wait(settleDelay / 2);
        }
        expect(screen.getByTestId("clip")).toHaveAttribute("src", "/api/clips/8-0a.mp4");
        wait(settleDelay);
        const clips = screen.getAllByTestId("clip");
        expect(clips).toHaveLength(1);
        expect(clips[0]).toHaveAttribute("src", "/api/clips/7-0a1b2c3d.mp4");
    });
    it("counts a row of cards sliding sideways too", () => {
        const boxes = phone({ "Mare 2024": { top: 300, left: 16 }, Neve: { top: 300, left: 400 } });
        show(...two());
        wait(settleDelay);
        expect(screen.getByTestId("clip")).toHaveAttribute("src", "/api/clips/7-0a1b2c3d.mp4");
        boxes["Mare 2024"].left = -370;
        boxes.Neve.left = 16;
        fireEvent.scroll(card());
        wait(settleDelay);
        expect(screen.getByTestId("clip")).toHaveAttribute("src", "/api/clips/8-0a.mp4");
    });
    it("stops when no card is in view enough", () => {
        const boxes = phone({ "Mare 2024": { top: 300 } });
        show(video());
        wait(settleDelay);
        expect(screen.getByTestId("clip")).toBeInTheDocument();
        boxes["Mare 2024"].top = 700; // mostly below the screen
        fireEvent.scroll(document);
        wait(settleDelay);
        expect(screen.queryByTestId("clip")).not.toBeInTheDocument();
    });
    it("leaves the small cards beside the player still", () => {
        phone({ "Mare 2024": { top: 300 } });
        render(_jsx(MemoryRouter, { children: _jsx(VideoCard, { video: video(), now: now, layout: "row" }) }));
        wait(settleDelay);
        expect(screen.queryByTestId("clip")).not.toBeInTheDocument();
    });
    it("opens the video on a tap, as always", () => {
        phone({ "Mare 2024": { top: 300 } });
        show(video());
        wait(settleDelay);
        fireEvent.click(card());
        expect(screen.getByText("Pagina del video")).toBeInTheDocument();
    });
});
describe("the middle card", () => {
    const screenSize = { width: 400, height: 800 };
    const box = (top, left = 16) => ({ top, left, width: 368, height: 207 });
    it.each([
        ["the one nearest the middle", [box(0), box(300), box(600)], 1],
        ["one well in view over one cut in half", [box(-100), box(600)], 1],
        ["none when all are mostly out of view", [box(-150), box(700)], null],
        ["not a folded-away card", [{ top: 300, left: 16, width: 0, height: 0 }, box(10)], 1],
        ["none from no cards", [], null],
    ])("is %s", (_, covers, want) => {
        expect(middleCard(covers, screenSize)).toBe(want);
    });
});
describe("which clip plays", () => {
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
        }
        finally {
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
