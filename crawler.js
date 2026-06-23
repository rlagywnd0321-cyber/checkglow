const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const url = require('url');
const axios = require('axios');
const cheerio = require('cheerio');
const iconv = require('iconv-lite');

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

// Helper function to fetch page with redirect handling (built-in Node modules)
function checkUrlHealth(targetUrl, maxRedirects = 5) {
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
        return checkUrlHealth(redirectUrl, maxRedirects - 1).then(resolve).catch(reject);
      }

      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
        if (data.length > 1024 * 1024) { // Limit to 1MB
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

// Function to resolve Ppomppu view_homepage redirector link
async function resolvePpomppuRedirect(redirectUrl) {
  try {
    const res = await axios.head(redirectUrl, {
      maxRedirects: 0,
      validateStatus: (status) => status >= 200 && status < 400,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (res.headers.location) {
      return res.headers.location;
    }
  } catch (e) {
    if (e.response && e.response.headers && e.response.headers.location) {
      return e.response.headers.location;
    }
  }
  return null;
}

// Deduce Category based on target URL domain
function deduceCategory(domain) {
  const d = domain.toLowerCase();
  if (d.includes('naver') || d.includes('daum') || d.includes('nate')) return 'portal';
  if (d.includes('gmarket') || d.includes('11st') || d.includes('auction') || d.includes('coupang') || d.includes('ssg') || d.includes('lotteon') || d.includes('tmon') || d.includes('wemakeprice')) return 'shopping';
  if (d.includes('toss') || d.includes('shinhan') || d.includes('kb') || d.includes('hana') || d.includes('woori') || d.includes('payco') || d.includes('kakao')) return 'finance';
  if (d.includes('oliveyoung') || d.includes('happypoint') || d.includes('lpoint') || d.includes('hpoint') || d.includes('gs25') || d.includes('cu')) return 'lifestyle';
  return 'lifestyle'; // default daily life
}

// Deduce Company Name based on domain or host
function deduceCompany(domain) {
  const d = domain.toLowerCase();
  if (d.includes('naver')) return '네이버';
  if (d.includes('gmarket')) return 'G마켓';
  if (d.includes('11st')) return '11번가';
  if (d.includes('toss')) return '토스';
  if (d.includes('kbstar') || d.includes('kbcard')) return 'KB금융';
  if (d.includes('oliveyoung')) return '올리브영';
  if (d.includes('happypoint')) return '해피포인트';
  if (d.includes('lpoint')) return '롯데 엘포인트';
  if (d.includes('shinhan')) return '신한금융';
  if (d.includes('payco')) return '페이코';
  if (d.includes('coupang')) return '쿠팡';
  
  // Extract main name from domain (e.g. "something.com" -> "something")
  const parts = domain.split('.');
  if (parts.length >= 2) {
    const name = parts[parts.length - 2];
    return name.toUpperCase();
  }
  return domain;
}

// Helper to extract real target URL, handling Ppomppu's link redirect proxy
function extractTargetUrl(linkHref) {
  if (!linkHref) return null;
  if (linkHref.includes('s.ppomppu.co.kr')) {
    try {
      const urlObj = new URL(linkHref);
      const targetParam = urlObj.searchParams.get('target');
      if (targetParam) {
        // Ppomppu base64 encodes the target URL when encode=on is set
        const decoded = Buffer.from(targetParam, 'base64').toString('utf8');
        if (decoded.startsWith('http')) {
          return decoded;
        }
        return targetParam; // fallback if it wasn't base64
      }
    } catch (e) {
      console.error(`⚠️ Failed to parse redirect URL: ${linkHref}, error: ${e.message}`);
    }
  }
  
  // If it's a direct external link, return as is
  if (linkHref.startsWith('http') && !linkHref.includes('ppomppu.co.kr')) {
    return linkHref;
  }
  return null;
}

// Scrape new attendance events from Ppomppu Event boards
async function scrapeNewEvents() {
  console.log("Scraping Ppomppu Event boards for new daily check-ins (event2 & evt)...");
  const newEvents = [];
  const postLinks = [];
  const matchedPostIds = new Set();
  
  const KEYWORDS = ["출석", "출체", "출첵", "매일", "룰렛", "데일리", "하루", "퀴즈"];
  const NEGATIVE_KEYWORDS = ["종료", "마감", "종료예정", "종료됨", "끝"];
  
  // Scrape event2 (community-driven Event board) and evt (Official Event board)
  const boards = [
    { id: 'event2', pages: 5 },
    { id: 'evt', pages: 2 }
  ];

  for (const board of boards) {
    console.log(`Starting to scrape Ppomppu board "${board.id}"...`);
    for (let page = 1; page <= board.pages; page++) {
      console.log(`   Fetching ${board.id} page ${page}...`);
      try {
        const res = await axios.get(`https://www.ppomppu.co.kr/zboard/zboard.php?id=${board.id}&page=${page}`, {
          responseType: 'arraybuffer',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
          },
          timeout: 10000
        });
        
        // Decode EUC-KR HTML content
        const html = iconv.decode(Buffer.from(res.data), 'euc-kr');
        const $ = cheerio.load(html);
        
        // Select post title elements
        $('td.list_title a').each((i, el) => {
          const titleText = $(el).text().trim();
          const href = $(el).attr('href');
          
          if (!href) return;
          
          // Match keywords indicating attendance checks
          const hasKeyword = KEYWORDS.some(k => titleText.includes(k));
          const hasNegativeKeyword = NEGATIVE_KEYWORDS.some(k => titleText.includes(k));
          
          if (hasKeyword && !hasNegativeKeyword) {
            const fullUrl = url.resolve(`https://www.ppomppu.co.kr/zboard/zboard.php?id=${board.id}`, href);
            // Extract post ID
            const urlParams = new URLSearchParams(fullUrl.split('?')[1]);
            const postId = urlParams.get('no');
            
            if (postId) {
              const uniqueId = `${board.id}-${postId}`;
              if (!matchedPostIds.has(uniqueId)) {
                matchedPostIds.add(uniqueId);
                postLinks.push({ id: uniqueId, title: titleText, url: fullUrl });
              }
            }
          }
        });
      } catch (pageErr) {
        console.error(`⚠️ Failed to fetch ${board.id} page ${page}: ${pageErr.message}`);
      }
      // Polite delay between page requests
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  console.log(`Found ${postLinks.length} matching attendance posts across both boards.`);
  
  // Scrape details for up to 35 matching threads to prevent rate limiting
  const maxThreadsToScrape = 35;
  const targetPosts = postLinks.slice(0, maxThreadsToScrape);
  
  for (const post of targetPosts) {
    console.log(`Parsing details of post: "${post.title}"...`);
    try {
      const postRes = await axios.get(post.url, {
        responseType: 'arraybuffer',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        timeout: 8000
      });
      
      const postHtml = iconv.decode(Buffer.from(postRes.data), 'euc-kr');
      const $post = cheerio.load(postHtml);
      
      let targetUrl = null;
      
      // 1. Try to find the homepage redirect link
      const homepageBtn = $post('a[onclick*="view_homepage"]');
      if (homepageBtn.length > 0) {
        const onclickAttr = homepageBtn.attr('onclick');
        const match = onclickAttr.match(/view_homepage\.php\?no=\d+&id=\w+/);
        if (match) {
          const redirectPath = match[0];
          const fullRedirectUrl = `https://www.ppomppu.co.kr/zboard/${redirectPath}`;
          console.log(`Found homepage redirector: ${fullRedirectUrl}`);
          targetUrl = await resolvePpomppuRedirect(fullRedirectUrl);
        }
      }
      
      // 2. If no homepage link, scan post body for external links or proxy links
      if (!targetUrl) {
        $post('.board-contents a, .wordbreak a, #writeContents a').each((i, el) => {
          const linkHref = $post(el).attr('href');
          if (linkHref) {
            const extracted = extractTargetUrl(linkHref);
            if (extracted) {
              targetUrl = extracted;
              return false; // break loop
            }
          }
        });
      }

      if (targetUrl) {
        console.log(`   Discovered target event URL: ${targetUrl}`);
        const parsedTarget = url.parse(targetUrl);
        const domain = parsedTarget.hostname || '';
        const company = deduceCompany(domain);
        const category = deduceCategory(domain);
        
        newEvents.push({
          id: `scraped-${post.id}`,
          title: post.title.replace(/\[[^\]]+\]/g, '').trim(), // Clean bracket tags like [출석]
          company: company,
          category: category,
          url: targetUrl,
          reward: "포인트 / 이벤트 리워드",
          logo: company.charAt(0)
        });
      }
    } catch (err) {
      console.error(`⚠️ Failed to parse thread ${post.id}: ${err.message}`);
    }
    // Polite delay between thread detail requests
    await new Promise(resolve => setTimeout(resolve, 300));
  }
  
  return newEvents;
}

// Main Runner
async function run() {
  const filePath = path.join(__dirname, 'data.json');
  if (!fs.existsSync(filePath)) {
    console.error("data.json not found!");
    process.exit(1);
  }

  let dbEvents = [];
  try {
    dbEvents = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (e) {
    console.error("Failed to parse data.json", e);
    process.exit(1);
  }

  // 1. Scrape new events from Ppomppu
  const newlyScraped = await scrapeNewEvents();
  console.log(`Scraped ${newlyScraped.length} events from community.`);

  // 2. Merge lists (avoiding duplicates based on URL hostname/path)
  const mergedEvents = [...dbEvents];
  for (const newEv of newlyScraped) {
    const isDuplicate = mergedEvents.some(existing => {
      // Normalize URLs by comparing without protocol & trailing slash
      const normExist = existing.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const normNew = newEv.url.replace(/^https?:\/\//, '').replace(/\/$/, '');
      return normExist === normNew || existing.id === newEv.id;
    });

    if (!isDuplicate) {
      console.log(`➕ Adding new event to list: [${newEv.company}] ${newEv.title}`);
      mergedEvents.push(newEv);
    }
  }

  // 3. Health check the entire merged list
  console.log(`Starting health check for total ${mergedEvents.length} events...`);
  const activeEvents = [];

  for (const event of mergedEvents) {
    const isDefaultEvent = !event.id.startsWith('scraped-');
    console.log(`Checking [${event.company}] ${event.title}...`);

    if (isDefaultEvent) {
      console.log(`   🛡️ Curated/default event. Bypassing health check removal.`);
      activeEvents.push(event);
      continue;
    }

    try {
      const res = await checkUrlHealth(event.url);
      
      if (res.statusCode === 404) {
        console.log(`   ❌ Removed: Page returned 404 Not Found.`);
        continue;
      }
      
      if (res.isRedirectedToHomeOrError) {
        console.log(`   ❌ Removed: Redirected to main home or error page.`);
        continue;
      }

      // Check ended keywords
      let hasEndedKeyword = false;
      const lowerBody = res.body.toLowerCase();
      for (const keyword of ENDED_KEYWORDS) {
        if (lowerBody.includes(keyword.toLowerCase())) {
          hasEndedKeyword = true;
          console.log(`   ❌ Removed: Found ended keyword "${keyword}".`);
          break;
        }
      }

      if (hasEndedKeyword) {
        continue;
      }

      console.log(`   ✅ Alive (Status ${res.statusCode})`);
      activeEvents.push(event);

    } catch (err) {
      // Keep if server blocks request or timeouts to prevent false-positives
      console.log(`   ⚠️ Alert: Request failed (${err.message}). Keeping event for safety.`);
      activeEvents.push(event);
    }
  }

  console.log(`Health check complete. Active events: ${activeEvents.length} / ${mergedEvents.length}`);
  
  // Write filtered active events back to data.json
  fs.writeFileSync(filePath, JSON.stringify(activeEvents, null, 2), 'utf8');
  console.log("Updated data.json successfully!");
}

run();
