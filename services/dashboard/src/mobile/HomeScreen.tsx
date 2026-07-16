interface HomeScreenProps {
  onStart: () => void;
  unsupported: boolean;
}

export function HomeScreen({ onStart, unsupported }: HomeScreenProps) {
  return (
    <div className="mobile-home">
      <div className="mobile-home-content">
        <div className="mobile-logo" aria-hidden="true">
          ▲
        </div>
        <h1 className="mobile-home-title">AEGIS</h1>
        <p className="mobile-home-subtitle">
          Emergency voice assistant. Speak naturally — AEGIS will ask what it needs and send help.
        </p>
      </div>

      <div className="mobile-home-actions">
        {unsupported && (
          <p className="mobile-home-warning">
            This browser doesn't support voice recognition. Please open this page in Chrome.
          </p>
        )}
        <button className="mobile-start-btn" onClick={onStart} disabled={unsupported}>
          Start Emergency Call
        </button>
        <p className="mobile-home-footnote">Your microphone will be used. Location is shared to help responders find you.</p>
      </div>
    </div>
  );
}
