import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { MobileLangProvider } from "./hooks/useMobileLang";
import "./theme.css";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MobileLangProvider>
      <App />
    </MobileLangProvider>
  </StrictMode>,
);
