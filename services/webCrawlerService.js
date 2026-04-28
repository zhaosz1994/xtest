const cheerio = require('cheerio');

class WebCrawlerService {
  constructor() {
    this.timeout = parseInt(process.env.CRAWLER_TIMEOUT) || 30000;
    this.userAgent = process.env.CRAWLER_USER_AGENT || 'xTest-Bot/1.0';
    this.blockedHosts = [
      '127.0.0.1', 'localhost', '0.0.0.0', '::1',
      '169.254.169.254', 'metadata.google.internal',
      '100.100.100.200'
    ];
    this.blockedPatterns = [
      /^10\./, /^172\.(1[6-9]|2[0-9]|3[01])\./, /^192\.168\./,
      /^0\./, /^169\.254\./, /^fc00:/i, /^fe80:/i
    ];
  }

  validateUrl(url) {
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        return { valid: false, reason: '仅支持HTTP/HTTPS协议' };
      }
      const hostname = parsed.hostname.toLowerCase();
      if (this.blockedHosts.includes(hostname)) {
        return { valid: false, reason: '不允许访问内网地址' };
      }
      for (const pattern of this.blockedPatterns) {
        if (pattern.test(hostname)) {
          return { valid: false, reason: '不允许访问内网地址' };
        }
      }
      return { valid: true };
    } catch (e) {
      return { valid: false, reason: 'URL格式无效' };
    }
  }

  async crawl(url, options = {}) {
    const validation = this.validateUrl(url);
    if (!validation.valid) {
      return { success: false, url, error: validation.reason };
    }

    const { username, password, waitFor, selector } = options;

    if (username && password) {
      return this.crawlWithAuth(url, { username, password, waitFor, selector, ...options });
    }

    return this.crawlSimple(url, { waitFor, selector });
  }

  async crawlSimple(url, options = {}) {
    const axios = require('axios');
    
    try {
      const response = await axios.get(url, {
        timeout: this.timeout,
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        maxRedirects: 5,
        validateStatus: (status) => status < 400
      });

      const html = response.data;
      const content = this.extractContent(typeof html === 'string' ? html : '', url);

      return {
        success: true,
        url,
        title: content.title,
        content: content.textContent,
        markdown: content.markdown,
        links: content.links
      };

    } catch (error) {
      return {
        success: false,
        url,
        error: error.message
      };
    }
  }

  async crawlWithAuth(url, options = {}) {
    try {
      const puppeteer = require('puppeteer');

      const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });

      try {
        const page = await browser.newPage();
        await page.setUserAgent(this.userAgent);
        await page.setDefaultTimeout(this.timeout);

        if (options.loginUrl && options.loginSelectors) {
          await page.goto(options.loginUrl, { waitUntil: 'networkidle2' });

          await page.type(options.loginSelectors.username, options.username);
          await page.type(options.loginSelectors.password, options.password);
          await page.click(options.loginSelectors.submit);

          await page.waitForNavigation({ waitUntil: 'networkidle2' });
        }

        await page.goto(url, { waitUntil: 'networkidle2' });

        if (options.waitFor) {
          await page.waitForSelector(options.waitFor);
        }

        const html = await page.content();
        const content = this.extractContent(html, url);

        return {
          success: true,
          url,
          title: content.title,
          content: content.textContent,
          markdown: content.markdown
        };

      } finally {
        await browser.close();
      }
    } catch (error) {
      return {
        success: false,
        url,
        error: `Puppeteer不可用: ${error.message}。请安装puppeteer: npm install puppeteer`
      };
    }
  }

  extractContent(html, url) {
    if (!html) {
      return { title: '', textContent: '', markdown: '', links: [] };
    }

    const $ = cheerio.load(html);

    $('script, style, nav, header, footer, aside, .ads, .sidebar, .navigation, .menu').remove();

    const title = $('title').text().trim() || $('h1').first().text().trim() || '';

    const textContent = $('body').text().replace(/\s+/g, ' ').trim();

    const markdown = this.toMarkdown(html, $);

    const links = [];
    $('a[href]').each((i, el) => {
      const href = $(el).attr('href');
      const text = $(el).text().trim();
      if (href && text && !href.startsWith('#') && !href.startsWith('javascript:')) {
        links.push({ href, text });
      }
    });

    return {
      title,
      textContent,
      markdown,
      links: links.slice(0, 50)
    };
  }

  toMarkdown(html, $) {
    if (!$) $ = cheerio.load(html);

    let markdown = '';

    $('h1, h2, h3, h4, h5, h6, p, ul, ol, table, pre, code').each((i, el) => {
      const tag = el.tagName.toLowerCase();
      const text = $(el).text().trim();
      if (!text) return;

      switch (tag) {
        case 'h1':
          markdown += `# ${text}\n\n`;
          break;
        case 'h2':
          markdown += `## ${text}\n\n`;
          break;
        case 'h3':
          markdown += `### ${text}\n\n`;
          break;
        case 'h4':
          markdown += `#### ${text}\n\n`;
          break;
        case 'p':
          markdown += `${text}\n\n`;
          break;
        case 'ul':
        case 'ol':
          $(el).find('li').each((j, li) => {
            markdown += `- ${$(li).text().trim()}\n`;
          });
          markdown += '\n';
          break;
        case 'table':
          markdown += this.tableToMarkdown($(el), $);
          break;
        case 'pre':
        case 'code':
          markdown += `\`\`\`\n${text}\n\`\`\`\n\n`;
          break;
      }
    });

    return markdown;
  }

  tableToMarkdown($table, $) {
    let md = '';

    const $headers = $table.find('thead tr th, tr:first-child th, tr:first-child td');
    if ($headers.length > 0) {
      $headers.each((i, th) => {
        md += `| ${$(th).text().trim()} `;
      });
      md += '|\n';

      $headers.each((i, th) => {
        md += '| --- ';
      });
      md += '|\n';
    }

    $table.find('tbody tr, tr').each((i, tr) => {
      if (i === 0 && $headers.length > 0) return;
      $(tr).find('td').each((j, td) => {
        md += `| ${$(td).text().trim()} `;
      });
      md += '|\n';
    });

    return md + '\n';
  }

  async crawlAndSaveAsKnowledge(url, moduleId, parentId, userId, options = {}) {
    const result = await this.crawl(url, options);

    if (!result.success) {
      return result;
    }

    const pool = require('../db');
    const { v4: uuidv4 } = require('uuid');
    const fs = require('fs').promises;
    const path = require('path');

    const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '..', 'uploads');
    const fileUuid = uuidv4();
    const relativePath = `knowledge/${moduleId}/${fileUuid}.md`;
    const absolutePath = path.join(UPLOAD_DIR, relativePath);

    const dirPath = path.join(UPLOAD_DIR, 'knowledge', String(moduleId));
    await fs.mkdir(dirPath, { recursive: true });
    await fs.writeFile(absolutePath, result.markdown || result.content, 'utf-8');

    const fileName = result.title ? `${result.title}.md` : `webpage-${fileUuid.slice(0, 8)}.md`;

    const [fileResult] = await pool.execute(`
      INSERT INTO module_knowledge_files 
        (module_id, parent_id, name, type, file_path, file_size, 
         file_ext, mime_type, created_by, parse_status)
      VALUES (?, ?, ?, 'file', ?, ?, 'md', 'text/markdown', ?, 'pending')
    `, [moduleId, parentId || null, fileName, relativePath,
        Buffer.byteLength(result.markdown || result.content), userId]);

    const FileParserService = require('./fileParserService');
    FileParserService.asyncParseFile(fileResult.insertId);

    return {
      success: true,
      fileId: fileResult.insertId,
      title: result.title,
      contentLength: (result.markdown || result.content).length
    };
  }
}

module.exports = new WebCrawlerService();
