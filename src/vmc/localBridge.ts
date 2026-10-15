/** Where the downloadable bridge listens. Loopback only, so an HTTPS page is allowed to connect. */
export const LOCAL_BRIDGE_HTTP = 'http://127.0.0.1:8787';
export const LOCAL_BRIDGE_WS = 'ws://127.0.0.1:8787/ws';

const RELEASE = 'https://github.com/CCavins/VMC_app/releases/latest/download';

export interface BridgeDownload {
  id: 'mac-arm64' | 'mac-x64' | 'win';
  label: string;
  href: string;
}

export const BRIDGE_DOWNLOADS: BridgeDownload[] = [
  { id: 'mac-arm64', label: 'Mac (Apple silicon)', href: `${RELEASE}/VMC-Bridge-mac-arm64.zip` },
  { id: 'mac-x64', label: 'Mac (Intel)', href: `${RELEASE}/VMC-Bridge-mac-x64.zip` },
  { id: 'win', label: 'Windows', href: `${RELEASE}/VMC-Bridge-windows-x64.zip` },
];

/** Best-guess download for this browser. Apple silicon is the Mac default. */
export function suggestedBridgeDownload(): BridgeDownload {
  const ua = navigator.userAgent;
  const platform = navigator.platform || '';
  const apple = /Mac|iPhone|iPad/.test(platform) || /Mac OS X/.test(ua);
  if (/Win/.test(platform) || /Windows/.test(ua)) return BRIDGE_DOWNLOADS[2];
  if (apple && /Intel/.test(ua)) return BRIDGE_DOWNLOADS[1];
  if (apple) return BRIDGE_DOWNLOADS[0];
  return BRIDGE_DOWNLOADS[2];
}
