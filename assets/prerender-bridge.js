/* Keep the readable static page until the original interactive component is ready.
   The source template is inert and delivered equally to every visitor and crawler. */
(() => {
  const source = document.getElementById('nb-template');
  const snapshot = document.getElementById('nb-static');
  if (!source || !snapshot) return;
  const component = document.createElement('x-dc');
  component.innerHTML = source.innerHTML;
  snapshot.after(component);
  const observer = new MutationObserver(() => {
    const root = document.getElementById('dc-root');
    if (root?.querySelector('h1')?.textContent.trim()) {
      root.setAttribute("role", "main");
      snapshot.remove();
      document.documentElement.classList.remove('nb-prerender');
      observer.disconnect();
    }
  });
  observer.observe(document.body, {childList:true, subtree:true});
})();
