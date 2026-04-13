// Content script to extract page information
// This will be injected into the current tab to gather page data

(function() {
  // Extract main page text content
  function extractPageText() {
    // Remove script and style elements
    const elementsToRemove = document.querySelectorAll('script, style, nav, header, footer, .ad, .advertisement');
    const tempDoc = document.cloneNode(true);
    elementsToRemove.forEach(el => {
      const clonedEl = tempDoc.querySelector(el.tagName);
      if (clonedEl) clonedEl.remove();
    });

    // Get main content areas
    const contentSelectors = [
      'main',
      'article', 
      '[role="main"]',
      '.content',
      '.main-content',
      '#content',
      '#main'
    ];

    let mainText = '';
    
    // Try to find main content area first
    for (const selector of contentSelectors) {
      const element = document.querySelector(selector);
      if (element) {
        mainText = element.innerText || element.textContent || '';
        break;
      }
    }
    
    // If no main content found, use body but filter out navigation/sidebar
    if (!mainText) {
      const body = document.body.cloneNode(true);
      
      // Remove common non-content elements
      const nonContentSelectors = [
        'nav', 'header', 'footer', 'aside', '.sidebar', 
        '.navigation', '.menu', '.ad', '.advertisement',
        '.comments', '.social-media', '.related-posts'
      ];
      
      nonContentSelectors.forEach(selector => {
        const elements = body.querySelectorAll(selector);
        elements.forEach(el => el.remove());
      });
      
      mainText = body.innerText || body.textContent || '';
    }
    
    // Clean up the text
    // return mainText
    //   .replace(/\s+/g, ' ')
    //   .replace(/\n\s*\n/g, '\n')
    //   .trim()
    //   .substring(0, 5000); // Limit to 5000 characters
    // Clean up the text
    let cleanedText = mainText
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      .trim()
      .substring(0, 5000); // Limit to 5000 characters

    // Append raw <a href> tags with query params for launcher href extraction
    const hrefTags = extractHrefParams(10);
    if (hrefTags.length > 0) {
      cleanedText += '\n\n--- Page Href Tags ---\n' + hrefTags.join('\n') + '\n--- End Page Href Tags ---';
    }

    return cleanedText;

  }

  // Extract headings for structure
  function extractHeadings() {
    const headings = [];
    const headingElements = document.querySelectorAll('h1, h2, h3, h4, h5, h6');
    
    headingElements.forEach(heading => {
      if (heading.innerText.trim()) {
        headings.push({
          level: heading.tagName.toLowerCase(),
          text: heading.innerText.trim()
        });
      }
    });
    
    return headings.slice(0, 20); // Limit to 20 headings
  }

  // Extract meta information
  function extractMetaInfo() {
    const meta = {};
    
    // Description
    const description = document.querySelector('meta[name="description"]');
    if (description) {
      meta.description = description.getAttribute('content');
    }
    
    // Keywords
    const keywords = document.querySelector('meta[name="keywords"]');
    if (keywords) {
      meta.keywords = keywords.getAttribute('content');
    }
    
    // Open Graph data
    const ogTitle = document.querySelector('meta[property="og:title"]');
    const ogDescription = document.querySelector('meta[property="og:description"]');
    const ogType = document.querySelector('meta[property="og:type"]');
    
    if (ogTitle) meta.ogTitle = ogTitle.getAttribute('content');
    if (ogDescription) meta.ogDescription = ogDescription.getAttribute('content');
    if (ogType) meta.ogType = ogType.getAttribute('content');
    
    return meta;
  }

  // Extract links information
  function extractLinks() {
    const links = [];
    const linkElements = document.querySelectorAll('a[href]');
    
    linkElements.forEach(link => {
      const href = link.getAttribute('href');
      const text = link.innerText.trim();
      
      if (href && text && !href.startsWith('#') && !href.startsWith('javascript:')) {
        links.push({
          url: href,
          text: text.substring(0, 100) // Limit text length
        });
      }
    });
    
    return links.slice(0, 10); // Limit to 10 links
  }

  // NEW FUNCTION — Add after extractLinks() (around line 127)

  // Extract raw <a href> tags that contain query parameters
  // so the skill launcher can parse path/param/value triples
  function extractHrefParams(limit) {
    limit = limit || 10;
    const linkElements = document.querySelectorAll('a[href]');
    const hrefTags = [];
    const seenParamValues = new Set();
    let processed = 0;

    for (let i = 0; i < linkElements.length && processed < limit; i++) {
      const link = linkElements[i];
      const href = link.getAttribute('href');
      if (!href || href.startsWith('#') || href.startsWith('javascript:')) {
        continue;
      }

      // Only process hrefs that have query parameters
      const qIndex = href.indexOf('?');
      if (qIndex < 0) {
        continue;
      }

      try {
        // Parse query params from the href
        const queryString = href.substring(qIndex + 1);
        const params = new URLSearchParams(queryString);
        let hasNewParam = false;

        for (const [key, value] of params.entries()) {
          const dedupeKey = key + '=' + value;
          if (!seenParamValues.has(dedupeKey)) {
            hasNewParam = true;
            seenParamValues.add(dedupeKey);
          }
        }

        // Only include this href if it has at least one new (param, value) pair
        if (hasNewParam) {
          // Emit as a raw <a href="..."> tag so the launcher regex can parse it
          hrefTags.push('<a href="' + href + '">link</a>');
          processed++;
        }
      } catch (e) {
        // Skip malformed hrefs
        continue;
      }
    }

    return hrefTags;
  }


  // Main extraction function
  function snapshotStorage(storageObject, maxItems, maxValueLength) {
    const snapshot = {};
    try {
      const length = Math.min(storageObject.length, maxItems);
      for (let index = 0; index < length; index += 1) {
        const key = storageObject.key(index);
        if (!key) {
          continue;
        }
        const value = storageObject.getItem(key);
        snapshot[key] = typeof value === 'string'
          ? value.substring(0, maxValueLength)
          : '';
      }
    } catch (error) {
      snapshot.__error = String(error && error.message ? error.message : error);
    }
    return snapshot;
  }

  function extractPageData() {
    return {
      title: document.title,
      url: window.location.href,
      domain: window.location.hostname,
      text: extractPageText(),
      headings: extractHeadings(),
      meta: extractMetaInfo(),
      links: extractLinks(),
      localStorageSnapshot: snapshotStorage(window.localStorage, 20, 1000),
      sessionStorageSnapshot: snapshotStorage(window.sessionStorage, 20, 1000),
      timestamp: new Date().toISOString()
    };
  }

  // Return the extracted data
  return extractPageData();
})();
