// Data as the server sends it, for tests.
export function videoJSON(overrides = {}) {
    return {
        id: 7,
        title: "Mare 2024",
        category: "Vacanze",
        duration: 245,
        width: 1920,
        height: 1080,
        cover: "/api/covers/7-0a1b2c3d.jpg",
        addedAt: "2026-10-10T08:00:00Z",
        playable: true,
        fileType: 'video/mp4; codecs="avc1.640028, mp4a.40.2"',
        copy: false,
        preview: null,
        clip: null,
        clipHD: null,
        format: "MP4",
        likes: 0,
        private: false,
        uploader: null,
        author: "",
        publishedOn: null,
        ...overrides,
    };
}
export function watchedJSON(overrides = {}) {
    return {
        video: videoJSON(),
        position: 60,
        finished: false,
        watchedAt: "2026-10-11T20:30:00Z",
        ...overrides,
    };
}
