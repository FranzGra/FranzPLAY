// The administrator's view of the categories: each as the videos have it,
// with the name people see, its color and its image.
import { request } from "./client";
// The longest name the server accepts.
export const maxLabel = 100;
export function parseAdminCategories(data) {
    if (!Array.isArray(data)) {
        throw new Error("admin categories: not a list");
    }
    return data.map((item) => {
        if (typeof item !== "object" || item === null) {
            throw new Error("admin category: not an object");
        }
        const c = item;
        if (typeof c.name !== "string" || c.name === "" || typeof c.label !== "string") {
            throw new Error("admin category: bad name");
        }
        if (typeof c.color !== "string" || (c.color !== "" && !/^#[0-9a-f]{6}$/.test(c.color))) {
            throw new Error("admin category: bad color");
        }
        if (c.image !== null &&
            (typeof c.image !== "string" || !c.image.startsWith("/api/category-images/"))) {
            throw new Error("admin category: bad image");
        }
        if (typeof c.videos !== "number" || !Number.isSafeInteger(c.videos) || c.videos < 0) {
            throw new Error("admin category: bad videos");
        }
        return { name: c.name, label: c.label, color: c.color, image: c.image, videos: c.videos };
    });
}
const address = (name) => `/api/admin/categories/${encodeURIComponent(name)}`;
export async function fetchAdminCategories(signal) {
    return parseAdminCategories(await request("/api/admin/categories", { signal }));
}
// saveCategory gives a category the name people see ("" for its own) and
// a color ("" for none).
export async function saveCategory(name, label, color) {
    await request(address(name), { method: "PUT", body: { label, color } });
}
// uploadCategoryImage gives a category an image: a JPEG, already cut.
export async function uploadCategoryImage(name, image) {
    await request(`${address(name)}/image`, { method: "PUT", body: image });
}
export async function removeCategoryImage(name) {
    await request(`${address(name)}/image`, { method: "DELETE" });
}
