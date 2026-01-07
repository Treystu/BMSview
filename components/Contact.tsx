import React, { useState } from 'react';
import SpinnerIcon from './icons/SpinnerIcon';

const log = (level: 'info' | 'warn' | 'error', message: string, context: object = {}) => {
    console.log(JSON.stringify({
        level: level.toUpperCase(),
        timestamp: new Date().toISOString(),
        component: 'Contact',
        message,
        context
    }));
};

const Contact: React.FC = () => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setSubmitError(null);
    log('info', 'Contact form submission started.', { name, email });

    try {
      const response = await fetch('/.netlify/functions/contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name, email, message }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'An unexpected error occurred.' }));
        log('error', 'Contact form submission failed.', { status: response.status, error: errorData.error });
        throw new Error(errorData.error || 'Something went wrong.');
      }
      
      log('info', 'Contact form submission successful.');
      setSubmitted(true);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred. Please try again.';
      log('error', 'Contact form submission caught an exception.', { error: errorMessage });
      setSubmitError(errorMessage);
    } finally {
      setSubmitting(false);
    }
  };


  return (
    <section id="contact" className="py-20 bg-neutral-light">
      <div className="container mx-auto px-6">
        <div className="max-w-xl mx-auto text-center">
            <h2 className="text-3xl font-bold text-neutral-dark mb-4">Contact Us</h2>
            <p className="text-neutral mb-8">
                Have questions or feedback? We'd love to hear from you.
            </p>
        </div>
        <div className="max-w-xl mx-auto bg-white p-8 rounded-xl shadow-lg">
          {submitted ? (
            <div className="text-center p-8">
              <h3 className="text-2xl font-bold text-secondary mb-2">Thank You!</h3>
              <p className="text-neutral">Your message has been sent. We'll get back to you shortly.</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="mb-4">
                <label htmlFor="name" className="block text-gray-700 font-medium mb-1">Name</label>
                <input
                  type="text"
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-secondary"
                  required
                />
              </div>
              <div className="mb-4">
                <label htmlFor="email" className="block text-gray-700 font-medium mb-1">Email</label>
                <input
                  type="email"
                  id="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-secondary"
                  required
                />
              </div>
              <div className="mb-6">
                <label htmlFor="message" className="block text-gray-700 font-medium mb-1">Message</label>
                <textarea
                  id="message"
                  rows={4}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-secondary"
                  required
                ></textarea>
              </div>
              <button 
                type="submit" 
                disabled={submitting}
                className="w-full bg-secondary hover:bg-primary text-white font-bold py-3 px-4 rounded-lg shadow-md transition-colors duration-300 disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center"
              >
                {submitting ? (
                    <>
                        <SpinnerIcon className="-ml-1 mr-3 h-5 w-5 text-white" />
                        Submitting...
                    </>
                ) : 'Submit'}
              </button>
              {submitError && <p className="mt-4 text-sm text-red-600 text-center">{submitError}</p>}
            </form>
          )}
        </div>
      </div>
    </section>
  );
};

export default Contact;
