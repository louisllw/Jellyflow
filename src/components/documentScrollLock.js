const LOCKED_BODY_STYLES = ["overflow", "position", "top", "left", "right", "width", "paddingRight"];

export function lockDocumentScroll(doc = document, win = window) {
  const body = doc.body;
  const root = doc.documentElement;
  const scrollY = win.scrollY || win.pageYOffset || 0;
  const previousBody = Object.fromEntries(LOCKED_BODY_STYLES.map((property) => [property, body.style[property]]));
  const previousRootOverflow = root.style.overflow;
  const scrollbarWidth = Math.max(0, win.innerWidth - root.clientWidth);
  const bodyPadding = Number.parseFloat(win.getComputedStyle?.(body)?.paddingRight || "0") || 0;

  root.style.overflow = "hidden";
  body.style.overflow = "hidden";
  body.style.position = "fixed";
  body.style.top = `-${scrollY}px`;
  body.style.left = "0";
  body.style.right = "0";
  body.style.width = "100%";
  if (scrollbarWidth) body.style.paddingRight = `${bodyPadding + scrollbarWidth}px`;

  return () => {
    root.style.overflow = previousRootOverflow;
    LOCKED_BODY_STYLES.forEach((property) => {
      body.style[property] = previousBody[property];
    });
    win.scrollTo(0, scrollY);
  };
}
