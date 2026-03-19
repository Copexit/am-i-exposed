import { Command } from "commander";
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { initEntityFilter } from "./adapters/entity-loader";
import { scanTx } from "./commands/scan-tx";
import { scanAddress } from "./commands/scan-address";
import { scanXpub } from "./commands/scan-xpub";
import { scanPsbt } from "./commands/scan-psbt";
import { boltzmann } from "./commands/boltzmann";
import { chainTrace } from "./commands/chain-trace";

const dir = typeof __dirname !== "undefined"
  ? __dirname
  : dirname(fileURLToPath(import.meta.url));

// Read version from package.json if available, fall back to hardcoded
function getVersion(): string {
  const pkgPath = join(dir, "..", "package.json");
  if (existsSync(pkgPath)) {
    try {
      return JSON.parse(readFileSync(pkgPath, "utf-8")).version;
    } catch { /* fall through */ }
  }
  return "0.34.3";
}
const version = getVersion();

const program = new Command();

program
  .name("am-i-exposed")
  .description(
    "Bitcoin privacy scanner - analyze transactions, addresses, and wallets for chain analysis exposure",
  )
  .version(version)
  .option("--json", "Output structured JSON (suppresses spinner and colors)")
  .option(
    "--network <net>",
    "Network: mainnet, testnet4, or signet",
    "mainnet",
  )
  .option("--api <url>", "Custom mempool API URL")
  .option("--no-color", "Disable colored output")
  .option("--no-entities", "Skip entity filter loading (faster startup)")
  .option("--no-cache", "Disable SQLite response caching");

// ---- scan <subcommand> ----

const scan = program.command("scan").description("Scan a Bitcoin artifact");

scan
  .command("tx <txid>")
  .description("Analyze a transaction for privacy exposure")
  .option("--fast", "Skip parent tx and output address fetching (faster, less context)")
  .option(
    "--chain-depth <N>",
    "Include chain analysis up to N hops (0 = tx-only)",
    "0",
  )
  .option(
    "--min-sats <N>",
    "Minimum satoshi value to follow when tracing",
    "1000",
  )
  .action(async (txid: string, opts: Record<string, string>) => {
    await run(() => scanTx(txid, mergeOpts(opts)));
  });

scan
  .command("address <addr>")
  .alias("addr")
  .description("Analyze an address for privacy exposure")
  .action(async (addr: string, opts: Record<string, string>) => {
    await run(() => scanAddress(addr, mergeOpts(opts)));
  });

scan
  .command("xpub <descriptor>")
  .description(
    "Wallet-level privacy audit via xpub, zpub, or output descriptor",
  )
  .option("--gap-limit <N>", "Consecutive unused addresses before stopping", "20")
  .action(async (descriptor: string, opts: Record<string, string>) => {
    await run(() => scanXpub(descriptor, mergeOpts(opts)));
  });

scan
  .command("psbt <input>")
  .description("Analyze an unsigned transaction (PSBT) before broadcasting")
  .action(async (input: string, opts: Record<string, string>) => {
    await run(() => scanPsbt(input, mergeOpts(opts)));
  });

// ---- top-level commands ----

program
  .command("boltzmann <txid>")
  .description(
    "Compute Boltzmann entropy and link probability matrix for a transaction",
  )
  .option("--timeout <seconds>", "Maximum computation time", "300")
  .option(
    "--intrafees-ratio <float>",
    "Max CoinJoin intrafees ratio",
    "0.005",
  )
  .action(async (txid: string, opts: Record<string, string>) => {
    await run(() => boltzmann(txid, mergeOpts(opts)));
  });

program
  .command("chain-trace <txid>")
  .description("Multi-hop transaction graph analysis")
  .option(
    "--direction <dir>",
    "Trace direction: backward, forward, or both",
    "both",
  )
  .option("--depth <N>", "Maximum hops to trace", "3")
  .option(
    "--min-sats <N>",
    "Minimum satoshi value to follow (filters dust)",
    "1000",
  )
  .option("--skip-coinjoins", "Stop tracing at CoinJoin transactions")
  .action(async (txid: string, opts: Record<string, string>) => {
    await run(() => chainTrace(txid, mergeOpts(opts)));
  });

// ---- MCP server ----

program
  .command("mcp")
  .description("Start MCP (Model Context Protocol) server on stdio")
  .action(async () => {
    const { startMcpServer } = await import("./mcp/server");
    await startMcpServer();
  });

// ---- cache management ----

const cache = program
  .command("cache")
  .description("Manage the API response cache");

cache
  .command("stats")
  .description("Show cache statistics")
  .action(async () => {
    const { cacheStats } = await import("./adapters/sqlite-cache");
    const stats = cacheStats();
    const sizeMB = (stats.sizeBytes / 1024 / 1024).toFixed(2);
    const age = stats.oldestAt
      ? `${Math.round((Date.now() - stats.oldestAt) / 1000 / 60)} min ago`
      : "n/a";
    if (program.opts().json) {
      console.log(JSON.stringify(stats, null, 2));
    } else {
      console.log(`Entries:  ${stats.entries}`);
      console.log(`Expired: ${stats.expired}`);
      console.log(`Size:    ${sizeMB} MB`);
      console.log(`Oldest:  ${age}`);
    }
  });

cache
  .command("clear")
  .description("Purge all cached API responses")
  .action(async () => {
    const { cacheClear, cacheClose } = await import("./adapters/sqlite-cache");
    cacheClear();
    cacheClose();
    console.log("Cache cleared.");
  });

// ---- helpers ----

export interface GlobalOpts {
  json?: boolean;
  network: string;
  api?: string;
  entities: boolean;
  cache: boolean;
  color: boolean;
  // command-specific (merged in)
  [key: string]: unknown;
}

/** Merge command-level opts with global program opts. */
function mergeOpts(commandOpts: Record<string, string>): GlobalOpts {
  const global = program.opts();
  return { ...global, ...commandOpts } as unknown as GlobalOpts;
}

/** Wrap command execution with entity init and error handling. */
async function run(fn: () => Promise<void>): Promise<void> {
  try {
    const opts = program.opts() as GlobalOpts;

    // Initialize entity filter unless --no-entities
    if (opts.entities !== false) {
      await initEntityFilter();
    }

    await fn();
  } catch (err) {
    const opts = program.opts() as GlobalOpts;
    if (opts.json) {
      console.log(
        JSON.stringify({
          error: true,
          message: err instanceof Error ? err.message : String(err),
        }),
      );
    } else {
      console.error(
        `Error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    process.exit(1);
  }
}

program.parse();
