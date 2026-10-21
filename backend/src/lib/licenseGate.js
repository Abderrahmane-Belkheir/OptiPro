/**
 * A shop whose licence has ended (its `expiry` day is set and past) shows nothing on its public website: the reads (catalog, frames, accessories,
 * site info) answer 403 LICENSE_EXPIRED. A shop whose expiry is still empty (not registered yet) is shown, and so is a host no shop uses (its own
 * answers decide). Same as the Worker's (cloudflare/src/reads.js).
 *
 * `isHostExpired(host)` resolves to true when the shop at that host name has a past expiry.
 */
export function createLicenseGate({ isHostExpired }) {
  return async function licenseGate(req, res, next) {
    try {
      if (await isHostExpired(req.hostname)) {
        res.status(403).json({ error: "This shop's licence has expired.", code: 'LICENSE_EXPIRED' });
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}
