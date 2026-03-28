import React from 'react';
import './Transcript.css';

const Transcript = ({ userSpeech, AIResponse }) => {
  return (
    <div className="transcript-container glass-panel">
      <div className="transcript-user">
        <span className="label">You</span>
        <p className="speech-text">{userSpeech}</p>
      </div>
      <div className="transcript-ai">
        <span className="label neon-text-primary">Yazhni</span>
        <p className="speech-text">{AIResponse}</p>
      </div>
    </div>
  );
};

export default Transcript;
