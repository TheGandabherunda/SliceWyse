import { test, expect } from '@playwright/test';

test.describe('SliceWyse Application E2E Workflows', () => {
  test('Complete onboarding, group creation, and expense tracking flow', async ({ page }) => {
    await page.goto('/');

    // 1. Onboarding Screen
    await expect(page.locator('h1')).toContainText('SliceWyse');
    await page.fill('#display-name-input', 'Alice');
    await page.click('button[type="submit"]');

    // 2. Dashboard View
    await expect(page.locator('h2')).toContainText('Your Groups');
    await expect(page.locator('.user-name')).toContainText('Alice');

    // 3. Create Group
    await page.click('button:has-text("Create Group")');
    await page.fill('#group-name', 'Trip to Kyoto');
    await page.selectOption('#group-currency', 'USD');
    await page.click('form button[type="submit"]');

    // 4. Open Created Group
    await expect(page.locator('.group-card')).toContainText('Trip to Kyoto');
    await page.click('.group-card');

    // 5. Group Detail Page
    await expect(page.locator('h1')).toContainText('Trip to Kyoto');
    await expect(page.locator('.member-name')).toContainText('Alice');

    // 6. Add Expense
    await page.click('button:has-text("Add Expense")');
    await page.fill('#expense-title', 'Dinner at Izakaya');
    await page.fill('#expense-amount', '120.00');
    await page.click('form button[type="submit"]');

    // 7. Verify Expense Display
    await expect(page.locator('.timeline-card')).toContainText('Dinner at Izakaya');
    await expect(page.locator('.expense-total')).toContainText('$120.00');
  });
});
