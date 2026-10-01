import { test, expect } from "@playwright/test";

const appUrl = "http://127.0.0.1:4173";

test.beforeEach(async ({ context }) => {
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
  await expect(page.getByRole("link", { name: "AI workflows your team can use this week", exact: true })).toBeVisible();

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

test("protected routes still redirect when the access token is missing", async ({ browser }) => {
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto("/discover");
  await expect(page).toHaveURL(/\/auth\/login\?returnTo=%2Fdiscover/);

  await context.close();
});
