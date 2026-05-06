import type { Handle } from "@sveltejs/kit";

// Wallet-compatible CSP. Browser-extension wallets inject inline scripts via
// content scripts (MetaMask's inpage.js, etc.) that strict nonce-based CSP
// rejects, breaking window.ethereum injection. WalletConnect/Reown also
// reaches a handful of analytics + config endpoints that are awkward to
// allowlist exhaustively. Trade-off: we drop script-src strictness, which
// the page barely benefits from. It renders only server-validated session
// data, addresses, and indexer-supplied error codes (no user-generated
// HTML). Clickjacking defense is preserved via frame-ancestors 'none'.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self' https: wss:",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
].join("; ");

export const handle: Handle = async ({ event, resolve }) => {
  const response = await resolve(event);
  // Path tokens go in the URL. Keep them out of any Referer header that
  // downstream resources or external links might leak into.
  response.headers.set("Referrer-Policy", "no-referrer");
  response.headers.set("Content-Security-Policy", CSP);
  return response;
};
