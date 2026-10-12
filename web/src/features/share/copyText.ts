// copyText puts text in the clipboard. The modern way works only on https
// or on this computer; FranzPLAY at home often runs on plain http
// (http://192.168.1.10:8090), so there the older way is used: select the
// text in a hidden box and copy it.
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const box = document.createElement("textarea");
  box.value = text;
  box.setAttribute("readonly", "");
  box.style.position = "fixed";
  box.style.opacity = "0";
  document.body.append(box);
  try {
    box.focus();
    box.select();
    // execCommand is old but it is the only way without https.
    if (!document.execCommand("copy")) throw new Error("copy refused");
  } finally {
    box.remove();
  }
}
