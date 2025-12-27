

import React from 'react';
import HeroIllustration from './icons/HeroIllustration';

const Hero: React.FC = () => {
    const scrollToUpload = () => {
        document.getElementById('upload-section')?.scrollIntoView({ behavior: 'smooth' });
    }
  return (
    <section className="bg-white">
      <div className="container mx-auto px-6 py-20 flex flex-col md:flex-row items-center">
        <div className="md:w-1/2 text-center md:text-left mb-10 md:mb-0">
          <h1 className="text-4xl md:text-5xl font-extrabold text-neutral-dark leading-tight mb-4">
            Validate Your Battery Management System with Ease
          </h1>
          <p className="text-lg text-neutral mb-8">
            Upload a screenshot of your BMS dashboard to get a comprehensive AI-powered analysis and ensure optimal performance.
          </p>
          <button 
            onClick={scrollToUpload}
            className="bg-secondary hover:bg-primary text-white font-bold py-3 px-8 rounded-full shadow-lg transform transition-transform duration-300 hover:scale-105"
          >
            Get Started
          </button>
        </div>
        <div className="md:w-1/2">
          <HeroIllustration className="w-full h-auto" />
        </div>
      </div>
    </section>
  );
};

export default Hero;