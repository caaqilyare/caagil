/**
 * SSL health for hosted domains: live TLS probes through Traefik and a
 * Let's Encrypt re-issuance flow (cPanel-style "Add SSL").
 */
import tls from "node:tls";
import dns from "node:dns/promises";
import { getSetting } from "./db";
import { detectPublicIp } from "./edge";

export type SslProbe = {
  ok: boolean;
  /** Certificate issuer organisation, e.g. "Let's Encrypt". */
  issuer?: string;
  /** Expiry as epoch ms. */
  expiresAt?: number;
  /** Traefik served its fallback self-signed certificate. */
  selfSigned?: boolean;
  /** Why the probe failed (when !ok). */
  reason?: string;
};

/**
 * Open a TLS connection through the local Traefik with the domain as SNI and
 * inspect the certificate the browser would actually see.
 */
export async function probeDomain(domain: string, timeoutMs = 6000): Promise<SslProbe> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (result: SslProbe) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };

    try {
      const socket = tls.connect({
        host: process.env.TRAEFIK_SNI_HOST || "traefik",
        port: 443,
        servername: domain,
        rejectUnauthorized: false, // inspected manually below
        timeout: timeoutMs,
      });

      socket.on("secureConnect", () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        if (!cert || Object.keys(cert).length === 0) {
          return done({ ok: false, reason: "no certificate presented" });
        }
        const cn = (cert.subject?.CN as string) || "";
        const issuer = (cert.issuer?.O as string) || (cert.issuer?.CN as string) || "unknown";
        const expiresAt = cert.valid_to ? new Date(cert.valid_to).getTime() : 0;

        if (/traefik default/i.test(cn)) {
          return done({
            ok: false,
            selfSigned: true,
            issuer,
            reason: "no certificate issued for this domain yet",
          });
        }

        const altNames = (cert.subjectaltname || "")
          .split(",")
          .map((s) => s.replace(/^DNS:/i, "").trim())
          .filter(Boolean);
        const covers =
          cn === domain ||
          altNames.includes(domain) ||
          altNames.some((a) => a.startsWith("*.") && domain.endsWith(a.slice(1)));

        if (!covers) {
          return done({
            ok: false,
            issuer,
            expiresAt,
            reason: `the certificate is for ${cn || altNames.join(", ") || "another domain"}, not ${domain}`,
          });
        }
        done({ ok: true, issuer, expiresAt });
      });

      socket.on("error", (err) => done({ ok: false, reason: err.message }));
      socket.on("timeout", () => {
        socket.destroy();
        done({ ok: false, reason: "TLS handshake timed out" });
      });
    } catch (err) {
      done({ ok: false, reason: err instanceof Error ? err.message : String(err) });
    }
  });
}

/** Resolve a host and compare against the server's public IP. */
export async function dnsPointsHere(
  domain: string,
  expectedIp: string | null,
): Promise<{ ok: boolean; resolved: boolean; found: string[]; expected: string | null }> {
  if (!expectedIp) return { ok: false, resolved: false, found: [], expected: null };
  try {
    const found = await dns.resolve4(domain);
    return { ok: found.includes(expectedIp), resolved: true, found, expected: expectedIp };
  } catch {
    return { ok: false, resolved: false, found: [], expected: expectedIp };
  }
}

/** The IP we expect domains to point at (Settings value, auto-detected fallback). */
export async function expectedPublicIp(): Promise<string | null> {
  const saved = await getSetting("public_ip");
  if (saved?.trim()) return saved.trim();
  return detectPublicIp();
}
