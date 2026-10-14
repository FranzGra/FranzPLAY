// What the administrator's list says about the file of a video: how sharp
// it is and whether every browser plays it. Pure functions.
// qualityLabel names the sharpness of a video from its height in pixels,
// as people say it: "4K", "1080p"… "" when the video was not read yet.
export function qualityLabel(height) {
    if (height === null || height <= 0)
        return "";
    if (height >= 2160)
        return "4K";
    if (height >= 1440)
        return "2K";
    if (height >= 1080)
        return "1080p";
    if (height >= 720)
        return "720p";
    if (height >= 480)
        return "480p";
    return "SD";
}
// compatibility says whether every browser plays the video: as it is,
// thanks to a copy FranzPLAY made, or not yet. null when not read yet.
export function compatibility(video) {
    if (video.duration === null)
        return null;
    if (video.hasCopy)
        return { label: "Copia per tutti i browser", ok: true };
    if (video.playable)
        return { label: "Va su tutti i browser", ok: true };
    return { label: "Non va su tutti i browser", ok: false };
}
