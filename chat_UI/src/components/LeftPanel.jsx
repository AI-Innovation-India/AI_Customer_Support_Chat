import React from 'react';
import './LeftPanel.css';

const LeftPanel = () => {
  return (
    <div className="left-panel-container">
      <div className="mascot-wrapper">
        <img src="/mascot.png" alt="Echo Mind Mascot" className="mascot-image" />
      </div>

      <div className="welcome-section">
        <h1 className="welcome-title neon-text-primary">Meet the Echo Mind</h1>
        <p className="welcome-desc text-secondary">Ask your questions using voice or text.</p>
      </div>

      <div className="quick-actions">
        <button className="glass-button">Track Order</button>
        <button className="glass-button">Refund Status</button>
        <button className="glass-button">Cancel Request</button>
        <button className="glass-button">Talk to Support</button>
      </div>
    </div>
  );
};

export default LeftPanel;
