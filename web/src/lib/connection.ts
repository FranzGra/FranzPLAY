// What the browser knows about its connection to the internet, through
// the Network Information API. Chrome, Edge and Android have it; Safari
// and Firefox do not.
type NetworkInformation = {
  saveData?: boolean; // the person asked to use less data
  effectiveType?: string; // "slow-2g", "2g", "3g" or "4g" (4g = anything fast)
  downlink?: number; // megabits a second, as the browser estimates
};

// minDownlink is the speed, in megabits a second, below which a
// connection is not good: a sharp clip of a card (about 0.5-1 MB) would
// take more than a second or two to arrive.
export const minDownlink = 5;

// goodConnection says whether the browser seems to be on a good
// connection, like the Wi-Fi at home: then the sharper version of things
// is worth downloading. When the browser does not say, the answer is yes:
// the sharp versions are small anyway.
export function goodConnection(): boolean {
  return isGood((navigator as Navigator & { connection?: NetworkInformation }).connection);
}

// savesData says whether the person asked the browser to use less data.
export function savesData(): boolean {
  return (
    (navigator as Navigator & { connection?: NetworkInformation }).connection?.saveData === true
  );
}

// isGood is goodConnection's decision, on what the browser said.
export function isGood(connection: NetworkInformation | undefined): boolean {
  if (connection === undefined) return true;
  if (connection.saveData === true) return false;
  if (connection.effectiveType !== undefined && connection.effectiveType !== "4g") return false;
  if (typeof connection.downlink === "number" && connection.downlink > 0) {
    return connection.downlink >= minDownlink;
  }
  return true;
}
