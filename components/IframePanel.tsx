"use client";

import { useState, useCallback, useRef } from "react";

interface Provider {
  id: string;
  name: string;
  url: string;
  color: string;
}

interface IframePanelProps {
  providers: Provider[];
  activeId: string;
}

export default function IframePanel({ providers, activeId }: IframePanelProps) {
  const [loadedIds, setLoadedIds] = useState<Set<string>>(new Set());
  const [errorIds, setErrorIds] = useState<Set<string>>(new Set());
  const iframeRefs = useRef<Record<string, HTMLIFrameElement | null>>({});

  const markError = useCallback((id: string) => {
    setErrorIds((prev) => new Set(prev).add(id));
    setLoadedIds((prev) => new Set(prev).add(id));
  }, []);

  const handleLoad = useCallback((id: string) => {
    const iframe = iframeRefs.current[id];
    if (iframe) {
      try {
        // If we can access contentDocument and it has no body content,
        // or if accessing it throws (cross-origin after X-Frame-Options block),
        // the site likely blocked embedding.
        const doc = iframe.contentDocument;
        if (doc && doc.body && doc.body.innerHTML === "") {
          markError(id);
          return;
        }
      } catch {
        // Cross-origin access is expected for sites that DO load.
        // But for X-Frame-Options: SAMEORIGIN blocked iframes,
        // some browsers show an error page that is still cross-origin.
        // We use a heuristic: check if iframe contentWindow.length is 0
        // (no sub-frames) — blocked pages typically have length 0.
        try {
          if (iframe.contentWindow && iframe.contentWindow.length === 0) {
            // Could be a valid page with no sub-frames, so we can't be sure.
            // We'll let it pass — the iframe may just show a blank/error from the browser.
          }
        } catch {
          // Fully blocked — mark as error
          markError(id);
          return;
        }
      }
    }
    setLoadedIds((prev) => new Set(prev).add(id));
  }, [markError]);

  const handleError = useCallback((id: string) => {
    markError(id);
  }, [markError]);

  return (
    <div className="relative flex-1 bg-white">
      {providers.map((provider) => {
        const isActive = provider.id === activeId;
        const isLoaded = loadedIds.has(provider.id);
        const hasError = errorIds.has(provider.id);

        return (
          <div
            key={provider.id}
            className={`absolute inset-0 ${isActive ? "z-10" : "z-0 invisible"}`}
          >
            {/* Loading spinner */}
            {isActive && !isLoaded && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-50 z-20">
                <div
                  className="w-10 h-10 border-4 border-gray-200 rounded-full animate-spin"
                  style={{ borderTopColor: provider.color }}
                />
                <p className="mt-4 text-sm text-gray-500">Loading {provider.name}...</p>
              </div>
            )}

            {/* Error / blocked fallback */}
            {hasError ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-gray-50">
                <div className="text-center max-w-md px-6">
                  <div
                    className="w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-4"
                    style={{ backgroundColor: provider.color + "20" }}
                  >
                    <svg className="w-8 h-8" style={{ color: provider.color }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">
                    Unable to embed {provider.name}
                  </h3>
                  <p className="text-sm text-gray-500 mb-4">
                    This site doesn&apos;t allow embedding in iframes. You can open it directly in a new tab instead.
                  </p>
                  <a
                    href={provider.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-white text-sm font-medium transition-opacity hover:opacity-90"
                    style={{ backgroundColor: provider.color }}
                  >
                    Open {provider.name}
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                  </a>
                </div>
              </div>
            ) : (
              <iframe
                ref={(el) => { iframeRefs.current[provider.id] = el; }}
                src={provider.url}
                title={provider.name}
                className="w-full h-full border-0"
                sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"
                onLoad={() => handleLoad(provider.id)}
                onError={() => handleError(provider.id)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
