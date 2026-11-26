import { defineConfig } from '@playwright/test'

// 冒烟用例自己在 127.0.0.1 的临时端口启动服务。
// 这里不设置 baseURL / webServer.url：localhost 可能解析到 ::1，而默认后端只绑定 IPv4 回环。
export default defineConfig({
  testDir: './tests/browser',
  testMatch: '**/*.smoke.js',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: 'list',
  use: {
    headless: true,
    viewport: { width: 1440, height: 900 },
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
})
