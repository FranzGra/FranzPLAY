// Reading a picture chosen by the person and drawing the cropped square:
// the parts that need a real browser (images and canvas).

import { outputSide } from "./crop";

export type LoadedPhoto = { url: string; width: number; height: number };

// loadPhoto opens a picture file. Call URL.revokeObjectURL(url) when done.
export function loadPhoto(file: Blob): Promise<LoadedPhoto> {
  const url = URL.createObjectURL(file);
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ url, width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("photo: the browser cannot read this picture"));
    };
    img.src = url;
  });
}

// renderCrop draws the chosen square of the photo as a JPEG, outputSide
// pixels a side.
export function renderCrop(
  url: string,
  rect: { x: number; y: number; side: number },
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = outputSide;
      canvas.height = outputSide;
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error("photo: no canvas"));
        return;
      }
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, rect.x, rect.y, rect.side, rect.side, 0, 0, outputSide, outputSide);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("photo: nothing drawn"))),
        "image/jpeg",
        0.9,
      );
    };
    img.onerror = () => reject(new Error("photo: the picture is gone"));
    img.src = url;
  });
}
