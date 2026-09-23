import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./context/ThemeContext";
import { ViewErrorBoundary } from "./components/ViewErrorBoundary";
import { applyPageZoom, readStoredPageZoom } from "./sheet/pageZoom";
import "./index.css";
import "./daily-news-digest.css";
import "./styles/themes.css";

applyPageZoom(readStoredPageZoom());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <ViewErrorBoundary label="SuperNova">
        <App />
      </ViewErrorBoundary>
    </ThemeProvider>
  </StrictMode>
);
