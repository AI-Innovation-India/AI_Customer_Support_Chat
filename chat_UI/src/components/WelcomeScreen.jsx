import React, { useEffect } from 'react';
import './WelcomeScreen.css';
import { ChevronRight } from 'lucide-react';
import { playStartChime } from '../utils/audio';

const WelcomeScreen = ({ onStart }) => {

  // We must move speech to a click handler because Chrome/Safari completely block audio from playing 
  // without the user clicking somewhere first! 
  const handleRobotClick = () => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel(); 
      
      // Use "Yaazhi" but we look for an Indian-English voice which naturally understands 
      // the 'zh' transliteration in Indian names perfectly.
      const msg = new SpeechSynthesisUtterance("Meet Yaazhi, your A. I. assistant.");
      
      const voices = window.speechSynthesis.getVoices();
      const indianVoice = voices.find(v => v.lang === 'en-IN' || v.lang === 'ta-IN');
      
      if (indianVoice) {
        msg.voice = indianVoice;
      } else {
        // Ultimate phonetic fallback if standard US/UK engines are forced
        msg.text = "Meet Yaa lee, your A. I. assistant."; 
      }
      
      msg.rate = 1.0; 
      msg.pitch = 1.2; 
      window.speechSynthesis.speak(msg);
    }
  };

  const handleStart = () => {
    playStartChime();
    setTimeout(() => {
      onStart();
    }, 200);
  };

  return (
    <div className="welcome-screen-container">
      
      <div className="welcome-text-section">
        <h1 className="main-title">
           <span className="title-prefix animate-text-1">Meet <span className="yazhi-name">Yazhi</span>,</span><br/>
           <span className="title-highlight animate-text-2">Your AI Assistant</span>
        </h1>
      </div>

      <div className="robot-presentation animate-robot" onClick={handleRobotClick} style={{ cursor: 'pointer' }}>
         <div className="speech-bubble">
            <p>Need our help<br/>now?</p>
            <div className="thought-dot dot-1"></div>
            <div className="thought-dot dot-2"></div>
            <div className="thought-dot dot-3"></div>
         </div>
         <img src="/robot_yazhi.png" alt="Yazhi AI Assistant" className="robot-image" />
      </div>

      <button className="get-started-btn animate-button" onClick={handleStart}>
         <div className="btn-icon-circle">
            <ChevronRight size={20} color="#FFF" />
         </div>
         <span className="btn-text">Get Started</span>
         <div className="btn-arrows">
            <span>›</span><span>›</span><span>›</span>
         </div>
      </button>
      
    </div>
  );
};

export default WelcomeScreen;
