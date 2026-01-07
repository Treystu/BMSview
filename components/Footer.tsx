
import React from 'react';

const Footer: React.FC = () => {
  return (
    <footer className="bg-neutral-dark text-white py-6">
      <div className="container mx-auto px-6 text-center">
        <p>&copy; 2024 BMS Validator. All rights reserved.</p>
        <p className="text-sm text-gray-400 mt-1">
            Empowering battery owners with AI-driven insights.
        </p>
      </div>
    </footer>
  );
};

export default Footer;
