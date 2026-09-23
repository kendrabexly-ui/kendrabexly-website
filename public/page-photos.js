(() => {
  document.addEventListener("DOMContentLoaded", async () => {
    const row = document.querySelector("[data-page-photos]");
    if (!row) return;
    try {
      const response = await fetch("/api/public/page-photos?page=" + encodeURIComponent(row.dataset.pagePhotos));
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error("Could not load page photos.");
      for (const item of data.images || []) {
        const slot = row.querySelector('[data-page-photo-slot="' + Number(item.slot) + '"]');
        if (!slot || !item.image_base64 || !["image/jpeg", "image/png", "image/webp"].includes(item.mime_type)) continue;
        const image = document.createElement("img");
        image.src = "data:" + item.mime_type + ";base64," + item.image_base64;
        image.alt = item.alt_text || "Kendra Bexly photograph";
        image.loading = "lazy";
        image.decoding = "async";
        slot.replaceChildren(image);
        slot.hidden = false;
      }
    } catch (error) { console.error("Page photos failed to load:", error); }
  });
})();
