import { useEffect, useRef, useState } from 'react';
import { kodiakEnv } from '../../config/env';

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string;
          theme?: 'light' | 'dark' | 'auto';
          callback?: (token: string) => void;
          'expired-callback'?: () => void;
          'error-callback'?: () => void;
        },
      ) => string;
      remove: (widgetId: string) => void;
    };
  }
}

interface TurnstileWidgetProps {
  onTokenChange: (token: string) => void;
}

const TURNSTILE_SCRIPT_ID = 'cloudflare-turnstile-script';

function loadTurnstileScript() {
  if (document.getElementById(TURNSTILE_SCRIPT_ID)) {
    return;
  }

  const script = document.createElement('script');
  script.id = TURNSTILE_SCRIPT_ID;
  script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  script.async = true;
  script.defer = true;
  document.head.appendChild(script);
}

export function TurnstileWidget({ onTokenChange }: TurnstileWidgetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [isReady, setIsReady] = useState(false);

  const siteKey = kodiakEnv.turnstileSiteKey;

  useEffect(() => {
    if (!siteKey) {
      return;
    }

    loadTurnstileScript();

    const interval = window.setInterval(() => {
      if (window.turnstile && containerRef.current && !widgetIdRef.current) {
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          theme: 'dark',
          callback: (token) => {
            onTokenChange(token);
            setIsReady(true);
          },
          'expired-callback': () => {
            onTokenChange('');
            setIsReady(false);
          },
          'error-callback': () => {
            onTokenChange('');
            setIsReady(false);
          },
        });

        window.clearInterval(interval);
      }
    }, 100);

    return () => {
      window.clearInterval(interval);

      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [onTokenChange, siteKey]);

  if (!siteKey) {
    return (
      <div className="turnstile-placeholder">
        Cloudflare verification is not configured for this build.
      </div>
    );
  }

  return (
    <div className="turnstile-wrap">
      <div ref={containerRef} />
      {!isReady ? <p>Complete verification to continue.</p> : null}
    </div>
  );
}
