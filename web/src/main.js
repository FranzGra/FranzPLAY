import { jsx as _jsx } from "react/jsx-runtime";
import "@fontsource-variable/geist";
import "./styles/global.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./app/App";
const root = document.getElementById("root");
if (!root) {
    throw new Error("missing #root element in index.html");
}
createRoot(root).render(_jsx(StrictMode, { children: _jsx(BrowserRouter, { children: _jsx(App, {}) }) }));
