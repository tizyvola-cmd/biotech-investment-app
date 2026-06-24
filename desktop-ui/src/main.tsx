import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./context/ThemeContext";
import { ViewErrorBoundary } from "./components/ViewErrorBoundary";
import "./index.css";
import "./styles/themes.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ThemeProvider>
      <ViewErrorBoundary label="SuperNova">
        <App />
      </ViewErrorBoundary>
    </ThemeProvider>
  </StrictMode>
);
