import { parseMyUploads, parseUpload } from "./uploads";

const upload = { id: 4, name: "mare.mp4", title: "Al mare", size: 10, received: 3 };

describe("parseUpload", () => {
  it("accepts an upload, with its video when finished", () => {
    expect(parseUpload(upload)).toEqual(upload);
    expect(parseUpload({ ...upload, received: 10, video: 7 })).toEqual({
      ...upload,
      received: 10,
      video: 7,
    });
  });

  it.each([
    ["null", null],
    ["zero id", { ...upload, id: 0 }],
    ["no name", { ...upload, name: "" }],
    ["no title", { ...upload, title: "" }],
    ["empty", { ...upload, size: 0 }],
    ["more than the size", { ...upload, received: 11 }],
    ["negative", { ...upload, received: -1 }],
    ["bad video", { ...upload, video: 0 }],
  ])("rejects %s", (_label, data) => {
    expect(() => parseUpload(data)).toThrow();
  });
});

describe("parseMyUploads", () => {
  const space = { quota: 100, used: 20, reserved: 10 };

  it("accepts my space and uploads", () => {
    expect(parseMyUploads({ space, uploads: [upload] })).toEqual({ space, uploads: [upload] });
  });

  it.each([
    ["no space", { uploads: [] }],
    ["bad quota", { space: { ...space, quota: -1 }, uploads: [] }],
    ["no list", { space }],
  ])("rejects %s", (_label, data) => {
    expect(() => parseMyUploads(data)).toThrow();
  });
});
