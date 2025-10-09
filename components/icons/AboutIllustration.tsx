import React from 'react';

const AboutIllustration: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 400 300"
    className={className}
    xmlns="http://www.w3.org/2000/svg"
    aria-label="Illustration about teamwork and technology"
    role="img"
  >
    <defs>
      <linearGradient id="aboutGradient1" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#1565C0" />
        <stop offset="100%" stopColor="#0D47A1" />
      </linearGradient>
      <linearGradient id="aboutGradient2" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#FFC107" />
        <stop offset="100%" stopColor="#FFA000" />
      </linearGradient>
      <filter id="shadowAbout" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="4" result="blur" />
        <feOffset in="blur" dx="4" dy="4" result="offsetBlur" />
        <feMerge>
          <feMergeNode in="offsetBlur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
    
    <g filter="url(#shadowAbout)">
      {/* Central Node */}
      <circle cx="200" cy="150" r="40" fill="url(#aboutGradient1)" />
      <circle cx="200" cy="150" r="15" fill="white" />
      
      {/* Orbiting Electrons / Nodes */}
      <ellipse cx="200" cy="150" rx="120" ry="50" fill="none" stroke="#E0E0E0" strokeWidth="2" />
      <ellipse cx="200" cy="150" rx="80" ry="100" transform="rotate(60 200 150)" fill="none" stroke="#E0E0E0" strokeWidth="2" />

      {/* Team/Connection Points */}
      <circle cx="95" cy="130" r="20" fill="url(#aboutGradient2)" />
      <circle cx="305" cy="170" r="20" fill="url(#aboutGradient2)" />
      <circle cx="200" cy="250" r="20" fill="url(#aboutGradient2)" />
      <circle cx="150" cy="40" r="20" fill="url(#aboutGradient2)" />
      <circle cx="280" cy="70" r="20" fill="url(#aboutGradient2)" />
      
      {/* Connecting Lines */}
      <path d="M115 130 Q 150 140 160 150" stroke="#BDBDBD" strokeWidth="2" fill="none" />
      <path d="M285 170 Q 240 160 240 150" stroke="#BDBDBD" strokeWidth="2" fill="none" />
      <path d="M200 230 Q 200 190 200 190" stroke="#BDBDBD" strokeWidth="2" fill="none" />
      <path d="M165 55 Q 180 90 190 110" stroke="#BDBDBD" strokeWidth="2" fill="none" />
      <path d="M265 85 Q 230 110 220 130" stroke="#BDBDBD" strokeWidth="2" fill="none" />
    </g>
  </svg>
);

export default AboutIllustration;
