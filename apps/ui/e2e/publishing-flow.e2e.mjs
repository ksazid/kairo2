import { test, expect } from "@playwright/test";

const appUrl = "http://127.0.0.1:4173";
const stubUrl = "http://127.0.0.1:4189";

test.beforeEach(async ({ context, request }) => {
  await request.post(`${stubUrl}/__e2e/reset`);
  await context.addCookies([{
    name: "kairo_access_token",
    value: "e2e-token",
    url: appUrl
  }]);
});

test("Hunter opportunity can become reviewed, approved, and scheduled content", async ({ page }) => {
  await page.goto("/discover?brand=brand-1");

  await page.getByRole("button", { name: "Refresh discovery" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Hunter found 2 new opportunities." })).toBeVisible();

  const opportunity = page.getByRole("row").filter({ hasText: "AI workflows your team can use this week" });
  await expect(opportunity).toBeVisible();
  await opportunity.getByRole("link", { name: "Preview" }).click();

  await expect(page).toHaveURL(/\/discover\/opp-ai\?brand=brand-1/);
  await expect(page.getByRole("heading", { name: "AI workflows your team can use this week", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Create with Kairo" }).click();

  await expect(page).toHaveURL(/\/content\/campaign-ai\/asset-ai\?brand=brand-1/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "AI workflows your team can use this week", exact: true })).toBeVisible();
  await expect(page.getByText("Five practical AI workflows your operations team can use this week.")).toBeVisible();

  const readiness = page.getByRole("button", { name: "Check readiness" });
  await expect(readiness).toBeEnabled();
  await readiness.click();
  await expect(page.getByText("Readiness review passed.")).toBeVisible();
  await expect(page.getByText("Ready to approve")).toBeVisible();

  const approve = page.getByRole("button", { name: "Approve & Lock" });
  await expect(approve).toBeEnabled();
  await approve.click();
  await expect(page.getByRole("button", { name: "Approved & Locked" })).toBeVisible();

  const schedule = page.getByRole("button", { name: "Schedule" });
  await expect(schedule).toBeEnabled({ timeout: 8_000 });
  await schedule.click();

  await expect(page.getByRole("button", { name: "Scheduled" })).toBeVisible();
  await expect(page.getByText("This content is ready for its publishing slot.")).toBeVisible();
});
