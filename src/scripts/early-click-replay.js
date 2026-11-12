// Islands render as static HTML until their JavaScript loads, so a click on a control in that gap does
// nothing. Hold every such click and replay them in order after the island hydrates. Each replay waits a
// frame so the island renders the previous click before the next one reads its state.
(() => {
  const controls =
    'button, label, [role="button"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], input[type="checkbox"], input[type="radio"]';
  const pending = new WeakMap();
  let replaying = false;

  // Tests and styles read `data-hydrated` to know an island responds to input and has applied every held click.
  document.addEventListener(
    'astro:hydrate',
    (event) => {
      const island = event.target;
      if (!(island instanceof Element)) return;
      const queue = pending.get(island);
      const replay = () => {
        const held = queue?.shift();
        if (!held) {
          pending.delete(island);
          island.setAttribute('data-hydrated', '');
          return;
        }
        if (held.isConnected) {
          replaying = true;
          try {
            held.click();
          } finally {
            replaying = false;
          }
        }
        requestAnimationFrame(replay);
      };
      requestAnimationFrame(replay);
    },
    true,
  );

  document.addEventListener(
    'click',
    (event) => {
      if (replaying || !(event.target instanceof Element)) return;
      const control = event.target.closest(controls);
      const island = control?.closest('astro-island');
      // Clicks during the replay join the queue so they still apply after every earlier click.
      if (!control || !island || !(island.hasAttribute('ssr') || pending.has(island))) return;
      if (control instanceof HTMLLabelElement && !/^(checkbox|radio)$/.test(control.control?.type ?? ''))
        return;
      event.preventDefault();
      event.stopImmediatePropagation();

      const queue = pending.get(island) ?? [];
      pending.set(island, queue);
      queue.push(control);
    },
    true,
  );
})();
