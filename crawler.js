const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const url = require('url');

// Keywords that indicate the event has ended
const ENDED_KEYWORDS = [
  "종료된 이벤트", 
  "마감되었습니다", 
  "종료되었습니다", 
  "마감된 이벤트", 
  "존재하지 않는 이벤트", 
  "존재하지 않는 페이지", 
  "유효하지 않은 이벤트", 
  "끝난 이벤트",
  "이벤트가 마감",
  "종료 안내"
];

// Helper function to fetch page with redirect handling using built-in Node modules (Zero Dependencies)
function fetchPage(targetUrl, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects < 0) {
      return reject(new Error('Too many redirects'));
    }

    const parsedUrl = url.parse(targetUrl);
    const client = parsedUrl.protocol === 'https:' ? https : http;

    const options = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
      path: parsedUrl.path,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7'
      },
      timeout: 8000 // 8 seconds timeout
    };

    const req = client.request(options, (res) => {
      // Handle redirects (status 3xx)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = url.resolve(targetUrl, res.headers.location);
        
        // Stale events often redirect back to main home page or error page
        if (redirectUrl.includes('/error') || redirectUrl.includes('/404') || redirectUrl === parsedUrl.protocol + '//' + parsedUrl.hostname + '/') {
          return resolve({ statusCode: res.statusCode, isRedirectedToHomeOrError: true, body: '' });
        }
        return fetchPage(redirectUrl, maxRedirects - 1).then(resolve).catch(reject);
      }

      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
        // Limit parsing to 1MB to avoid out-of-memory errors
        if (data.length > 1024 * 1024) {
          req.destroy();
        }
      });

      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          isRedirectedToHomeOrError: false,
          body: data
        });
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Timeout'));
    });

    req.end();
  });
}

async function validateEvents() {
  const filePath = path.join(__dirname, 'data.json');
  if (!fs.existsSync(filePath)) {
    console.error("data.json not found!");
    process.exit(1);
  }

  let events = [];
  try {
    events = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.error("Failed to parse data.json", e);
    process.exit(1);
  }

  console.log(`Starting health check for ${events.length} events...`);
  const activeEvents = [];

  for (const event of events) {
    console.log(`Checking [${event.company}] ${event.title}...`);
    try {
      const res = await fetchPage(event.url);
      
      if (res.statusCode === 404) {
        console.log(`❌ Removed: Page returned 404 Not Found.`);
        continue;
      }
      
      if (res.isRedirectedToHomeOrError) {
        console.log(`❌ Removed: Redirected to main home or error page.`);
        continue;
      }

      // Check for ended keywords in body
      let hasEndedKeyword = false;
      const lowerBody = res.body.toLowerCase();
      for (const keyword of ENDED_KEYWORDS) {
        if (lowerBody.includes(keyword.toLowerCase())) {
          hasEndedKeyword = true;
          console.log(`❌ Removed: Found ended keyword "${keyword}".`);
          break;
        }
      }

      if (hasEndedKeyword) {
        continue;
      }

      // Keep event as active
      console.log(`   Alive (Status ${res.statusCode})`);
      activeEvents.push(event);

    } catch (err) {
      // If requests fail due to SSL, bot block (403), or Timeout, we KEEP it for user safety.
      // This prevents false-positive deletions of alive app events.
      console.log(`⚠️ Alert: Request failed (${err.message}). Keeping event for safety.`);
      activeEvents.push(event);
    }
  }

  console.log(`Health check complete. Active events: ${activeEvents.length} / ${events.length}`);
  
  // Write filtered active events back to data.json
  fs.writeFileSync(filePath, JSON.stringify(activeEvents, null, 2), 'utf8');
  console.log("Updated data.json successfully!");
}

validateEvents();
