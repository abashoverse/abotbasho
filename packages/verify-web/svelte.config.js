import adapter from "@sveltejs/adapter-node";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

// CSP is set in src/hooks.server.ts rather than here. Browser-extension
// wallets (MetaMask, Rabby, …) inject inline scripts that nonce-mode CSP
// rejects, so a nonce-based policy from SvelteKit is incompatible with the
// connect-wallet flow. The hooks header instead allows 'unsafe-inline' for
// scripts and broadens connect-src for WalletConnect/Reown endpoints.
/** @type {import('@sveltejs/kit').Config} */
export default {
  preprocess: vitePreprocess(),
  kit: {
    adapter: adapter(),
  },
};
