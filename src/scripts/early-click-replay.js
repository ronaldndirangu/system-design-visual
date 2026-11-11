// Islands render as static HTML until their JavaScript loads, so a click on a control in that gap does
// nothing. Hold those clicks and replay each clicked control once after its island hydrates.
(() => {
  const controls =
    'button, [role="button"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], input[type="checkbox"], input[type="radio"]';
  const pending = new WeakMap();

  document.addEventListener(
    'click',
    (event) => {
      if (!(event.target instanceof Element)) return;
      const control = event.target.closest(controls);
      const island = control?.closest('astro-island');
      if (!control || !island?.hasAttribute('ssr')) return;
      event.preventDefault();
      event.stopImmediatePropagation();

      let queue = pending.get(island);
      if (!queue) {
        queue = [];
        pending.set(island, queue);
        island.addEventListener(
          'astro:hydrate',
          () => {
            requestAnimationFrame(() => {
              for (const held of queue) if (held.isConnected) held.click();
            });
          },
          { once: true },
        );
      }
      if (!queue.includes(control)) queue.push(control);
    },
    true,
  );
})();
