import { existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import type { Address } from "viem";

export interface ProjectMeta {
  name: string;
  url?: string;
}

export interface PrimaryContract {
  label: string;
  displayName?: string;
  address: Address;
  deployBlock: bigint;
  totalSupply?: number;
}

export interface WrapperContract {
  label: string;
  displayName?: string;
  pluralName?: string;
  address: Address;
  deployBlock: bigint;
}

export interface ProjectMessages {
  sale?: string;
  wrap?: string;
  unwrap?: string;
}

export interface VerifyConfig {
  enabled: boolean;
  /** Discord role granted to verified holders. */
  roleId: string;
  /** Public-facing URL of the verify-web service (e.g. https://verify.example.xyz). */
  publicUrl: string;
  /** Discord role-event poll cadence. Default 5000. */
  pollIntervalMs?: number;
  /** Allow delegate.cash hot/cold delegation alongside SIWE. Default true. */
  delegateCash?: boolean;
  /** OpenSea bio fallback flow. Default false; auto-noop unless OPENSEA_API_KEY is set. */
  openseaBio?: boolean;
  /** OpenSea collection slug; required when openseaBio=true. */
  openseaSlug?: string;
  /**
   * Optional URL shown as a "Source code" link button next to the Verify
   * button on the persistent embed posted via `/verify-admin post`. Omit to
   * hide the button entirely.
   */
  sourceCodeUrl?: string;
}

export interface AbotbashoConfig {
  project: ProjectMeta;
  primary: PrimaryContract;
  wrapper?: WrapperContract;
  messages?: ProjectMessages;
  /** ms between indexer polls. Default 10000. Set to 0 to disable polling. */
  pollIntervalMs?: number;
  /** IPFS gateway used to resolve token images. Default https://ipfs.io/ipfs/. */
  ipfsGateway?: string;
  /**
   * Optional string prepended to the title line of every tweet
   * (e.g. an emoji or short brand mark). Has no effect on Discord.
   */
  tweetPrefix?: string;
  /**
   * Block explorer base URL used for `/tx/<hash>` and `/address/<addr>`
   * links in Discord embeds and tweets. Default https://etherscan.io.
   * Set to https://basescan.org, https://polygonscan.com, etc. for other
   * chains.
   */
  explorerUrl?: string;
  /**
   * NFT-holder verification feature. When enabled, indexer exposes /verify
   * routes and the discord plugin reconciles a holder role.
   */
  verify?: VerifyConfig;
  /**
   * Per-plugin configuration, keyed by plugin name. Each plugin owns its
   * own slice and validates it on init. Use the `pluginConfig<T>(name)`
   * helper from this package to read a typed slice at runtime.
   */
  plugins?: Record<string, unknown>;
}

const CONFIG_FILENAME = "abotbasho.config.ts";

let cached: AbotbashoConfig | null = null;

const findConfigPath = (): string => {
  const override = process.env.ABOTBASHO_CONFIG_PATH;
  if (override) {
    if (!existsSync(override)) {
      throw new Error(`ABOTBASHO_CONFIG_PATH points to a missing file: ${override}`);
    }
    return override;
  }
  let dir = process.cwd();
  for (let i = 0; i < 20; i++) {
    const candidate = resolve(dir, CONFIG_FILENAME);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(
    `could not locate ${CONFIG_FILENAME}; create it at the project root or set ABOTBASHO_CONFIG_PATH`,
  );
};

const validate = (cfg: unknown): AbotbashoConfig => {
  if (!cfg || typeof cfg !== "object") {
    throw new Error("config must be an object exported as default");
  }
  const c = cfg as Partial<AbotbashoConfig>;
  if (!c.project?.name) throw new Error("config.project.name is required");
  if (!c.primary?.label || !c.primary.address || c.primary.deployBlock === undefined) {
    throw new Error("config.primary {label, address, deployBlock} is required");
  }
  if (c.wrapper) {
    if (!c.wrapper.label || !c.wrapper.address || c.wrapper.deployBlock === undefined) {
      throw new Error("config.wrapper {label, address, deployBlock} is required when set");
    }
    if (c.wrapper.label === c.primary.label) {
      throw new Error("config.wrapper.label must differ from config.primary.label");
    }
  }
  if (c.verify?.enabled) {
    if (!c.verify.roleId) throw new Error("config.verify.roleId is required when verify is enabled");
    if (!c.verify.publicUrl) throw new Error("config.verify.publicUrl is required when verify is enabled");
    if (c.verify.openseaBio && !c.verify.openseaSlug) {
      throw new Error("config.verify.openseaSlug is required when verify.openseaBio is true");
    }
  }
  return c as AbotbashoConfig;
};

export const loadConfig = async (): Promise<AbotbashoConfig> => {
  if (cached) return cached;
  const path = findConfigPath();
  const mod = (await import(pathToFileURL(path).href)) as { default?: unknown };
  cached = validate(mod.default);
  return cached;
};

export const getProjectConfig = (): AbotbashoConfig => {
  if (!cached) {
    throw new Error("project config not loaded; call await loadConfig() first");
  }
  return cached;
};

export const defineConfig = (cfg: AbotbashoConfig): AbotbashoConfig => cfg;

export const displayNameOf = (
  contract: PrimaryContract | WrapperContract,
): string => contract.displayName ?? contract.label;

export const pluginConfig = <T>(name: string): T | undefined =>
  getProjectConfig().plugins?.[name] as T | undefined;

export const DEFAULT_POLL_INTERVAL_MS = 10_000;
export const DEFAULT_IPFS_GATEWAY = "https://ipfs.io/ipfs/";
export const DEFAULT_RSS_POLL_INTERVAL_MS = 5 * 60 * 1000;
export const DEFAULT_VERIFY_POLL_INTERVAL_MS = 5_000;
