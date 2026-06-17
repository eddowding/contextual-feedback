'use client';

import { useState, useEffect } from 'react';

/**
 * Hook that checks for a URL parameter to activate feedback.
 * Persists activation to sessionStorage so it survives navigation.
 * Returns true (always active) when urlParam is not set.
 *
 * The initial state never touches the URL or sessionStorage: the server
 * render and the first client render must agree (both `false` when urlParam
 * is set) or React reports a hydration mismatch. Activation is detected in
 * an effect, after hydration.
 */
export function useUrlParamActivation(urlParam?: string): boolean {
  const [isActivated, setIsActivated] = useState(!urlParam);

  useEffect(() => {
    if (!urlParam) return;

    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get(urlParam) === 'true';
    let fromStorage = false;

    // sessionStorage access can throw (sandboxed iframes, blocked storage in
    // some privacy modes) — never let that crash the provider. When storage
    // is unavailable, activation still works via the URL param alone.
    try {
      if (fromUrl) {
        sessionStorage.setItem(`cf-active-${urlParam}`, 'true');
      } else {
        fromStorage = sessionStorage.getItem(`cf-active-${urlParam}`) === 'true';
      }
    } catch {
      // Storage blocked — URL-param-only activation.
    }

    if (fromUrl || fromStorage) {
      setIsActivated(true);
    }
  }, [urlParam]);

  return isActivated;
}
