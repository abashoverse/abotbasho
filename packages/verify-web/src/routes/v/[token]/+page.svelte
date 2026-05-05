<script lang="ts">
  import type { PageData } from "./$types";
  import { onMount } from "svelte";
  import { SiweMessage } from "siwe";
  import { connect, disconnect, signMessage, getAccount } from "@wagmi/core";
  import { injected } from "@wagmi/connectors";
  import { wagmiConfig } from "$lib/wagmi";

  let { data }: { data: PageData } = $props();

  let connecting = $state(false);
  let signing = $state(false);
  let address = $state<string | null>(null);
  let delegatedFrom = $state("");
  let error = $state<string | null>(null);
  let success = $state<{ holder: string; method: string } | null>(null);

  onMount(() => {
    const acc = getAccount(wagmiConfig);
    if (acc.address) address = acc.address;
  });

  const onConnect = async () => {
    connecting = true;
    error = null;
    try {
      const result = await connect(wagmiConfig, { connector: injected() });
      address = result.accounts[0] ?? null;
    } catch (e) {
      error = e instanceof Error ? e.message : "connect_failed";
    } finally {
      connecting = false;
    }
  };

  const onDisconnect = async () => {
    await disconnect(wagmiConfig);
    address = null;
  };

  const onVerify = async () => {
    if (!address) return;
    signing = true;
    error = null;
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
        error = json.error ?? `request_failed_${res.status}`;
      }
    } catch (e) {
      error = e instanceof Error ? e.message : "sign_failed";
    } finally {
      signing = false;
    }
  };
</script>

<svelte:head>
  <title>Verify {data.session.project_name}</title>
</svelte:head>

<main>
  <h1>Verify {data.session.project_name}</h1>
  <p class="sub">
    Sign a message with your wallet to link it to your Discord account.
  </p>

  {#if success}
    <div class="ok">
      <strong>Linked.</strong>
      <p>
        Wallet <code>{success.holder}</code> is now linked
        ({success.method}). You can close this tab — the role appears in
        Discord shortly.
      </p>
    </div>
  {:else}
    {#if !address}
      <button onclick={onConnect} disabled={connecting}>
        {connecting ? "Connecting…" : "Connect wallet"}
      </button>
    {:else}
      <div class="row">
        <span>Connected: <code>{address}</code></span>
        <button class="link" onclick={onDisconnect}>disconnect</button>
      </div>

      {#if data.session.delegate_cash_enabled}
        <label>
          <span>delegate.cash cold wallet (optional)</span>
          <input
            placeholder="0x… cold wallet that holds the NFT"
            bind:value={delegatedFrom}
          />
        </label>
      {/if}

      <button onclick={onVerify} disabled={signing} class="primary">
        {signing ? "Sign in your wallet…" : "Sign and verify"}
      </button>
    {/if}

    {#if error}
      <p class="err">Error: {error}</p>
    {/if}
  {/if}
</main>

<style>
  main {
    max-width: 32rem;
    margin: 4rem auto;
    padding: 0 1rem;
    font-family: system-ui, sans-serif;
    color: #111;
  }
  h1 {
    font-size: 1.5rem;
    margin: 0 0 0.5rem;
  }
  .sub {
    color: #555;
    margin: 0 0 1.5rem;
  }
  button {
    background: #f3f4f6;
    border: 1px solid #d1d5db;
    padding: 0.6rem 1rem;
    border-radius: 0.375rem;
    cursor: pointer;
    font: inherit;
  }
  button:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
  button.primary {
    background: #111;
    color: white;
    border-color: #111;
  }
  button.link {
    background: none;
    border: none;
    padding: 0;
    color: #2563eb;
    text-decoration: underline;
  }
  .row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin: 0.75rem 0;
    font-size: 0.875rem;
  }
  label {
    display: block;
    margin: 1rem 0;
  }
  label span {
    display: block;
    font-size: 0.875rem;
    color: #374151;
    margin-bottom: 0.25rem;
  }
  input {
    width: 100%;
    padding: 0.5rem;
    border: 1px solid #d1d5db;
    border-radius: 0.375rem;
    font: inherit;
  }
  code {
    background: #f3f4f6;
    padding: 0.1rem 0.3rem;
    border-radius: 0.25rem;
    font-size: 0.85em;
    word-break: break-all;
  }
  .ok {
    background: #ecfdf5;
    border: 1px solid #10b981;
    padding: 1rem;
    border-radius: 0.375rem;
    color: #064e3b;
  }
  .ok strong {
    display: block;
    margin-bottom: 0.5rem;
  }
  .err {
    color: #b91c1c;
    margin-top: 1rem;
  }
</style>
