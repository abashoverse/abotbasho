<script lang="ts">
  import type { PageData } from "./$types";
  import { onMount } from "svelte";
  import { SiweMessage } from "siwe";
  import { connect, disconnect, signMessage, getAccount } from "@wagmi/core";
  import { injected } from "@wagmi/connectors";
  import { wagmiConfig } from "$lib/wagmi";

  let { data }: { data: PageData } = $props();

  type Tab = "siwe" | "bio";
  let tab = $state<Tab>("siwe");

  // SIWE state
  let connecting = $state(false);
  let signing = $state(false);
  let address = $state<string | null>(null);
  let delegatedFrom = $state("");
  let siweError = $state<string | null>(null);

  // Bio state
  let bioRequesting = $state(false);
  let bioVerifying = $state(false);
  let bioCode = $state<string | null>(null);
  let bioCodeExpiresAt = $state<string | null>(null);
  let bioWallet = $state("");
  let bioDelegatedFrom = $state("");
  let bioCopied = $state(false);
  let bioError = $state<string | null>(null);

  // Shared success state (either method)
  let success = $state<{ holder: string; method: string } | null>(null);

  const shortAddr = (a: string): string =>
    a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;

  onMount(() => {
    const acc = getAccount(wagmiConfig);
    if (acc.address) address = acc.address;
  });

  const switchTab = (next: Tab) => {
    if (tab === next) return;
    tab = next;
    siweError = null;
    bioError = null;
  };

  // ---- SIWE ----------------------------------------------------------

  const onConnect = async () => {
    connecting = true;
    siweError = null;
    try {
      const result = await connect(wagmiConfig, { connector: injected() });
      address = result.accounts[0] ?? null;
    } catch (e) {
      siweError = e instanceof Error ? e.message : "connect_failed";
    } finally {
      connecting = false;
    }
  };

  const onDisconnect = async () => {
    await disconnect(wagmiConfig);
    address = null;
    siweError = null;
    delegatedFrom = "";
  };

  const onTryDifferentWallet = async () => {
    await disconnect(wagmiConfig);
    address = null;
    siweError = null;
    delegatedFrom = "";

    try {
      const w = window as unknown as {
        ethereum?: {
          request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
        };
      };
      if (w.ethereum) {
        await w.ethereum.request({
          method: "wallet_requestPermissions",
          params: [{ eth_accounts: {} }],
        });
      }
    } catch {
      // user dismissed picker or wallet doesn't support EIP-2255
    }

    await onConnect();
  };

  const onVerify = async () => {
    if (!address) return;
    signing = true;
    siweError = null;
    try {
      const message = new SiweMessage({
        domain: data.session.domain,
        address,
        statement: data.session.statement,
        uri: window.location.origin,
        version: "1",
        chainId: data.session.chain_id,
        nonce: data.session.nonce,
        issuedAt: new Date().toISOString(),
      });
      const messageString = message.prepareMessage();
      const signature = await signMessage(wagmiConfig, {
        message: messageString,
      });
      const res = await fetch(
        `/v/${encodeURIComponent(data.token)}/finalize-siwe`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            message: messageString,
            signature,
            delegated_from: delegatedFrom || undefined,
          }),
        },
      );
      const json = (await res.json()) as {
        ok?: boolean;
        holder_address?: string;
        method?: string;
        error?: string;
      };
      if (res.ok && json.ok) {
        success = {
          holder: json.holder_address ?? "",
          method: json.method ?? "",
        };
      } else {
        siweError = json.error ?? `request_failed_${res.status}`;
      }
    } catch (e) {
      siweError = e instanceof Error ? e.message : "sign_failed";
    } finally {
      signing = false;
    }
  };

  // ---- Bio -----------------------------------------------------------

  const onGetBioCode = async () => {
    bioRequesting = true;
    bioError = null;
    try {
      const res = await fetch(
        `/v/${encodeURIComponent(data.token)}/bio/start`,
        { method: "POST" },
      );
      const json = (await res.json()) as {
        ok?: boolean;
        code?: string;
        expires_at?: string;
        error?: string;
      };
      if (res.ok && json.code) {
        bioCode = json.code;
        bioCodeExpiresAt = json.expires_at ?? null;
      } else {
        bioError = json.error ?? `request_failed_${res.status}`;
      }
    } catch (e) {
      bioError = e instanceof Error ? e.message : "request_failed";
    } finally {
      bioRequesting = false;
    }
  };

  const onCopyBioCode = async () => {
    if (!bioCode) return;
    try {
      await navigator.clipboard.writeText(bioCode);
      bioCopied = true;
      setTimeout(() => (bioCopied = false), 1500);
    } catch {
      // ignore — user can manually select
    }
  };

  const onVerifyBio = async () => {
    if (!bioCode || !bioWallet) return;
    bioVerifying = true;
    bioError = null;
    try {
      const res = await fetch(
        `/v/${encodeURIComponent(data.token)}/bio/finalize`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            wallet_address: bioWallet.trim(),
            code: bioCode,
            delegated_from: bioDelegatedFrom.trim() || undefined,
          }),
        },
      );
      const json = (await res.json()) as {
        ok?: boolean;
        holder_address?: string;
        method?: string;
        error?: string;
      };
      if (res.ok && json.ok) {
        success = {
          holder: json.holder_address ?? "",
          method: json.method ?? "bio",
        };
      } else {
        bioError = json.error ?? `request_failed_${res.status}`;
      }
    } catch (e) {
      bioError = e instanceof Error ? e.message : "request_failed";
    } finally {
      bioVerifying = false;
    }
  };

  const platformLabel = $derived(
    data.session.platform === "telegram" ? "Telegram" : "Discord",
  );

  const successCopy = $derived(
    data.session.platform === "telegram"
      ? "Your single-use chat invite will arrive as a Telegram DM from the bot shortly."
      : "The role appears in Discord shortly.",
  );

  const errorLabel = (e: string): string => {
    switch (e) {
      case "no_holdings":
        return "This wallet doesn't hold a qualifying NFT.";
      case "not_delegated":
        return "The cold wallet hasn't delegated to this hot wallet on delegate.cash.";
      case "delegate_cash_disabled":
        return "delegate.cash is disabled for this server.";
      case "invalid_or_expired":
        return `Verification link expired or already used. Run /verify in ${platformLabel} again.`;
      case "bio_disabled":
        return "OpenSea bio verification is not enabled for this server.";
      case "bio_misconfigured":
        return "OpenSea bio verification is enabled but the server is missing OPENSEA_API_KEY. Contact the server admin.";
      case "code_mismatch_or_expired":
        return "Bio code expired or mismatched. Generate a fresh one.";
      case "code_not_in_bio":
        return "We didn't find the code in that wallet's OpenSea bio. Paste it in, save the bio, then retry.";
      default:
        return e;
    }
  };

  const isValidAddress = (v: string): boolean =>
    /^0x[0-9a-fA-F]{40}$/.test(v.trim());
</script>

<svelte:head>
  <title>Verify {data.session.project_name}</title>
</svelte:head>

<main>
  <header>
    <p class="eyebrow">{data.session.project_name}</p>
    <h1>Verify your holdings</h1>
    <p class="lede">
      Prove on-chain ownership and unlock your role.
    </p>
  </header>

  {#if success}
    <section class="card ok">
      <h2>Linked.</h2>
      <p>
        Wallet
        <code title={success.holder}>{shortAddr(success.holder)}</code>
        is now linked
        <span class="muted">({success.method})</span>. You can close this tab.
        {successCopy}
      </p>
    </section>
  {:else}
    {#if data.session.opensea_bio_enabled}
      <div class="tabs" role="tablist">
        <button
          type="button"
          role="tab"
          class="tab"
          class:active={tab === "siwe"}
          onclick={() => switchTab("siwe")}
        >
          Wallet sign
        </button>
        <button
          type="button"
          role="tab"
          class="tab"
          class:active={tab === "bio"}
          onclick={() => switchTab("bio")}
        >
          OpenSea bio
        </button>
      </div>
    {/if}

    <section class="card">
      {#if tab === "siwe"}
        {#if !address}
          <p class="hint">
            Sign a message with your wallet. No transaction, no gas.
          </p>
          <button
            onclick={onConnect}
            disabled={connecting}
            class="btn primary full"
          >
            {connecting ? "Connecting…" : "Connect wallet"}
          </button>
        {:else}
          <div class="wallet">
            <div>
              <div class="label">Connected wallet</div>
              <code class="addr" title={address}>{shortAddr(address)}</code>
            </div>
            <button class="link" onclick={onDisconnect}>disconnect</button>
          </div>

          {#if data.session.delegate_cash_enabled}
            <label class="field">
              <span>delegate.cash cold wallet (optional)</span>
              <input
                placeholder="0x… cold wallet that holds the NFT"
                bind:value={delegatedFrom}
                spellcheck="false"
                autocomplete="off"
              />
            </label>
          {/if}

          <button
            onclick={onVerify}
            disabled={signing}
            class="btn primary full"
          >
            {signing ? "Sign in your wallet…" : "Sign and verify"}
          </button>
        {/if}

        {#if siweError}
          <div class="err">
            <p><strong>{errorLabel(siweError)}</strong></p>
            {#if address && siweError !== "invalid_or_expired"}
              <button class="btn ghost full" onclick={onTryDifferentWallet}>
                Try a different wallet
              </button>
              <p class="hint">
                Tip: switch accounts in your wallet extension first if you
                want a specific one.
              </p>
            {/if}
          </div>
        {/if}
      {:else}
        {#if !bioCode}
          <p class="hint">
            No signature required. Add a one-time code to your OpenSea bio,
            then submit your wallet.
          </p>
          <button
            onclick={onGetBioCode}
            disabled={bioRequesting}
            class="btn primary full"
          >
            {bioRequesting ? "Generating…" : "Get verification code"}
          </button>
        {:else}
          <div class="bio-code">
            <div class="label">Your code</div>
            <div class="bio-code-row">
              <code class="bio-code-value">{bioCode}</code>
              <button class="btn ghost copy" onclick={onCopyBioCode}>
                {bioCopied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>

          <ol class="steps">
            <li>Open <a href="https://opensea.io" target="_blank" rel="noopener noreferrer">OpenSea</a> and edit your profile bio.</li>
            <li>Paste the code anywhere in the bio. Save.</li>
            <li>Enter your wallet address below and verify.</li>
          </ol>

          <label class="field">
            <span>Wallet with the bio</span>
            <input
              placeholder="0x…"
              bind:value={bioWallet}
              spellcheck="false"
              autocomplete="off"
            />
          </label>

          {#if data.session.delegate_cash_enabled}
            <label class="field">
              <span>delegate.cash cold wallet (optional)</span>
              <input
                placeholder="0x… cold wallet that holds the NFT"
                bind:value={bioDelegatedFrom}
                spellcheck="false"
                autocomplete="off"
              />
            </label>
          {/if}

          <button
            onclick={onVerifyBio}
            disabled={bioVerifying || !isValidAddress(bioWallet) || (bioDelegatedFrom.trim().length > 0 && !isValidAddress(bioDelegatedFrom))}
            class="btn primary full"
          >
            {bioVerifying ? "Verifying bio…" : "Verify bio"}
          </button>
        {/if}

        {#if bioError}
          <div class="err">
            <p><strong>{errorLabel(bioError)}</strong></p>
          </div>
        {/if}
      {/if}
    </section>
  {/if}

  <footer>
    <p class="muted">
      We never see your private key. SIWE proves wallet control with a
      signed message; the OpenSea bio path proves it via a code on your
      profile.
    </p>
  </footer>
</main>

<style>
  main {
    width: 100%;
    max-width: 32rem;
    margin: 2rem auto;
    padding: 0 1.25rem;
  }

  header {
    margin-bottom: 1.5rem;
  }

  .eyebrow {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    letter-spacing: 0.15em;
    text-transform: uppercase;
    color: var(--muted);
    margin: 0 0 0.5rem;
  }

  h1 {
    font-family: var(--font-display);
    font-size: 2rem;
    font-weight: 800;
    letter-spacing: -0.02em;
    line-height: 1.1;
    color: var(--fg);
    margin: 0 0 0.75rem;
  }

  .lede {
    color: var(--muted);
    line-height: 1.5;
    margin: 0;
    max-width: 30rem;
  }

  .tabs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0;
    margin-bottom: 1rem;
    border: var(--border-w) solid var(--border);
    border-radius: var(--radius);
    overflow: hidden;
  }

  .tab {
    background: transparent;
    color: var(--muted);
    border: none;
    padding: 0.7rem 1rem;
    font-family: var(--font-mono);
    font-size: 0.8rem;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    cursor: pointer;
    transition: background 0.15s var(--ease), color 0.15s var(--ease);
  }

  .tab:hover:not(.active) {
    background: var(--bg-sunken);
    color: var(--fg);
  }

  .tab.active {
    background: var(--accent);
    color: var(--fg-on-accent);
  }

  .card {
    background: var(--bg-elevated);
    border: var(--border-w) solid var(--border);
    border-radius: var(--radius);
    padding: 1.5rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  .card.ok {
    background: var(--ok-bg);
    border-color: var(--ok);
    color: var(--fg);
  }

  .card.ok h2 {
    font-family: var(--font-display);
    font-size: 1.25rem;
    font-weight: 800;
    margin: 0;
    color: var(--ok);
  }

  .card.ok p {
    margin: 0;
    line-height: 1.5;
  }

  .wallet {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.75rem 1rem;
    background: var(--bg-sunken);
    border: var(--border-w) solid var(--border);
    border-radius: var(--radius);
  }

  .wallet .label {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--muted);
    margin-bottom: 0.25rem;
  }

  .addr {
    font-family: var(--font-mono);
    font-size: 0.8rem;
    word-break: break-all;
    color: var(--fg);
  }

  .field {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .field span {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--muted);
  }

  .field input {
    font-family: var(--font-mono);
    font-size: 0.85rem;
    padding: 0.6rem 0.75rem;
    background: var(--bg);
    color: var(--fg);
    border: var(--border-w) solid var(--border);
    border-radius: var(--radius);
    outline: none;
    transition: border-color 0.15s var(--ease);
  }

  .field input:focus {
    border-color: var(--accent);
  }

  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-family: var(--font-mono);
    font-size: 0.85rem;
    letter-spacing: 0.02em;
    padding: 0.7rem 1rem;
    border-radius: var(--radius);
    border: var(--border-w) solid var(--border);
    cursor: pointer;
    background: transparent;
    color: var(--fg);
    transition: background 0.15s var(--ease), color 0.15s var(--ease);
  }

  .btn.full {
    width: 100%;
  }

  .btn.primary {
    background: var(--accent);
    color: var(--fg-on-accent);
    border-color: var(--accent);
  }

  .btn.primary:hover:not(:disabled) {
    background: transparent;
    color: var(--fg);
  }

  .btn.ghost:hover:not(:disabled) {
    background: var(--accent);
    color: var(--fg-on-accent);
  }

  .btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .btn.copy {
    padding: 0.5rem 0.75rem;
    font-size: 0.75rem;
  }

  .link {
    background: none;
    border: none;
    padding: 0;
    color: var(--muted);
    text-decoration: underline;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    cursor: pointer;
  }

  .link:hover {
    color: var(--fg);
  }

  .err {
    background: var(--error-bg);
    border: var(--border-w) solid var(--error);
    border-radius: var(--radius);
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .err p {
    margin: 0;
    color: var(--fg);
    line-height: 1.4;
  }

  .err strong {
    color: var(--error);
    font-weight: 700;
  }

  .hint {
    font-size: 0.8rem;
    color: var(--muted);
    margin: 0;
    line-height: 1.5;
  }

  .muted {
    color: var(--muted);
  }

  code {
    font-family: var(--font-mono);
    background: var(--bg-sunken);
    border: var(--border-w) solid var(--border);
    border-radius: 0.25rem;
    padding: 0.1rem 0.35rem;
    font-size: 0.8em;
    word-break: break-all;
  }

  .bio-code {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }

  .bio-code .label {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--muted);
  }

  .bio-code-row {
    display: flex;
    align-items: stretch;
    gap: 0.5rem;
  }

  .bio-code-value {
    flex: 1;
    font-family: var(--font-mono);
    font-size: 1rem;
    padding: 0.6rem 0.75rem;
    background: var(--bg-sunken);
    border: var(--border-w) solid var(--border);
    border-radius: var(--radius);
    color: var(--fg);
    text-align: center;
    letter-spacing: 0.05em;
  }

  .steps {
    margin: 0;
    padding-left: 1.25rem;
    font-size: 0.85rem;
    color: var(--muted);
    line-height: 1.6;
  }

  .steps a {
    color: var(--fg);
    text-decoration: underline;
  }

  footer {
    margin-top: 1.5rem;
    text-align: center;
    font-size: 0.8rem;
  }

  footer p {
    margin: 0;
  }
</style>
