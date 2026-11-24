import { test, expect } from "@playwright/test";

test("sector review blocks Hunter, persists the selected ID, then reaches content preview", async ({ page, context, request }) => {
  await request.post("http://127.0.0.1:4189/__e2e/reset");
  await request.post("http://127.0.0.1:4189/__e2e/require-sector-review");
  await context.addCookies([{ name: "kairo_access_token", value: "e2e-token", url: "http://127.0.0.1:4173" }]);
  await page.goto("/brand?brand=brand-1");
  await expect(page.getByRole("button", { name: "Run Discovery" })).toBeDisabled();
  await page.getByRole("button", { name: "Review Brand sector" }).click();
  const selector = page.getByRole("combobox", { name: "Edit Brand sector" });
  await expect(selector).toHaveValue("ai-technology");
  const update = page.waitForResponse((response) => response.url().endsWith("/api/brain") && response.request().method() === "POST");
  await selector.selectOption("ai-technology");
  await page.getByRole("listitem").filter({ has: selector }).getByRole("button", { name: "Save", exact: true }).click();
  const saved = await update;
  expect(saved.request().postDataJSON()).toMatchObject({ action: "edit-field", fieldKey: "identity.sector-pack-id", section: "identity", value: "ai-technology" });
  await expect(page.getByRole("button", { name: "Run Discovery" })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole("button", { name: "Run Discovery" })).toBeEnabled();
  await page.goto("/discover?brand=brand-1");
  await page.getByRole("button", { name: "Refresh discovery" }).click();
  const opportunity = page.getByRole("row").filter({ hasText: "AI workflows your team can use this week" });
  await opportunity.getByRole("link", { name: "Preview", exact: true }).click();
  await page.getByRole("button", { name: "Create with Kairo" }).click();
  await expect(page).toHaveURL(/\/content\/campaign-ai\/asset-ai\?brand=brand-1/, { timeout: 15_000 });
  await expect(page.getByLabel("Content caption")).toHaveValue("Five practical AI workflows your operations team can use this week.");
});
