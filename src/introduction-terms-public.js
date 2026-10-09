// Client-facing terms display for the existing introduction form.
// Mount immediately before the form's Introduce Myself submit button.
export async function mountIntroductionTerms(form, endpoint = "/api/public/introduction-terms") {
  const submit = form.querySelector("#submit");
  if (!submit) throw new Error("Introduction submit button not found");
  const section = document.createElement("section");
  section.setAttribute("aria-label", "A Few Things to Know Before We Meet");
  const title = document.createElement("h2");
  title.textContent = "A Few Things to Know Before We Meet";
  const subtitle = document.createElement("p");
  subtitle.textContent = "Terms & Conditions";
  const terms = document.createElement("div");
  terms.style.whiteSpace = "pre-wrap";
  const label = document.createElement("label");
  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.name = "terms_accepted";
  checkbox.value = "yes";
  checkbox.required = true;
  checkbox.checked = false;
  checkbox.disabled = true;
  const version = document.createElement("input");
  version.type = "hidden";
  version.name = "terms_version";
  const agreement = document.createElement("span");
  agreement.textContent = "I have read and agree to the Terms & Conditions.";
  label.append(checkbox, agreement);
  const message = document.createElement("p");
  message.setAttribute("role", "status");
  section.append(title, subtitle, terms, label, version, message);
  submit.before(section);
  submit.disabled = true;
  try {
    const response = await fetch(endpoint, { cache: "no-store" });
    if (!response.ok) throw new Error("Unable to load terms.");
    const data = await response.json();
    if (!data.terms) throw new Error("Terms have not been configured yet.");
    terms.textContent = data.terms;
    version.value = data.version || "";
    checkbox.disabled = false;
    submit.disabled = false;
  } catch (error) {
    message.textContent = error.message;
  }
}
