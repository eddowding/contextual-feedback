import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Mock browser globals for node environment
const sessionStore: Record<string, string> = {};
let currentSearch = '';

const mockSessionStorage = {
  getItem: vi.fn((key: string) => sessionStore[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { sessionStore[key] = value; }),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(),
};

// Set up global window/sessionStorage mocks before imports
const mockWindow = {
  location: { search: '' },
  sessionStorage: mockSessionStorage,
};

vi.stubGlobal('window', mockWindow);
vi.stubGlobal('sessionStorage', mockSessionStorage);

// Track React hook calls
let stateInitializer: (() => boolean) | boolean = false;
let effectCb: (() => void) | null = null;
let currentStateValue = false;

vi.mock('react', () => ({
  useState: (init: boolean | (() => boolean)) => {
    stateInitializer = init;
    const val = typeof init === 'function' ? init() : init;
    currentStateValue = val;
    return [val, (v: boolean | ((p: boolean) => boolean)) => {
      currentStateValue = typeof v === 'function' ? v(currentStateValue) : v;
    }];
  },
  useEffect: (cb: () => void) => {
    effectCb = cb;
  },
}));

import { useUrlParamActivation } from '../useUrlParamActivation';

describe('useUrlParamActivation', () => {
  beforeEach(() => {
    // Reset state
    Object.keys(sessionStore).forEach(k => delete sessionStore[k]);
    currentSearch = '';
    mockWindow.location.search = '';
    effectCb = null;
    currentStateValue = false;
    vi.clearAllMocks();
  });

  it('returns true when urlParam is not set', () => {
    const result = useUrlParamActivation();
    expect(result).toBe(true);
  });

  it('returns true when urlParam is undefined', () => {
    const result = useUrlParamActivation(undefined);
    expect(result).toBe(true);
  });

  it('returns false when URL param absent and sessionStorage empty', () => {
    mockWindow.location.search = '';
    const result = useUrlParamActivation('feedback');
    expect(result).toBe(false);
  });

  it('returns true when sessionStorage already has activation', () => {
    sessionStore['cf-active-feedback'] = 'true';
    mockWindow.location.search = '';
    const result = useUrlParamActivation('feedback');
    expect(result).toBe(true);
  });

  it('persists to sessionStorage when URL param detected', () => {
    mockWindow.location.search = '?feedback=true';
    useUrlParamActivation('feedback');

    expect(effectCb).not.toBeNull();
    effectCb!();

    expect(sessionStore['cf-active-feedback']).toBe('true');
  });

  it('sets state to true via effect when URL param is present', () => {
    mockWindow.location.search = '?feedback=true';
    useUrlParamActivation('feedback');
    effectCb!();
    expect(currentStateValue).toBe(true);
  });

  it('activates from sessionStorage on hydration', () => {
    mockWindow.location.search = '';
    sessionStore['cf-active-feedback'] = 'true';
    currentStateValue = false;

    useUrlParamActivation('feedback');
    effectCb!();

    expect(currentStateValue).toBe(true);
  });
});
