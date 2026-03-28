// Utility for generating premium UI sounds using the Web Audio API without needing external files.

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

export const playSciFiChime = () => {
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  const oscillator = audioCtx.createOscillator();
  const gainNode = audioCtx.createGain();
  
  // A clean, futuristic sine wave
  oscillator.type = 'sine';
  
  // Start at a high pitch and quickly slide down (sci-fi bloop)
  oscillator.frequency.setValueAtTime(800, audioCtx.currentTime);
  oscillator.frequency.exponentialRampToValueAtTime(300, audioCtx.currentTime + 0.1);
  oscillator.frequency.linearRampToValueAtTime(0, audioCtx.currentTime + 0.3);
  
  // Envelope (fade out quickly)
  gainNode.gain.setValueAtTime(0, audioCtx.currentTime);
  gainNode.gain.linearRampToValueAtTime(0.3, audioCtx.currentTime + 0.02);
  gainNode.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);

  oscillator.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  
  oscillator.start(audioCtx.currentTime);
  oscillator.stop(audioCtx.currentTime + 0.3);
};

export const playStartChime = () => {
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }

  // A major chord chime for "Get Started" / Transition
  const frequencies = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
  
  frequencies.forEach((freq, index) => {
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    
    oscillator.type = 'sine';
    oscillator.frequency.value = freq;
    
    // Stagger the notes slightly for a sweeping harp/chime effect
    const startTime = audioCtx.currentTime + (index * 0.05);
    
    gainNode.gain.setValueAtTime(0, startTime);
    gainNode.gain.linearRampToValueAtTime(0.15, startTime + 0.05);
    gainNode.gain.exponentialRampToValueAtTime(0.001, startTime + 1.2);
    
    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    
    oscillator.start(startTime);
    oscillator.stop(startTime + 1.2);
  });
};
