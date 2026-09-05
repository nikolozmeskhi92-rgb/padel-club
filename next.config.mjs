import { withContentlayer } from "next-contentlayer2";

/**
 * Now on Next 15.5.x, which carries the fixes that no 14.x release ever got.
 * `npm audit` no longer flags `next` at all.
 *
 * Two hardening decisions from the 14.x days are deliberately kept, because
 * they are correct on their own merits and not just advisory mitigations:
 *
 *   - No `images.remotePatterns`. It previously allowed ANY https host
 *     (`hostname: "**"`), which turns /_next/image into an open image proxy:
 *     anyone can push arbitrary remote images through the deployment, burning
 *     bandwidth and filling the optimizer's disk cache. Nothing in the app
 *     imports next/image, so the whole surface stays dropped. If remote images
 *     are ever needed, list the specific hosts here — never a wildcard.
 *
 *   - No raised `serverActions.bodySizeLimit`. It used to be set to "2mb",
 *     doubling the default 1 MB cap. No route uses Server Actions ("use server"
 *     appears nowhere), so the raised ceiling bought nothing.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  poweredByHeader: false,
};

export default withContentlayer(nextConfig);
