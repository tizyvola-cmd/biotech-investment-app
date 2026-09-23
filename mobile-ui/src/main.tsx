import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { MobileLangProvider } from "./hooks/useMobileLang";
import { registerMobileServiceWorker } from "./mobilePushClient";
import "./theme.css";
import "./index.css";

void registerMobileServiceWorker();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MobileLangProvider>
      <App />
    </MobileLangProvider>
  </StrictMode>,
);
