

import React from 'react';
import Logo from './icons/Logo';

const Header: React.FC = () => {
  return (
    <header className="bg-white shadow-md sticky top-0 z-50">
      <nav className="container mx-auto px-6 py-4 flex justify-between items-center">
        <div className="flex items-center">
          <a href="#" className="flex items-center space-x-3">
            <Logo className="h-10 w-10" />
            <span className="text-2xl font-bold text-primary self-center whitespace-nowrap">BMS Validator</span>
          </a>
        </div>
        <div className="hidden md:flex space-x-8">
          <a href="#" className="text-neutral-dark hover:text-secondary transition duration-300">Home</a>
        </div>
        <div className="md:hidden">
            <button className="text-neutral-dark focus:outline-none">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16m-7 6h7" />
                </svg>
            </button>
        </div>
      </nav>
    </header>
  );
};

export default Header;