import { test, expect } from "@playwright/test";

const appUrl = "http://127.0.0.1:4173";

test.beforeEach(async ({ context, request }) => {
  await request.post("http://127.0.0.1:4189/__e2e/reset");
  await context.addCookies([{
    name: "kairo_access_token",
    value: "e2e-token",
    url: appUrl
  }]);
});

test("authenticated core journey stays inside Kairo and uses real page routing", async ({ page }) => {
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "What should we create next?" })).toBeVisible();
  await expect(page.getByText("Kairo recommends")).toBeVisible();

  await page.getByRole("link", { name: "Discover", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Discover", exact: true })).toBeVisible();
  await expect(page.getByText(/Showing\s+2\s+of\s+2\s+opportunities/i)).toBeVisible();

  await page.getByRole("searchbox", { name: "Search Discover" }).fill("AI workflows");
  await expect(page.getByText(/Showing\s+1\s+of\s+2\s+opportunities/i)).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "AI workflows your team can use this week" })).toBeVisible();

  await page.getByRole("link", { name: "Content", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Content", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "No content yet" })).toBeVisible();

  await page.getByRole("link", { name: "Brain", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Brand Brain", exact: true })).toBeVisible();
  await expect(page.getByText("Discovery ready")).toBeVisible();
});

test("website onboarding creates a Brand and lands in Brand Brain", async ({ page }) => {
  await page.goto("/brands/new");

  await expect(page.getByRole("heading", { name: "Build a Brand Brain in Kairo v2." })).toBeVisible();
  await page.getByLabel("Public website").fill("https://nike.com");
  await page.getByRole("button", { name: "Analyse website and build Brand Brain" }).click();

  await expect(page).toHaveURL(/\/brand\?brand=brand-\d+&setup=created&runtime=e2e-stub/);
  await expect(page.getByRole("heading", { name: "Brand Brain", exact: true })).toBeVisible();
  await expect(page.getByText("Brand Brain loaded from live Brand intelligence.")).toBeVisible();
});

test("not-ready Brand sees non-actionable sample Discover data with real readiness", async ({ page, request }) => {
  await request.post("http://127.0.0.1:4189/api/v1/workspaces/ws-1/brands", {
    data: { brandName: "Preview Brand" }
  });

  await page.goto("/discover?brand=brand-2");

  const mode = page.getByRole("status", { name: "Discover data mode" });
  await expect(mode).toContainText("Brand not ready");
  await expect(mode).toContainText("Sample preview");
  await expect(mode).toContainText("62%");
  await expect(page.getByText(/Showing\s+6\s+of\s+6\s+sample opportunities/i)).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh discovery" })).toBeDisabled();
  await expect(page.locator(".discover-source-cell").filter({ hasText: "Sample Hunter preview" }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Sample opportunities cannot be saved" }).first()).toBeDisabled();
});

test("Insights stays an explicit sample dashboard until live aggregates exist", async ({ page, request }) => {
  await request.post("http://127.0.0.1:4189/api/v1/workspaces/ws-1/brands", {
    data: { brandName: "Preview Brand" }
  });

  await page.goto("/insights?brand=brand-2");

  const mode = page.getByRole("status", { name: "Insights data mode" });
  await expect(mode).toContainText("Insights preview");
  await expect(mode).toContainText("Sample data");
  await expect(page.getByText("Preview only")).toBeVisible();
  await expect(page.getByText("SAMPLE").first()).toBeVisible();
});

test("Insights switches to normalized live metrics when evidence gate passes", async ({ page, request }) => {
  await request.post("http://127.0.0.1:4189/api/v1/brands/brand-1/simple-creations", {
    data: { goal: "Prepare published content evidence" }
  });

  await page.goto("/insights?brand=brand-1");

  const mode = page.getByRole("status", { name: "Insights data mode" });
  await expect(mode).toContainText("Live Brand data");
  await expect(mode).toContainText("Data type");
  await expect(mode).toContainText("Live");
  await expect(page.getByRole("region", { name: "Performance summary" }).getByText("2K")).toBeVisible();
  await expect(page.getByRole("region", { name: "Performance summary" }).getByText("14.0%")).toBeVisible();
  await expect(page.getByRole("region", { name: "Performance summary" }).getByText("80")).toBeVisible();
  await expect(page.getByText("Current evidence")).toBeVisible();
  await expect(page.getByText("100%", { exact: true })).toBeVisible();
  await expect(page.getByText("SAMPLE")).toHaveCount(0);
});

test("protected routes still redirect when the access token is missing", async ({ request }) => {
  const response = await request.get(`${appUrl}/discover`, { maxRedirects: 0 });

  expect([307, 308]).toContain(response.status());
  const redirect = new URL(response.headers().location, appUrl);
  expect(`${redirect.pathname}${redirect.search}`).toBe("/auth/login?returnTo=%2Fdiscover");
});
