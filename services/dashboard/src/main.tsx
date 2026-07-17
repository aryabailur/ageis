import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { MobileApp } from "./mobile/MobileApp";
import "./theme.css";
import "./index.css";
import "./dashboard-enhancements.css";

import { ErrorBoundary } from "./components/ErrorBoundary";

// The mobile AI emergency voice assistant lives at /call, entirely
// separate from the dashboard's App tree -- a plain client-side path
// check is all two static views need, no router dependency required.
const isMobileCallRoute = window.location.pathname.startsWith("/call");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      {isMobileCallRoute ? <MobileApp /> : <App />}
    </ErrorBoundary>
  </React.StrictMode>,
);
