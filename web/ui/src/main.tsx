import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { queryClient } from "./api";
import { App } from "./App";
import "./index.css";
import { applyTextSize, getTextSize } from "./lib/textSize";
import { UIProvider } from "./store";

applyTextSize(getTextSize());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <UIProvider>
        <App />
      </UIProvider>
    </QueryClientProvider>
  </StrictMode>,
);
