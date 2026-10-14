import { jsx as _jsx } from "react/jsx-runtime";
import { EmptyState } from "../components/EmptyState";
import { usePageTitle } from "../components/PageTitle";
// ComingSoonPage is a placeholder for pages that will be built in a later step.
export function ComingSoonPage({ title, text }) {
    usePageTitle(title);
    return (_jsx(EmptyState, { title: title, headingLevel: 1, children: text }));
}
