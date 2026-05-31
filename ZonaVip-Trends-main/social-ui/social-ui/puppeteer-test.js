import puppeteer from 'puppeteer';

(async () => {
  const browser = await puppeteer.launch({
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  
  page.on('console', msg => {
    console.log(`BROWSER CONSOLE [${msg.type()}]:`, msg.text());
  });
  page.on('pageerror', error => {
    console.log('BROWSER PAGE ERROR:', error.message);
  });
  page.on('requestfailed', request => {
    console.log('BROWSER REQUEST FAILED:', request.url(), request.failure()?.errorText);
  });

  try {
    await page.goto('http://localhost:3000', { waitUntil: 'networkidle0', timeout: 30000 });
    console.log('Page loaded successfully.');
    // dump page HTML
    const content = await page.content();
    console.log('HTML Snippet:', content.substring(0, 500));
  } catch (err) {
    console.log('Error navigating:', err);
  }

  await browser.close();
})();
