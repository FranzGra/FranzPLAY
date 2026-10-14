import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useSite } from "../app/site";
// SiteName is the logo's text: the name of the site in two parts, the
// second in the site's color.
export function SiteName({ accentClass }) {
    const { look } = useSite();
    return (_jsxs("span", { children: [look.nameFirst, look.nameSecond && _jsx("span", { className: accentClass, children: look.nameSecond })] }));
}
