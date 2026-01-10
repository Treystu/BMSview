import React, { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface TypewriterMarkdownProps {
  content: string;
  speed?: number; // characters per interval
  interval?: number; // milliseconds between updates
  className?: string;
  onComplete?: () => void;
}

/**
 * TypewriterMarkdown component
 * Renders markdown content with a typewriter effect, revealing text progressively
 */
export const TypewriterMarkdown: React.FC<TypewriterMarkdownProps> = ({
  content,
  speed = 20, // Show 20 characters per update for smooth but fast streaming
  interval = 50, // Update every 50ms
  className = '',
  onComplete
}) => {
  const [displayedContent, setDisplayedContent] = useState('');
  const [isComplete, setIsComplete] = useState(false);
  const contentRef = useRef(content);
  const indexRef = useRef(0);

  // Reset when content changes
  useEffect(() => {
    if (content !== contentRef.current) {
      contentRef.current = content;
      indexRef.current = 0;
      setDisplayedContent('');
      setIsComplete(false);
    }
  }, [content]);

  // Typewriter effect
  useEffect(() => {
    if (isComplete || indexRef.current >= content.length) {
      if (!isComplete && indexRef.current >= content.length) {
        setIsComplete(true);
        onComplete?.();
      }
      return;
    }

    const timer = setInterval(() => {
      const nextIndex = Math.min(indexRef.current + speed, content.length);
      setDisplayedContent(content.substring(0, nextIndex));
      indexRef.current = nextIndex;

      if (nextIndex >= content.length) {
        setIsComplete(true);
        onComplete?.();
        clearInterval(timer);
      }
    }, interval);

    return () => clearInterval(timer);
  }, [content, speed, interval, isComplete, onComplete]);

  return (
    <div className={`prose prose-sm max-w-none ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Custom styling for markdown elements with improved wrapping
          h1: ({ node: _node, ...props }) => <h1 className="text-2xl font-bold text-gray-900 mb-4 mt-6 break-words" {...props} />,
          h2: ({ node: _node, ...props }) => <h2 className="text-xl font-bold text-gray-900 mb-3 mt-5 break-words" {...props} />,
          h3: ({ node: _node, ...props }) => <h3 className="text-lg font-semibold text-gray-800 mb-2 mt-4 break-words" {...props} />,
          h4: ({ node: _node, ...props }) => <h4 className="text-base font-semibold text-gray-800 mb-2 mt-3 break-words" {...props} />,
          p: ({ node: _node, ...props }) => <p className="text-gray-700 mb-3 leading-relaxed break-words" {...props} />,
          ul: ({ node: _node, ...props }) => <ul className="list-disc list-inside mb-3 space-y-1.5" {...props} />,
          ol: ({ node: _node, ...props }) => <ol className="list-decimal list-inside mb-3 space-y-1.5" {...props} />,
          li: ({ node: _node, ...props }) => <li className="text-gray-700 ml-2 leading-relaxed break-words" {...props} />,
          strong: ({ node: _node, ...props }) => <strong className="font-bold text-gray-900" {...props} />,
          em: ({ node: _node, ...props }) => <em className="italic text-gray-700" {...props} />,
          code: ({ node: _node, className, ...props }) => {
            const baseClassName = className ? String(className) : '';
            const isInline = baseClassName.length === 0;
            const mergedClassName = isInline
              ? `bg-gray-100 text-pink-600 px-1.5 py-0.5 rounded text-sm break-words${baseClassName ? ` ${baseClassName}` : ''}`
              : `block bg-gray-900 text-green-400 p-3 rounded-lg text-sm overflow-x-auto mb-3${baseClassName ? ` ${baseClassName}` : ''}`;
            return <code className={mergedClassName} {...props} />;
          },
          blockquote: ({ node: _node, ...props }) => (
            <blockquote className="border-l-4 border-blue-500 pl-4 py-2 mb-3 italic text-gray-600 bg-blue-50 rounded-r break-words" {...props} />
          ),
          a: ({ node: _node, ...props }) => (
            <a className="text-blue-600 hover:text-blue-800 underline break-words" {...props} />
          ),
          table: ({ node: _node, ...props }) => (
            <div className="overflow-x-auto mb-3">
              <table className="min-w-full divide-y divide-gray-200 border border-gray-300 rounded" {...props} />
            </div>
          ),
          th: ({ node: _node, ...props }) => (
            <th className="px-3 py-2 bg-gray-100 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider border-b" {...props} />
          ),
          td: ({ node: _node, ...props }) => (
            <td className="px-3 py-2 text-sm text-gray-700 border-b break-words" {...props} />
          ),
        }}
      >
        {displayedContent}
      </ReactMarkdown>
      {!isComplete && (
        <span className="inline-block w-2 h-5 bg-blue-600 ml-1 animate-pulse" style={{ animation: 'blink 1s infinite' }} />
      )}
      <style>{`
        @keyframes blink {
          0%, 50% { opacity: 1; }
          51%, 100% { opacity: 0; }
        }
      `}</style>
    </div>
  );
};

export default TypewriterMarkdown;
