const DEFAULT_SITE_URL = "https://meet.gdmn.app";

export function getSiteUrl() {
  const configuredUrl = process.env.NEXT_PUBLIC_HOME?.trim();

  try {
    return new URL(configuredUrl || DEFAULT_SITE_URL).toString().replace(/\/$/, "");
  } catch {
    return DEFAULT_SITE_URL;
  }
}