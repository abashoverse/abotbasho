import { defineConfig } from "@abotbasho/shared";

// Copy this file to `abotbasho.config.ts` and edit in your collection's values.
// `wrapper`, `messages`, `plugins`, and the tuning fields below are all optional.
export default defineConfig({
  project: {
    name: "myBot",
    url: "https://my-collection.xyz",
  },
  primary: {
    label: "MyCollection",       // unique key, used internally
    displayName: "MyCollection", // shown in posts (defaults to label)
    address: "0x...",            // your contract address
    deployBlock: 0n,             // block the contract was deployed at
    totalSupply: 10000,          // optional, sets /view bounds in Discord
  },
  // Uncomment and fill in if your collection has a wrapper contract.
  // wrapper: {
  //   label: "MyCollectionWrapper",
  //   displayName: "MyCollectionWrapper",
  //   pluralName: "MyCollections",
  //   address: "0x...",
  //   deployBlock: 0n,
  // },
  // Default copy appended per event type. Discord renders these as the embed
  // footer; Twitter appends them as a body line. Admins can override at
  // runtime via Discord's `/config message` command.
  // messages: {
  //   sale: "",
  //   wrap: "",
  //   unwrap: "",
  // },
  // ms between indexer polls. Set to 0 to disable polling
  // (useful for slash-command-only debugging). Default 10000.
  // pollIntervalMs: 10000,
  // Override the IPFS gateway used to resolve token images.
  // Default https://ipfs.io/ipfs/.
  // ipfsGateway: "https://w3s.link/ipfs/",
  // Prepended to every tweet's title line (e.g. an emoji or short brand mark).
  // Discord is unaffected.
  // tweetPrefix: "",
  // Block explorer base URL used for tx/address links in embeds and tweets.
  // Default https://etherscan.io. Set to your chain's explorer when running
  // on Base, Polygon, etc. (e.g. "https://basescan.org").
  // explorerUrl: "https://etherscan.io",
  // NFT-holder verification. When enabled, the indexer exposes /verify routes
  // and each configured platform's bot reconciles access (Discord role,
  // Telegram chat invite/kick). Requires the verify-web service from
  // docker-compose.yml. See README for the security model.
  // verify: {
  //   enabled: false,
  //   publicUrl: "https://verify.example.xyz",
  //   pollIntervalMs: 5000,             // role-event drain cadence (applies to every platform)
  //   delegateCash: true,               // accept delegate.cash hot/cold delegation
  //   openseaBio: false,                // bio-code fallback (requires OPENSEA_API_KEY)
  //   openseaSlug: "",                  // required when openseaBio is true
  //   sourceCodeUrl: "https://github.com/your-fork/abotbasho", // optional Source code link button on the persistent embed
  //   // At least one platform block is required when verify.enabled is true.
  //   discord: {
  //     roleId: "",                     // Discord role granted to verified holders
  //   },
  //   telegram: {
  //     chatId: "-1001234567890",       // gated supergroup id; bot must be admin with Invite + Ban perms
  //     inviteLinkExpirySec: 600,       // single-use invite TTL (default 600)
  //     kickSemantics: true,            // ban + immediate unban so a re-verified user can rejoin
  //     notifyChatOnUnkickable: false,  // dev only: post a chat notice instead of silent log when target is owner/admin
  //   },
  // },
  // Per-plugin configuration. Each plugin owns its slice and validates it
  // on init. See packages/discord/README.md for the available plugins.
  plugins: {
    // rss: {
    //   url: "https://blog.example.com/rss.xml",
    //   pollIntervalMs: 5 * 60 * 1000,
    // },
  },
});
