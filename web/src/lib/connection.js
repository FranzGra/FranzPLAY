// minDownlink is the speed, in megabits a second, below which a
// connection is not good: a sharp clip of a card (about 0.5-1 MB) would
// take more than a second or two to arrive.
export const minDownlink = 5;
// goodConnection says whether the browser seems to be on a good
// connection, like the Wi-Fi at home: then the sharper version of things
// is worth downloading. When the browser does not say, the answer is yes:
// the sharp versions are small anyway.
export function goodConnection() {
    return isGood(navigator.connection);
}
// isGood is goodConnection's decision, on what the browser said.
export function isGood(connection) {
    if (connection === undefined)
        return true;
    if (connection.saveData === true)
        return false;
    if (connection.effectiveType !== undefined && connection.effectiveType !== "4g")
        return false;
    if (typeof connection.downlink === "number" && connection.downlink > 0) {
        return connection.downlink >= minDownlink;
    }
    return true;
}
