import dns from "node:dns";
import net from "node:net";

/**
 * Reaching the server when some of the addresses a name resolves to do not answer.
 *
 * The server is on Cloudflare (a *.pages.dev name). The address the shop's own DNS gives for it changes from one lookup to the next, and on some providers a share of
 * them never answers (the connection just times out), while others work and while the same name resolved by 1.1.1.1 gives addresses that do. So the server is "sometimes
 * unreachable": it depends on which pair of addresses came back. Two things make that harmless:
 *   - the addresses of the name are the ones the system gave AND the ones 1.1.1.1 gives (the system's first; if the system's DNS fails altogether, only the others),
 *   - a connection that has not been made after a couple of seconds goes on to the next address instead of waiting for the first to give up.
 * Names that are already addresses, and "localhost", are left alone.
 */
export const ATTEMPT_TIMEOUT_MS = 2000;
const EXTRA_RESOLVERS = ["1.1.1.1", "1.0.0.1"];
const RESOLVER_TIMEOUT_MS = 1500;
const CACHE_MS = 2 * 60_000;

type Found = { address: string; family: number };

/** The addresses of `first`, then those of `second` that are not in it. */
export function mergeAddresses(first: Found[], second: Found[]): Found[] {
  const seen = new Set(first.map((a) => a.address));
  return [...first, ...second.filter((a) => !seen.has(a.address))];
}

const cache = new Map<string, { at: number; found: Found[] }>();

/** What 1.1.1.1 says for a name (IPv4), kept for two minutes; an empty list when it cannot be asked (the system's answer is then the only one). */
async function resolveWithResolvers(hostname: string): Promise<string[]> {
  const resolver = new dns.promises.Resolver({ timeout: RESOLVER_TIMEOUT_MS, tries: 1 });
  resolver.setServers(EXTRA_RESOLVERS);
  try {
    return await resolver.resolve4(hostname);
  } catch {
    return [];
  }
}

export interface InstallOptions {
  /** The extra addresses of a name (IPv4); the default asks 1.1.1.1. Tests give their own. */
  extra?: (hostname: string) => Promise<string[]>;
}

let installed = false;

export function installResilientLookup(options: InstallOptions = {}): void {
  if (installed) return;
  installed = true;
  const extra = options.extra ?? resolveWithResolvers;
  const original = dns.lookup;

  const systemLookup = (hostname: string, opts: dns.LookupOptions): Promise<Found[]> =>
    new Promise((resolve) => {
      (original as (h: string, o: dns.LookupOptions, cb: (err: Error | null, addresses: dns.LookupAddress[]) => void) => void)(hostname, { ...opts, all: true }, (err, addresses) => resolve(err ? [] : addresses.map((a) => ({ address: a.address, family: a.family }))));
    });

  const patched = function (hostname: string, a: unknown, b?: unknown): void {
    const callback = (typeof a === "function" ? a : b) as (...args: unknown[]) => void;
    const raw = typeof a === "function" || a === undefined ? {} : a;
    const opts: dns.LookupOptions = typeof raw === "number" ? { family: raw } : { ...(raw as dns.LookupOptions) };
    if (typeof hostname !== "string" || hostname === "" || hostname === "localhost" || net.isIP(hostname) !== 0) {
      (original as (...args: unknown[]) => void)(hostname, a, b);
      return;
    }
    void (async () => {
      const cached = cache.get(hostname);
      const [system, more] = await Promise.all([
        systemLookup(hostname, opts),
        cached && Date.now() - cached.at < CACHE_MS ? Promise.resolve(cached.found) : Promise.resolve(opts.family === 6 ? [] : extra(hostname)).then((list) => list.map((address) => ({ address, family: 4 }))),
      ]);
      if (!cached || Date.now() - cached.at >= CACHE_MS) cache.set(hostname, { at: Date.now(), found: more });
      const found = mergeAddresses(system, more);
      if (found.length === 0) {
        const error = Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND", errno: -3008, syscall: "getaddrinfo", hostname });
        callback(error);
      } else if (opts.all) callback(null, found);
      else callback(null, found[0].address, found[0].family);
    })();
  };
  (dns as { lookup: unknown }).lookup = patched;

  // a connection that is not made after a short time goes on to the next address of the list
  net.setDefaultAutoSelectFamily(true);
  net.setDefaultAutoSelectFamilyAttemptTimeout(ATTEMPT_TIMEOUT_MS);
}
