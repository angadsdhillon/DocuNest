import { Readable } from 'node:stream';

import NodeClam from 'clamscan';

import { getWorkerEnvironment } from '../env';
import { logWarn } from '../logger';

export type VirusScanResult =
  | { scanned: true; infected: boolean; viruses: string[] }
  | { scanned: false; reason: string };

let cachedScannerPromise: Promise<NodeClam> | null = null;

/**
 * Connects to a `clamd` daemon over TCP — run as a sidecar process next to
 * the worker (`clamd` listening on `CLAMAV_HOST:CLAMAV_PORT`), never a
 * bundled binary — so scanning works the same way in a container next to
 * the worker in production as it does against a locally-run `clamd` in
 * development.
 */
function getScanner(): Promise<NodeClam> {
  if (cachedScannerPromise) {
    return cachedScannerPromise;
  }

  const environment = getWorkerEnvironment();

  cachedScannerPromise = new NodeClam().init({
    removeInfected: false,
    clamdscan: {
      host: environment.CLAMAV_HOST,
      port: environment.CLAMAV_PORT,
      socket: false,
      timeout: 60_000,
      localFallback: false,
    },
    preference: 'clamdscan',
  });

  return cachedScannerPromise;
}

/**
 * Scans decrypted document bytes for malware before anything else touches
 * them. Never writes the buffer to disk — streams it straight into the
 * `clamd` connection.
 *
 * KNOWN LOCAL-DEV GAP: this environment has no ClamAV daemon and no Docker
 * available to run one as a sidecar. When `clamd` cannot be reached:
 *   - In production (`NODE_ENV=production`), this throws, so the job fails
 *     rather than silently treating an unscanned file as safe.
 *   - Outside production, it logs a loud warning and reports
 *     `{ scanned: false }` so local development isn't permanently blocked.
 *     The caller treats `scanned: false` as "not infected" ONLY outside
 *     production. Before this goes anywhere near real user files in
 *     production, a real `clamd` sidecar must be wired up and
 *     `CLAMAV_HOST`/`CLAMAV_PORT` pointed at it — see the phase summary for
 *     the exact deployment shape (a ClamAV container next to the worker on
 *     Fly.io/Railway).
 */
export async function scanBufferForViruses(
  buffer: Buffer,
): Promise<VirusScanResult> {
  const environment = getWorkerEnvironment();

  if (!environment.CLAMAV_ENABLED) {
    logWarn(
      'Virus scanning is disabled via CLAMAV_ENABLED=false — treating file as unscanned.',
    );
    return { scanned: false, reason: 'disabled' };
  }

  try {
    const scanner = await getScanner();
    const { isInfected, viruses } = await scanner.scanStream(
      Readable.from(buffer),
    );

    return {
      scanned: true,
      infected: isInfected === true,
      viruses: viruses ?? [],
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    if (environment.NODE_ENV === 'production') {
      throw new Error(`ClamAV scan failed in production: ${reason}`);
    }

    logWarn(
      `ClamAV is unreachable — skipping virus scan (dev-only fallback; this MUST be fixed before production). Reason: ${reason}`,
    );
    return { scanned: false, reason };
  }
}
