import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { registerSW } from "virtual:pwa-register";
import "./styles/app.css";
import { App } from "./App";
import { UpdateNotice } from "./components/UpdateNotice";
import { watchForNewVersion } from "./lib/appUpdate";

const updates = watchForNewVersion({ serviceWorker: navigator.serviceWorker, registerSW, document, window });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <UpdateNotice notice={updates} />
  </StrictMode>,
);
