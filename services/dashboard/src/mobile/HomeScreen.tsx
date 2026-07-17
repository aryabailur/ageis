import { useState } from "react";

interface HomeScreenProps {
  onStart: () => void;
  unsupported: boolean;
}

const TRUST_LINES = [
  "Connects you to an AI dispatcher instantly",
  "Guides you through pre-arrival care if needed",
  "Sends your location to the responder automatically",
];

function UnsupportedFallback() {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText("tel:911");
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard access can fail (permissions, insecure context) -- the
      // number is still visible on-screen either way, so this is a
      // nice-to-have, not the only way to get it.
    }
  }

  return (
    <div className="mobile-unsupported">
      <div className="mobile-unsupported-icon" aria-hidden="true">
        ⚠
      </div>
      <h1 className="mobile-unsupported-title">Voice not supported</h1>
      <p className="mobile-unsupported-body">Please open this page in Chrome on Android or iOS Safari 17+.</p>
      <button className="mobile-unsupported-copy-btn" onClick={handleCopy}>
        {copied ? "Copied!" : "Copy emergency number"}
      </button>
    </div>
  );
}

export function HomeScreen({ onStart, unsupported }: HomeScreenProps) {
  const [privacyOpen, setPrivacyOpen] = useState(false);

  if (unsupported) {
    return <UnsupportedFallback />;
  }

  return (
    <div className="mobile-home">
      <div className="mobile-home-content">
        <div className="mobile-logo-wrap" aria-hidden="true">
          <div className="mobile-logo-pulse-ring" />
          <div className="mobile-logo">
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M6.62 10.79a15.05 15.05 0 0 0 6.59 6.59l2.2-2.2a1 1 0 0 1 1.01-.24c1.12.37 2.33.57 3.58.57a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1C10.61 21 3 13.39 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.46.57 3.58a1 1 0 0 1-.25 1.01l-2.2 2.2Z"
                fill="currentColor"
              />
            </svg>
          </div>
        </div>
        <h1 className="mobile-home-title">AEGIS</h1>
        <p className="mobile-home-subtitle">
          Emergency voice assistant. Speak naturally — AEGIS will ask what it needs and send help.
        </p>
        <ul className="mobile-home-trust-list">
          {TRUST_LINES.map((line) => (
            <li key={line} className="mobile-home-trust-item">
              <span className="mobile-home-trust-check" aria-hidden="true">
                ✓
              </span>
              {line}
            </li>
          ))}
        </ul>
      </div>

      <div className="mobile-home-actions">
        <button className="mobile-start-btn" onClick={onStart}>
          <span className="mobile-start-btn-icon" aria-hidden="true">
            📞
          </span>
          Start Emergency Call
        </button>
        <p className="mobile-home-availability">Available 24/7 · AI-assisted dispatch</p>

        <div className="mobile-privacy-toggle">
          <button
            className="mobile-privacy-toggle-btn"
            onClick={() => setPrivacyOpen((v) => !v)}
            aria-expanded={privacyOpen}
          >
            ⓘ Privacy
          </button>
          {privacyOpen && (
            <p className="mobile-privacy-toggle-body">
              Your microphone will be used. Location is shared to help responders find you.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
