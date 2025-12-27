

import React from 'react';
import AboutIllustration from './icons/AboutIllustration';

const About: React.FC = () => {
  return (
    <section id="about" className="py-20 bg-white">
      <div className="container mx-auto px-6 flex flex-col md:flex-row items-center gap-12">
        <div className="md:w-1/2">
            <AboutIllustration className="w-full h-auto"/>
        </div>
        <div className="md:w-1/2">
            <h2 className="text-3xl font-bold text-neutral-dark mb-4">About Us</h2>
            <p className="text-neutral mb-4">
                BMS Validator was born from a passion for renewable energy and a need for better, more accessible battery monitoring tools. Our mission is to empower battery owners—from DIY enthusiasts to commercial operators—with the insights they need to ensure safety, maximize performance, and extend the life of their energy storage systems.
            </p>
            <p className="text-neutral">
                Using cutting-edge AI, we transform complex BMS data into simple, actionable advice. We believe that by making battery management smarter, we can contribute to a more sustainable and energy-independent future.
            </p>
        </div>
      </div>
    </section>
  );
};

export default About;