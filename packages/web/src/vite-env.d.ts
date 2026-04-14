/// <reference types="vite/client" />

declare global {
  interface Window {
    __PI_WEB_CONFIG__?: {
      debugModeAvailable?: boolean;
    };
  }
}

export {};
