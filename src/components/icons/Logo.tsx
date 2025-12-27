import React from 'react';

const Logo: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 120 120"
    className={className}
    xmlns="http://www.w3.org/2000/svg"
    aria-label="BMS Validator Logo"
    role="img"
  >
    <defs>
      <linearGradient id="logoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style={{ stopColor: '#1565C0', stopOpacity: 1 }} />
        <stop offset="100%" style={{ stopColor: '#0D47A1', stopOpacity: 1 }} />
      </linearGradient>
    </defs>
    <g transform="translate(10, 10)">
      {/* Shield */}
      <path
        d="M50 0 L100 20 L100 60 C100 90 75 100 50 100 C25 100 0 90 0 60 L0 20 Z"
        fill="url(#logoGradient)"
        stroke="#FFFFFF"
        strokeWidth="4"
      />
      {/* Battery Icon */}
      <g transform="translate(30, 25)" fill="none" stroke="white" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
        {/* Battery body */}
        <rect x="0" y="5" width="40" height="25" rx="4" />
        {/* Battery terminal */}
        <path d="M40 12 L45 12 L45 23 L40 23" />
        {/* Checkmark */}
        <path d="M10 20 l8 8 l12 -16" strokeWidth="7" />
      </g>
    </g>
  </svg>
);

export default Logo;
