// teller.ink — the brochure's only script: the copy buttons.
//
// The page is complete without it (the buttons stay hidden until this
// file marks the document), and it talks to nobody. `navigator.clipboard`
// needs a secure context, which teller.ink is; where it's refused anyway
// the command gets selected instead, so the keyboard shortcut still works.
document.documentElement.classList.add('js');

document.addEventListener('click', async (event) => {
  const button = event.target instanceof Element ? event.target.closest('[data-copy]') : null;
  if (!button) return;
  const text = button.getAttribute('data-copy') ?? '';
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch {
    const target = document.getElementById(button.getAttribute('data-select') ?? '');
    if (target) {
      const range = document.createRange();
      range.selectNodeContents(target);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    }
  }
  const label = button.textContent;
  button.textContent = copied ? 'Copied' : 'Selected';
  button.classList.add('done');
  setTimeout(() => {
    button.textContent = label;
    button.classList.remove('done');
  }, 1600);
});
