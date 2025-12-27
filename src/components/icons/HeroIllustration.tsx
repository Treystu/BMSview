import React from 'react';

const HeroIllustration: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    viewBox="0 0 500 350"
    className={className}
    xmlns="http://www.w3.org/2000/svg"
    aria-label="BMS Dashboard Illustration"
    role="img"
  >
    <defs>
      <linearGradient id="heroBgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#F5F5F5" />
        <stop offset="100%" stopColor="#E0E0E0" />
      </linearGradient>
       <linearGradient id="gaugeGradient" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#1565C0" />
        <stop offset="100%" stopColor="#0D47A1" />
      </linearGradient>
       <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur in="SourceAlpha" stdDeviation="8" result="blur" />
        <feOffset in="blur" dx="4" dy="4" result="offsetBlur" />
        <feMerge>
          <feMergeNode in="offsetBlur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>

    {/* Main Panel */}
    <rect
      x="10"
      y="10"
      width="480"
      height="330"
      rx="20"
      fill="white"
      filter="url(#shadow)"
    />

    {/* Header */}
    <rect x="10" y="10" width="480" height="50" rx="20" ry="20" fill="#0D47A1" />
    <text x="35" y="42" fontFamily="system-ui, sans-serif" fontSize="20" fill="white" fontWeight="bold">
      System Health: Optimal
    </text>

    {/* Main SOC Gauge */}
    <g transform="translate(130, 180)">
      <circle cx="0" cy="0" r="80" fill="#F5F5F5" />
      <path
        d="M -71.4 -35.7 A 80 80 0 1 1 -71.4 35.7" // 75% arc
        stroke="url(#gaugeGradient)"
        strokeWidth="20"
        fill="none"
        strokeLinecap="round"
      />
      <text x="0" y="-10" fontFamily="system-ui, sans-serif" fontSize="40" fill="#0D47A1" textAnchor="middle" fontWeight="bold">
        75%
      </text>
      <text x="0" y="25" fontFamily="system-ui, sans-serif" fontSize="16" fill="#424242" textAnchor="middle">
        State of Charge
      </text>
    </g>

    {/* Side Metrics */}
    <g transform="translate(300, 100)">
      <text x="0" y="0" fontFamily="system-ui, sans-serif" fontSize="16" fill="#424242">Voltage:</text>
      <text x="140" y="0" fontFamily="system-ui, sans-serif" fontSize="18" fill="#212121" fontWeight="bold" textAnchor="end">52.1 V</text>
      
      <text x="0" y="40" fontFamily="system-ui, sans-serif" fontSize="16" fill="#424242">Current:</text>
      <text x="140" y="40" fontFamily="system-ui, sans-serif" fontSize="18" fill="#212121" fontWeight="bold" textAnchor="end">-15.3 A</text>

      <text x="0" y="80" fontFamily="system-ui, sans-serif" fontSize="16" fill="#424242">Temp:</text>
      <text x="140" y="80" fontFamily="system-ui, sans-serif" fontSize="18" fill="#212121" fontWeight="bold" textAnchor="end">28 °C</text>
    </g>

    {/* Cell Voltages Chart */}
    <g transform="translate(35, 280)">
       <text x="0" y="0" fontFamily="system-ui, sans-serif" fontSize="14" fill="#424242">Cell Balance</text>
       <polyline
          points="20,50 60,45 100,48 140,50 180,46 220,51 260,47"
          fill="none"
          stroke="#1565C0"
          strokeWidth="3"
        />
    </g>
  </svg>
);

export default HeroIllustration;
