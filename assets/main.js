(function () {
  const ctas = document.querySelectorAll("[data-cta]");

  ctas.forEach((cta) => {
    cta.addEventListener("click", () => {
      const name = cta.getAttribute("data-cta");
      window.dispatchEvent(new CustomEvent("neurobusiness:cta", { detail: { name } }));
      // Analytics Pixel: connect Meta, LinkedIn, Google Ads or Plausible here.
      // Example: window.plausible && window.plausible("CTA", { props: { name } });
    });
  });

  document.querySelectorAll("form[data-form]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const type = form.getAttribute("data-form");
      const message = form.querySelector("[data-form-message]");
      if (message) {
        message.textContent = "Danke. Dieses Formular ist vorbereitet und kann jetzt über den Cloudflare Worker in Supabase gespeichert werden.";
      }
      window.dispatchEvent(new CustomEvent("neurobusiness:form-submit", { detail: { type } }));
      // Cloudflare/Supabase: replace this placeholder with a POST to a Worker endpoint such as /api/funnel-lead.
      // Stripe-Checkout: add Checkout redirect through the existing Worker after qualification if needed.
    });
  });
})();
