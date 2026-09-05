import { withContentlayer } from "next-contentlayer2";

/**
 * Next 14.x has no patched release: every current advisory's fix range ends in
 * 15.5.x, so staying on 14 means carrying them. Upgrading to 15.5.x is the real
 * fix and is tracked separately (it needs React 19, and pulls framer-motion,
 * recharts and radix along with it).
 *
 * In the meantime this config removes the two features that make most of those
 * advisories actually reachable here — neither of which the app uses:
 *
 *   - `images.remotePatterns` allowed ANY https host (`hostname: "**"`). That
 *     turns /_next/image into an open image proxy: anyone can push arbitrary
 *     remote images through the deployment, burning bandwidth and filling the
 *     optimizer's disk cache. Several live advisories target exactly this.
 *     Nothing in the app imports next/image, so the whole surface is dropped.
 *     If remote images are ever needed, list the specific hosts here — never
 *     a wildcard.
 *
 *   - `experimental.serverActions.bodySizeLimit: "2mb"` doubled the default
 *     1 MB cap on Server Action payloads. No route uses Server Actions
 *     ("use server" appears nowhere), so the raised ceiling bought nothing and
 *     widened the unbounded-payload advisory. Back to the default.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  poweredByHeader: false,
};

export default withContentlayer(nextConfig);
