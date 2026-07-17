import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// API + WebSocket proxy: when VITE_ORCHESTRATOR_URL is set to "" (empty),
// the frontend calls these paths relative to its own origin and Vite
// forwards them to the orchestrator. This lets a single HTTPS tunnel
// (ngrok -> 5180) serve BOTH the app and the API to a phone -- getUserMedia
// and SpeechRecognition require a secure context, so a phone can't use
// plain http://<lan-ip>:5180 directly.
const ORCHESTRATOR = "http://localhost:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    // Vite blocks unknown Host headers by default (DNS-rebinding
    // protection) -- allow the ngrok domain so the tunnel works.
    allowedHosts: [".ngrok-free.dev", ".ngrok-free.app", ".ngrok.io"],
    proxy: {
      "/voice": { target: ORCHESTRATOR, ws: true, changeOrigin: true, secure: false },
      "/dispatch": { target: ORCHESTRATOR, changeOrigin: true, secure: false },
      "/admin": { target: ORCHESTRATOR, changeOrigin: true, secure: false },
      "/baseline": { target: ORCHESTRATOR, changeOrigin: true, secure: false },
    },
  },
});
