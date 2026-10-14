import { jsx as _jsx } from "react/jsx-runtime";
import styles from "./Avatar.module.css";
// Avatar is a person's round picture: their profile photo when they chose
// one (photo is its address), otherwise the first letter of their name.
// It looks the same on the profile, the channel, the comments and the top
// bar. Its size comes from size, or else from --avatar-size set by the page
// around it (so a page can change it on phones).
export function Avatar({ name, size, photo = "", }) {
    const style = size === undefined ? undefined : { "--avatar-size": `${size}px` };
    if (photo !== "") {
        return _jsx("img", { className: styles.photo, style: style, src: photo, alt: "" });
    }
    return (_jsx("span", { className: styles.root, style: style, "aria-hidden": "true", children: name.charAt(0).toUpperCase() }));
}
