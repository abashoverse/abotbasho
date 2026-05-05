import adapter from "@sveltejs/adapter-node";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
    csp: {
      mode: "nonce",
      directives: {
        "default-src": ["'self'"],
        "connect-src": [
          "'self'",
          "wss://*.walletconnect.org",
          "https://*.walletconnect.org",
          "wss://*.walletconnect.com",
          "https://*.walletconnect.com",
          "https://cloud.reown.com",
          "https://*.reown.com",
        ],
        "script-src": ["'self'"],
        "style-src": ["'self'", "'unsafe-inline'"],
        "img-src": ["'self'", "data:", "https:"],
        "frame-ancestors": ["'none'"],
        "form-action": ["'self'"],
      },
    },
  },
};
