(() => {
  const escapeHtml = value => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

  async function loadRates() {
    const menu = document.querySelector("[data-public-rates]");
    if (!menu) return;
    try {
      const response = await fetch("/api/public/rates", {
        headers: { "Accept": "application/json" }
      });
      const data = await response.json();
      if (!response.ok || !data.ok || !Array.isArray(data.services)) {
        throw new Error(data.message || "Unable to load rates.");
      }
      menu.innerHTML = data.services.map((service, index) => {
        const labels = ["PRIVATE INTRODUCTIONS", "BRIEF EXPERIENCES", "SIGNATURE EXPERIENCE", "ELEVATED EXPERIENCE"];
        const label = service.add_on ? "ADD-ON • UPSCALE LOCATIONS ONLY" : (labels[index] || "EXPERIENCE");
        const description = String(service.description || "");
        const paragraphs = description
          .split(/\n\s*\n/)
          .filter(Boolean)
          .map(text => "<p>" + escapeHtml(text) + "</p>")
          .join("");
        const rates = (service.rates || []).map(rate =>
          "<div><dt>" + escapeHtml(rate[0]) + "</dt><dd>$" +
          Number(rate[1] || 0).toLocaleString("en-US") + "</dd></div>"
        ).join("");
        return '<article class="rate-service">' +
          '<header class="rate-service-heading">' +
          '<div class="eyebrow">' + escapeHtml(label) + '</div>' +
          '<h2>' + escapeHtml(service.name) + '</h2>' +
          '<div class="service-description">' + paragraphs + '</div>' +
          '</header><dl class="rate-list">' + rates + '</dl></article>';
      }).join("");
    } catch (error) {
      console.error("Public rates failed to load:", error);
    }
  }

  async function loadGallery() {
    const gallery = document.querySelector("[data-public-gallery]");
    if (!gallery) return;
    try {
      const response = await fetch("/api/public/gallery", {
        headers: { "Accept": "application/json" }
      });
      const data = await response.json();
      if (!response.ok || !data.ok || !Array.isArray(data.images)) {
        throw new Error(data.message || "Unable to load gallery.");
      }
      const images = new Map(data.images.map(item => [Number(item.slot), item]));
      gallery.querySelectorAll("[data-photo-slot]").forEach(slot => {
        const number = Number(slot.dataset.photoSlot);
        const item = images.get(number);
        if (!item?.image_base64 || !item?.mime_type) return;
        slot.innerHTML = "";
        const image = document.createElement("img");
        image.src = "data:" + item.mime_type + ";base64," + item.image_base64;
        image.alt = item.alt_text || "Kendra Bexly gallery photograph";
        image.loading = "lazy";
        image.decoding = "async";
        slot.appendChild(image);
      });
    } catch (error) {
      console.error("Public gallery failed to load:", error);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    loadRates();
    loadGallery();
  });
})();
