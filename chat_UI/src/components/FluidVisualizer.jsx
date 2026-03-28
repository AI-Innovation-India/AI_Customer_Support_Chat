import React, { useEffect, useRef, useState } from 'react';
import './FluidVisualizer.css';

const FluidVisualizer = ({ isActive }) => {
  const containerRef = useRef(null);
  const blob1Ref = useRef(null);
  const blob2Ref = useRef(null);
  const blob3Ref = useRef(null);
  
  const [error, setError] = useState('');

  useEffect(() => {
    let audioContext;
    let analyser;
    let dataArray;
    let source;
    let animationId;
    let activeStream;

    const startAudio = async () => {
      try {
        // Request realistic tracking microphone permissions
        activeStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        source = audioContext.createMediaStreamSource(activeStream);
        source.connect(analyser);

        const bufferLength = analyser.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength);

        const renderFrame = () => {
          if (!analyser) return;
          analyser.getByteFrequencyData(dataArray);

          // Calculate average volume (0 to 255 limit)
          let sum = 0;
          for (let i = 0; i < bufferLength; i++) {
            sum += dataArray[i];
          }
          const average = sum / bufferLength;

          // Highly sensitive equalizer mapping:
          // Normal human speech hits average frequencies of 15-40 out of 255.
          // By dividing by 50, we ensure even a quiet talking voice hits 0.5 to 1.0 multiplier!
          const normalizedAvg = Math.min(1, average / 40); 
          
          // Audio scale pops much harder now: from 1.0 (quiet) to 1.8 (loud)
          const audioScale = 1 + (normalizedAvg * 0.8); 
          
          if (containerRef.current) {
             containerRef.current.style.transform = `scale(${audioScale})`;
             // Dynamic color explosion: The entire blob shifts colors globally based on how loud you speak
             containerRef.current.style.filter = `drop-shadow(0 0 ${40 + average*2}px rgba(94, 220, 255, ${0.4 + normalizedAvg})) hue-rotate(${average * 4}deg)`;
          }

          // Give individual layers aggressive erratic 3D bouncing off-axis
          if (blob1Ref.current) blob1Ref.current.style.transform = `scale(${1 + normalizedAvg * 0.3}) translateY(${normalizedAvg * -20}px)`;
          if (blob2Ref.current) blob2Ref.current.style.transform = `scale(${1 + normalizedAvg * 0.5}) translateX(${normalizedAvg * 20}px)`;
          if (blob3Ref.current) blob3Ref.current.style.transform = `scale(${1 + normalizedAvg * 0.7})`;

          animationId = requestAnimationFrame(renderFrame);
        };

        renderFrame();
      } catch (err) {
        console.error("Mic access denied or error:", err);
        setError("Microphone access is required for real-time visualizer.");
      }
    };

    if (isActive) {
      startAudio();
    }

    return () => {
      if (animationId) cancelAnimationFrame(animationId);
      if (audioContext && audioContext.state !== 'closed') audioContext.close();
      if (activeStream) {
        activeStream.getTracks().forEach(track => track.stop());
      }
    };
  }, [isActive]);

  return (
    <div className="fluid-visualizer-wrapper">
      {error && <p className="visualizer-error">{error}</p>}
      <div className={`fluid-container ${isActive ? 'active' : ''}`} ref={containerRef}>
        <div className="fluid-blob blob-1" ref={blob1Ref}></div>
        <div className="fluid-blob blob-2" ref={blob2Ref}></div>
        <div className="fluid-blob blob-3" ref={blob3Ref}></div>
        <div className="fluid-core"></div>
      </div>
    </div>
  );
};

export default FluidVisualizer;
