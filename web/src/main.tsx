import "@fontsource-variable/geist";
import "./styles/global.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { App } from "./app/App";
import { installBackMorph } from "./features/videos/coverMorph";
import { installScrollMemory, scrollToSaved } from "./lib/scrollMemory";

const root = document.getElementById("root");
if (!root) {
  throw new Error("missing #root element in index.html");
}

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
