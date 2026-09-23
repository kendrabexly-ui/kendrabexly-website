(() => {
  document.addEventListener("DOMContentLoaded", async () => {
    const row = document.querySelector("[data-page-photos]");
    if (!row) return;

    const requestImages = async url => {
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      const data = await response.json();
      if (!response.ok || !data.ok || !Array.isArray(data.images)) throw new Error("Photos unavailable.");
      return data.images;
    };

    const hasDefaults = Boolean(row.querySelector("[data-gallery-default-slot]"));
    const [pageResult, galleryResult, stylesResult] = await Promise.allSettled([
      requestImages("/api/public/page-photos?page=" + encodeURIComponent(row.dataset.pagePhotos)),
      hasDefaults ? requestImages("/api/public/gallery") : Promise.resolve([]),\n      requestImages("/api/public/photo-styles")
    ]);
    const pageImages = new Map((pageResult.status === "fulfilled" ? pageResult.value : []).map(item => [Number(item.slot), item]));
    const galleryImages = new Map((galleryResult.status === "fulfilled" ? galleryResult.value : []).map(item => [Number(item.slot), item]));\n    const styles = new Map((stylesResult.status === "fulfilled" ? stylesResult.value : []).map(item => [item.target_type + ":" + item.target_key, item]));

    const defaultDescriptions = {
      1: "Kendra in a white dress outdoors",
      4: "Kendra in a white dress on a terrace",
      5: "Kendra in a blue outfit indoors"
    };
    row.querySelectorAll("[data-page-photo-slot]").forEach(slot => {
      const pageItem = pageImages.get(Number(slot.dataset.pagePhotoSlot));
      const defaultSlot = Number(slot.dataset.galleryDefaultSlot);
      const galleryItem = galleryImages.get(defaultSlot);
      const hasPagePhoto = pageItem?.image_base64 && ["image/jpeg", "image/png", "image/webp"].includes(pageItem.mime_type);
      if (!hasPagePhoto && !galleryItem) return;

      const image = document.createElement("img");
      image.alt = hasPagePhoto ? (pageItem.alt_text || "Kendra Bexly photograph") : (galleryItem.alt_text || defaultDescriptions[defaultSlot] || "Kendra Bexly photograph");
      image.decoding = "async";\n      const style = styles.get("page:" + row.dataset.pagePhotos);\n      if (style) {\n        image.style.width = Number(style.width_percent || 100) + "%";\n        image.style.height = Number(style.height_percent || 100) + "%";\n        image.style.opacity = String(style.opacity ?? 1);\n        image.style.objectFit = "cover";\n      }
      image.onload = () => { slot.hidden = false; };
      image.onerror = () => { slot.hidden = true; };
      slot.replaceChildren(image);
      image.src = hasPagePhoto
        ? "data:" + pageItem.mime_type + ";base64," + pageItem.image_base64
        : "/api/public/gallery/image?slot=" + defaultSlot + "&v=" + encodeURIComponent(galleryItem.updated_at || "");
    });
  });
})();
