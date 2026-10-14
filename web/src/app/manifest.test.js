import indexHtml from "../../index.html?raw";
import manifestText from "../../public/manifest.json?raw";
// The files in public/ the build copies as they are, by their address.
const publicFiles = Object.keys(import.meta.glob("/public/**/*")).map((name) => name.replace(/^\/public/, ""));
// The manifest lets a phone add FranzPLAY to the home screen with its own
// name and icon, and open it without the browser bars.
describe("web app manifest", () => {
    const manifest = JSON.parse(manifestText);
    it("is linked from index.html", () => {
        expect(indexHtml).toContain('<link rel="manifest" href="/manifest.json" />');
    });
    it("opens the home page as an app", () => {
        expect(manifest.name).toBe("FranzPLAY");
        expect(manifest.start_url).toBe("/");
        expect(manifest.display).toBe("standalone");
    });
    it("has the icon sizes Android needs, including a maskable one", () => {
        const sizes = manifest.icons.map((icon) => icon.sizes);
        expect(sizes).toContain("192x192");
        expect(sizes).toContain("512x512");
        expect(manifest.icons.some((icon) => icon.purpose === "maskable")).toBe(true);
    });
    it("points only to files that exist", () => {
        for (const icon of manifest.icons) {
            expect(publicFiles).toContain(icon.src);
        }
        const appleIcon = indexHtml.match(/rel="apple-touch-icon" href="([^"]+)"/)?.[1];
        expect(publicFiles).toContain(appleIcon);
    });
});
