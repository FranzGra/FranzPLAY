import "@fontsource-variable/geist";
import "./styles/global.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./app/App";
import { installBackMorph } from "./features/videos/coverMorph";
import { weakDevice } from "./lib/richMotion";
import { installScrollMemory, scrollToSaved } from "./lib/scrollMemory";
import { installSingleClickLinks } from "./lib/singleClickLinks";

const root = document.getElementById("root");
if (!root) {
  throw new Error("missing #root element in index.html");
}

// Weak devices get lighter glass (styles/global.css).
if (weakDevice()) document.documentElement.dataset.weak = "";

installSingleClickLinks();

// Before the router: both listen to the back button first.
installScrollMemory();
installBackMorph(scrollToSaved);

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
