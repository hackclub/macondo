// a leftover proxy on the old cluster serves hack.club/macondo unstyled; redirect shortener hosts.
// the "0." prefix runs this before 0.referral-capture.ts so shortener hits skip analytics and cookies.
const SHORTENER_HOST = /(^|\.)hack\.(club|af)$/i;

export default defineEventHandler((event) => {
  const host = (getHeader(event, "x-forwarded-host") ?? getHeader(event, "host") ?? "")
    .split(",")[0]!.trim().split(":")[0]!;
  if (!SHORTENER_HOST.test(host)) return;
  return sendRedirect(event, "https://macondo.hackclub.com" + event.path, 301);
});
