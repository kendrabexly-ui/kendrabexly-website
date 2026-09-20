(() => {
  document.addEventListener("submit", async event => {
    const form = event.target.closest(".footer-subscribe-form");
    if (!form) return;

    event.preventDefault();

    const email = form.elements.email;
    const button = form.querySelector('button[type="submit"]');
    const status = form.querySelector(".footer-subscribe-status");

    if (!form.reportValidity()) return;

    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    status.hidden = false;
    status.className = "footer-subscribe-status";
    status.textContent = "Joining…";

    try {
      const response = await fetch("/api/newsletter/subscribe", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json"
        },
        body: JSON.stringify({ email: email.value.trim() })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.ok) {
        throw new Error(data.message || "Unable to subscribe right now.");
      }

      status.classList.add("success");
      status.textContent = data.message || "You’re on the list. Thank you.";
      form.reset();
    } catch (error) {
      status.classList.add("error");
      status.textContent = error.message || "Unable to subscribe right now. Please try again.";
    } finally {
      button.disabled = false;
      button.removeAttribute("aria-busy");
    }
  });
})();
