import { parseComments } from "./comments";

const comment = (over: Record<string, unknown> = {}) => ({
  id: 1,
  author: { id: 2, name: "Giulia", avatar: 0 },
  body: "Che bello!",
  createdAt: "2026-10-12T09:00:00Z",
  canDelete: false,
  replies: [],
  ...over,
});

describe("parseComments", () => {
  it("accepts conversations with replies", () => {
    const got = parseComments([comment({ replies: [comment({ id: 3, canDelete: true })] })]);
    expect(got).toEqual([
      {
        id: 1,
        author: { id: 2, name: "Giulia", avatar: 0 },
        body: "Che bello!",
        createdAt: new Date("2026-10-12T09:00:00Z"),
        canDelete: false,
        replies: [
          {
            id: 3,
            author: { id: 2, name: "Giulia", avatar: 0 },
            body: "Che bello!",
            createdAt: new Date("2026-10-12T09:00:00Z"),
            canDelete: true,
            replies: [],
          },
        ],
      },
    ]);
  });

  it.each([
    ["not a list", { comments: [] }],
    ["no id", [comment({ id: 0 })]],
    ["no author", [comment({ author: null })]],
    ["empty body", [comment({ body: "" })]],
    ["bad date", [comment({ createdAt: "ieri" })]],
    ["no canDelete", [comment({ canDelete: undefined })]],
    ["no replies", [comment({ replies: null })]],
    ["replies to a reply", [comment({ replies: [comment({ replies: [comment()] })] })]],
  ])("refuses %s", (_, data) => {
    expect(() => parseComments(data)).toThrow();
  });
});
