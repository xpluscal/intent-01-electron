import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { useElectronAuth } from "./hooks/useElectronAuth";
import "./index.css";
import App from "./App.tsx";
import { ErrorBoundary } from "./ErrorBoundary.tsx";

const convex = new ConvexReactClient(import.meta.env.VITE_CONVEX_URL as string);
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <ConvexProviderWithClerk client={convex} useAuth={useElectronAuth}>
        <App />
      </ConvexProviderWithClerk>
    </ErrorBoundary>
  </StrictMode>,
);
