// Drawing the chosen part of a picture as a cover: the part that needs a
// real browser (images and canvas).

import { output, type Rect } from "./coverCrop";

// renderCover draws the chosen part of the picture as a JPEG the size of
// output (16:9), ready to send.
export function renderCover(url: string, rect: Rect): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = output.width;
      canvas.height = output.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("cover: no canvas"));
        return;
      }
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(
        img,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        0,
        0,
        output.width,
        output.height,
      );
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("cover: nothing drawn"))),
        "image/jpeg",
        0.9,
      );
    };
    img.onerror = () => reject(new Error("cover: the picture is gone"));
    img.src = url;
  });
}
