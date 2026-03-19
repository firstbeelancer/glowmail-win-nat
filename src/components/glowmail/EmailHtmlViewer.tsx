import React, { useRef, useEffect, useState } from 'react';

/** Sanitize HTML: remove scripts, event handlers, dangerous tags */
function sanitizeHtml(html: string): string {
  // Remove <script> tags and content
  let clean = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  // Remove <style> that contains @import or expression()
  // Keep regular <style> for email formatting
  // Remove event handlers (on*)
  clean = clean.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]*)/gi, '');
  // Remove javascript: hrefs
  clean = clean.replace(/href\s*=\s*(?:"javascript:[^"]*"|'javascript:[^']*')/gi, 'href="#"');
  // Remove <iframe>, <object>, <embed>, <form>, <input>, <button> tags
  clean = clean.replace(/<\/?(iframe|object|embed|form|input|button|textarea|select|applet|meta|link|base)[\s\S]*?>/gi, '');
  return clean;
}

const baseStyles = `
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 16px;
      background: #ffffff;
      color: #111111;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
      font-size: 14px;
      line-height: 1.6;
      word-wrap: break-word;
      overflow-wrap: break-word;
      -webkit-font-smoothing: antialiased;
    }
    img {
      max-width: 100%;
      height: auto;
      display: inline-block;
    }
    table {
      max-width: 100%;
      border-collapse: collapse;
    }
    a {
      color: #1a73e8;
      text-decoration: underline;
    }
    blockquote {
      margin: 8px 0;
      padding: 0 12px;
      border-left: 3px solid #ccc;
      color: #555;
    }
    pre, code {
      white-space: pre-wrap;
      word-break: break-all;
      font-family: 'Courier New', Courier, monospace;
      font-size: 13px;
      background: #f5f5f5;
      padding: 2px 4px;
      border-radius: 3px;
    }
    hr {
      border: none;
      border-top: 1px solid #ddd;
      margin: 16px 0;
    }
  </style>
`;

interface EmailHtmlViewerProps {
  html: string;
  className?: string;
}

export const EmailHtmlViewer: React.FC<EmailHtmlViewerProps> = ({ html, className }) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(300);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    const sanitized = sanitizeHtml(html);
    const srcDoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${baseStyles}</head><body>${sanitized}</body></html>`;

    iframe.srcdoc = srcDoc;

    const adjustHeight = () => {
      try {
        const doc = iframe.contentDocument || iframe.contentWindow?.document;
        if (doc?.body) {
          const newHeight = Math.max(doc.body.scrollHeight + 32, 200);
          setHeight(newHeight);
        }
      } catch {
        // cross-origin, ignore
      }
    };

    iframe.addEventListener('load', adjustHeight);

    // Also poll a couple times for late-loading content
    const t1 = setTimeout(adjustHeight, 500);
    const t2 = setTimeout(adjustHeight, 1500);

    return () => {
      iframe.removeEventListener('load', adjustHeight);
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [html]);

  return (
    <iframe
      ref={iframeRef}
      sandbox="allow-same-origin"
      className={className}
      style={{
        width: '100%',
        height: `${height}px`,
        border: 'none',
        borderRadius: '12px',
        background: '#ffffff',
        display: 'block',
      }}
      title="Email content"
    />
  );
};

interface EmailTextViewerProps {
  text: string;
  className?: string;
}

export const EmailTextViewer: React.FC<EmailTextViewerProps> = ({ text, className }) => {
  return (
    <div
      className={className}
      style={{
        whiteSpace: 'pre-wrap',
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
        fontSize: '14px',
        lineHeight: '1.6',
        color: '#222222',
        background: '#ffffff',
        padding: '16px',
        borderRadius: '12px',
        wordBreak: 'break-word',
      }}
    >
      {text}
    </div>
  );
};
