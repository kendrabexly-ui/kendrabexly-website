// Admin-only Terms & Conditions editor UI. Mount into an authenticated portal panel.
// Requires authenticated GET/PUT endpoint provided by the Worker integration.
export function mountIntroductionTermsEditor(container, endpoint = "/api/admin/introduction-terms") {
  const heading = document.createElement("h3");
  heading.textContent = "Introduction Terms & Conditions";
  const description = document.createElement("p");
  description.textContent = "Edit the terms shown to clients before they introduce themselves.";
  const field = document.createElement("textarea");
  field.rows = 14;
  field.maxLength = 12000;
  field.setAttribute("aria-label", "Introduction Terms & Conditions");
  const save = document.createElement("button");
  save.type = "button";
  save.textContent = "Save Terms";
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  container.replaceChildren(heading, description, field, save, status);
  save.disabled = true;
  fetch(endpoint, { credentials: "same-origin" })
    .then(async response => {
      if (!response.ok) throw new Error("Unable to load terms");
      const data = await response.json();
      field.value = data.terms || "";
      save.disabled = false;
    })
    .catch(error => { status.textContent = error.message; });
  save.addEventListener("click", async () => {
    save.disabled = true;
    status.textContent = "Saving…";
    try {
      const response = await fetch(endpoint, {
        method: "PUT", credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ terms: field.value })
      });
      if (!response.ok) throw new Error("Unable to save terms");
      status.textContent = "Terms saved.";
    } catch (error) {
      status.textContent = error.message;
    } finally {
      save.disabled = false;
    }
  });
}
