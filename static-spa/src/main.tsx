import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

// Self-hosted typefaces — bundled by Vite, no external font request.
// Sans is the variable weight axis (one file covers 100–700); mono is pinned
// to the two latin weights we actually use. Non-latin subsets are gated behind
// unicode-range, so browsers never fetch them for this UI.
import "@fontsource-variable/ibm-plex-sans/wght.css";
import "@fontsource/ibm-plex-mono/latin-400.css";
import "@fontsource/ibm-plex-mono/latin-500.css";

import App from "./App";
import { ThemeProvider } from "./lib/theme";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <BrowserRouter basename="/ui">
        <App />
      </BrowserRouter>
    </ThemeProvider>
  </React.StrictMode>
);
