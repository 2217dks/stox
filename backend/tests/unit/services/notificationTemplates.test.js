const {
  escapeHtml,
  renderNotificationTemplate,
  resolvePreferencesUrl,
  wrapHtml,
} = require("../../../src/services/notificationTemplates");

describe("notification templates", () => {
  test("escapes HTML in the title, message, and data", () => {
    const html = wrapHtml({
      title: "<script>alert(1)</script>",
      message: "5 > 3 & 2 < 4",
      data: { symbol: "<AAPL>", note: '"quoted"' },
    });

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("5 &gt; 3 &amp; 2 &lt; 4");
    expect(html).toContain("&lt;AAPL&gt;");
    expect(html).toContain("&quot;quoted&quot;");
  });

  test("omits the internal channels object and stringifies nested values", () => {
    const html = wrapHtml({
      title: "Price alert",
      message: "AAPL crossed 200",
      data: {
        symbol: "AAPL",
        channels: { email: true, push: false },
        nested: { level: 1 },
      },
    });

    expect(html).not.toContain("channels");
    expect(html).toContain("AAPL");
    expect(html).toContain("{&quot;level&quot;:1}");
  });

  test("renders a subject, text, and html body from a notification", () => {
    const template = renderNotificationTemplate({
      title: "Order executed",
      message: "BUY 1 AAPL executed.",
      data: { symbol: "AAPL" },
    });

    expect(template.subject).toBe("Order executed");
    expect(template.text).toBe("BUY 1 AAPL executed.");
    expect(template.html).toContain("Order executed");
    expect(template.html).toContain("AAPL");
    expect(template.html).toContain("Manage notification preferences");
  });

  test("includes a manage-preferences link", () => {
    const html = wrapHtml({
      title: "Hi",
      message: "Body",
      preferencesUrl: "http://localhost:3000/settings/notifications",
    });

    expect(html).toContain(
      'href="http://localhost:3000/settings/notifications"',
    );
    expect(html).toContain("Manage notification preferences");
  });

  test("resolves the preferences URL from the environment", () => {
    expect(
      resolvePreferencesUrl({
        FRONTEND_URL: "https://app.stox.example/",
      }),
    ).toBe("https://app.stox.example/settings/notifications");

    expect(
      resolvePreferencesUrl({
        CLIENT_URL: "https://client.stox.example",
      }),
    ).toBe("https://client.stox.example/settings/notifications");

    expect(resolvePreferencesUrl({})).toBe(
      "http://localhost:3000/settings/notifications",
    );
  });

  test("escapeHtml handles null and undefined", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });
});
