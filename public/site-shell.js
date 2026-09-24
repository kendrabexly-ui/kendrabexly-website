(() => {
  const links = [
    { key: "invitation", href: "/", label: "Home" },
    { key: "the-muse", href: "/the-muse", label: "Gallery" },
    { key: "our-time", href: "/our-time", label: "Our Time" },
    { key: "request", href: "/request", label: "Request a Date", button: true }
  ];

  class SiteHeader extends HTMLElement {
    connectedCallback() {
      const active = this.getAttribute("active") || "";
      const isPrivate = this.hasAttribute("private");
      const privateToken = isPrivate
        ? (location.pathname.startsWith("/the-details")
            ? new URLSearchParams(location.hash.slice(1)).get("token")
            : new URLSearchParams(location.search).get("token")) || ""
        : "";
      const safeToken = /^[a-f0-9]{64}$/i.test(privateToken) ? privateToken : "";
      const privateLinks = [
        ...(safeToken ? [{ key: "complete", href: "/complete/?token=" + encodeURIComponent(safeToken), label: "Your Request" }] : []),
        { key: "the-details", href: "/the-details/" + (safeToken ? "#token=" + encodeURIComponent(safeToken) : ""), label: "The Details" }
      ];
      const navLinks = isPrivate ? privateLinks : links;
      this.innerHTML = '<header class="nav">' +
        (isPrivate ? '<span class="brand">Kendra Bexly</span>' : '<a class="brand" href="/" aria-label="Kendra Bexly home">Kendra Bexly</a>') +
        '<button class="menu-toggle" type="button" aria-expanded="false" aria-controls="site-nav">Menu</button>' +
        '<nav id="site-nav" aria-label="' + (isPrivate ? "Private request navigation" : "Primary navigation") + '">' +
        navLinks.map(link =>
          '<a href="' + link.href + '"' +
          (link.button ? ' class="button small"' : "") +
          (link.key === active ? ' aria-current="page"' : "") +
          '>' + link.label + '</a>'
        ).join("") +
        '</nav></header>';

      const toggle = this.querySelector(".menu-toggle");
      const nav = this.querySelector("#site-nav");
      const close = () => {
        toggle?.setAttribute("aria-expanded", "false");
        nav?.classList.remove("open");
      };
      toggle?.addEventListener("click", () => {
        const opening = toggle.getAttribute("aria-expanded") !== "true";
        toggle.setAttribute("aria-expanded", String(opening));
        nav?.classList.toggle("open", opening);
      });
      nav?.addEventListener("click", event => {
        if (event.target.closest("a")) close();
      });
      document.addEventListener("keydown", event => {
        if (event.key === "Escape" && toggle?.getAttribute("aria-expanded") === "true") {
          close();
          toggle.focus();
        }
      });
      window.addEventListener("resize", () => {
        if (window.innerWidth > 1100) close();
      });
    }
  }

  class SiteFooter extends HTMLElement {
    connectedCallback() {
      this.innerHTML = '<footer class="site-footer">' +
        '<div class="footer-subscribe">' +
          '<div><div class="eyebrow">PRIVATE NOTES</div><h2>Stay in the Know</h2>' +
          '<p>Join my private list for personal notes, new availability, and the occasional invitation created especially for you.</p></div>' +
          '<form class="footer-subscribe-form" novalidate>' +
            '<div class="footer-subscribe-fields">' +
              '<label><span>First name</span><input name="first_name" type="text" autocomplete="given-name" required></label>' +
              '<label><span>Last name</span><input name="last_name" type="text" autocomplete="family-name" required></label>' +
              '<label class="footer-email-field"><span>Email address</span><input name="email" type="email" inputmode="email" placeholder="you@example.com" autocomplete="email" required></label>' +
            '</div>' +
            '<button class="button footer-subscribe-button" type="submit">Subscribe</button>' +
            '<small class="footer-subscribe-status" hidden role="status" aria-live="polite"></small>' +
          '</form>' +
        '</div>' +
        '<div class="footer-bottom"><span>Copyright ' + new Date().getFullYear() + ' by Kendra Bexly</span></div>' +
      '</footer>';
    }
  }

  if (!customElements.get("site-header")) customElements.define("site-header", SiteHeader);
  if (!customElements.get("site-footer")) customElements.define("site-footer", SiteFooter);
})();
