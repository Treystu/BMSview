import React from 'react';

const ThermometerIcon: React.FC<{ className?: string }> = ({ className }) => (
    <svg 
        xmlns="http://www.w3.org/2000/svg" 
        className={className}
        fill="none" 
        viewBox="0 0 24 24" 
        stroke="currentColor" 
        strokeWidth={2}
    >
        <path 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            d="M9 14.25l1.513-1.513a3 3 0 114.242 4.242L13.5 18.25M9 14.25v-5.25a3 3 0 013-3h.008a3 3 0 013 3v5.25" 
        />
        <path 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            d="M9 14.25h6" 
        />
    </svg>
);

export default ThermometerIcon;
