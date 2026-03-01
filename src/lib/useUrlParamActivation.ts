'use client';

import { useState, useEffect } from 'react';

/**
 * Hook that checks for a URL parameter to activate feedback.
 * Persists activation to sessionStorage so it survives navigation.
 * Returns true (always active) when urlParam is not set.
 */
export function useUrlParamActivation(urlParam?: string): boolean {
  const [isActivated, setIsActivated] = useState(() => {
    if (!urlParam) return true;
    if (typeof window === 'undefined') return false;
    return sessionStorage.getItem(`cf-active-${urlParam}`) === 'true';
  });

  useEffect(() => {
    if (!urlParam) return;

    const params = new URLSearchParams(window.location.search);
    if (params.get(urlParam) === 'true') {
      sessionStorage.setItem(`cf-active-${urlParam}`, 'true');
      setIsActivated(true);
    } else {
      const stored = sessionStorage.getItem(`cf-active-${urlParam}`);
      if (stored === 'true') {
        setIsActivated(true);
      }
    }
  }, [urlParam]);

  return isActivated;
}
