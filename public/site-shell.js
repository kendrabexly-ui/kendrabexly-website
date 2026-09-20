(() => {
  const links = [
    { key: "invitation", href: "/", label: "The Invitation" },
    { key: "meet-kendra", href: "/meet-kendra", label: "Meet Kendra" },
    { key: "the-muse", href: "/the-muse", label: "The Muse" },
    { key: "our-time", href: "/our-time", label: "Our Time" },
    { key: "etiquette", href: "/etiquette", label: "Etiquette" },
    { key: "pillow-talk", href: "/pillow-talk", label: "Pillow Talk" },
    { key: "request", href: "/request", label: "The Rendezvous", button: true }
  ];

  class SiteHeader extends HTMLElement {
    connectedCallback() {
      const active = this.getAttribute("active") || "";
      this.innerHTML = '<header class="nav">' +
        '<a class="brand" href="/" aria-label="Kendra Bexly home">Kendra Bexly</a>' +
        '<button class="menu-toggle" type="button" aria-expanded="false" aria-controls="site-nav">Menu</button>' +
        '<nav id="site-nav" aria-label="Primary navigation">' +
        links.map(link =>
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
            '<label><span>Email address</span><div class="footer-subscribe-row">' +
              '<input name="email" type="email" inputmode="email" placeholder="you@example.com" autocomplete="email" required>' +
              '<button class="button" type="submit">Subscribe</button>' +
            '</div></label>' +
            '<small class="footer-subscribe-status" hidden role="status" aria-live="polite"></small>' +
          '</form>' +
        '</div>' +
        '<div class="footer-bottom"><span>Copyright 2025 by Kendra Bexly</span></div>' +
      '</footer>';
    }
  }

  if (!customElements.get("site-header")) customElements.define("site-header", SiteHeader);
  if (!customElements.get("site-footer")) customElements.define("site-footer", SiteFooter);
})();
