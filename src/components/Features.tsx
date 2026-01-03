
import React from 'react';
import BoltIcon from './icons/BoltIcon';
import CheckCircleIcon from './icons/CheckCircleIcon';
import ChartBarIcon from './icons/ChartBarIcon';

const FeatureCard: React.FC<{ icon: React.ReactNode; title: string; description: string }> = ({ icon, title, description }) => (
  <div className="bg-white p-8 rounded-lg shadow-md text-center flex flex-col items-center">
    <div className="bg-secondary text-white rounded-full p-4 mb-4">
      {icon}
    </div>
    <h3 className="text-xl font-bold text-neutral-dark mb-2">{title}</h3>
    <p className="text-neutral">{description}</p>
  </div>
);

const Features: React.FC = () => {
  return (
    <section className="py-20 bg-neutral-light">
      <div className="container mx-auto px-6">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold text-neutral-dark">Why Choose BMS Validator?</h2>
          <p className="text-neutral mt-2 max-w-2xl mx-auto">
            Our AI-powered tool provides unparalleled insight into your battery health, helping you prevent issues before they arise.
          </p>
        </div>
        <div className="grid md:grid-cols-3 gap-8">
          <FeatureCard 
            icon={<BoltIcon className="h-8 w-8" />}
            title="Instant Analysis"
            description="Get immediate feedback on your BMS performance with our fast and accurate AI model."
          />
          <FeatureCard 
            icon={<CheckCircleIcon className="h-8 w-8" />}
            title="Actionable Insights"
            description="Receive clear recommendations to optimize your system and extend your battery's lifespan."
          />
          <FeatureCard 
            icon={<ChartBarIcon className="h-8 w-8" />}
            title="Historical Tracking"
            description="Monitor your battery health over time to detect trends and degradation. (Coming Soon)"
          />
        </div>
      </div>
    </section>
  );
};

export default Features;
