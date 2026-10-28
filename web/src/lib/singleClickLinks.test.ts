import { installSingleClickLinks } from "./singleClickLinks";

describe("installSingleClickLinks", () => {
  let remove = () => {};
  afterEach(() => {
    remove();
    document.body.innerHTML = "";
  });

  function click(element: Element, detail: number) {
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, detail });
    element.dispatchEvent(event);
    return event.defaultPrevented;
  }

  it("lets the first click of a link through and stops the second", () => {
    remove = installSingleClickLinks();
    document.body.innerHTML = `<a href="/categorie"><span>Categorie</span></a>`;
    const inside = document.querySelector("span") as Element;

    expect(click(inside, 1)).toBe(false);
    expect(click(inside, 2)).toBe(true);
  });

  it("leaves double clicks elsewhere alone, like the player's", () => {
    remove = installSingleClickLinks();
    document.body.innerHTML = `<div id="player"></div>`;

    expect(click(document.getElementById("player") as Element, 2)).toBe(false);
  });
});
