/* ============================================================
 * server/index.js — 论文一键排版助手在线版后端（零依赖）
 *
 *  - GET /            -> index.html（单文件应用）
 *  - GET /api/search?q=关键词 -> 联网搜索期刊官网投稿须知候选页（JSON）
 *  - GET /api/fetch?url=... -> 抓取指定页面正文文本（JSON，含 SSRF 防护）
 * ============================================================ */
"use strict";

const http = require("http");
const https = require("https");
const dns = require("dns").promises;
const path = require("path");
const fs = require("fs");
const { URL } = require("url");

const ROOT = path.join(__dirname, "..");
const PORT = parseInt(process.env.PORT || "3000", 10);
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

/* ---------------- SSRF 防护 ---------------- */
function ipToInt(ip) {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => isNaN(n) || n < 0 || n > 255)) return null;
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}
function isPrivateIPv4(ip) {
  const n = ipToInt(ip);
  if (n === null) return true; // 解析不出就当可疑
  const inCidr = (base, bits) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) >>> 0 === (ipToInt(base) & mask) >>> 0;
  };
  return (
    inCidr("10.0.0.0", 8) || inCidr("172.16.0.0", 12) || inCidr("192.168.0.0", 16) ||
    inCidr("127.0.0.0", 8) || inCidr("169.254.0.0", 16) || inCidr("0.0.0.0", 8)
  );
}
function isBlockedIP(ip) {
  if (!ip) return true;
  if (ip.includes(":")) {
    const l = ip.toLowerCase();
    return l === "::1" || l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe80");
  }
  return isPrivateIPv4(ip);
}
async function assertPublicUrl(u) {
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("只支持 http/https 链接");
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("不允许访问内网地址");
  }
  let addrs;
  try {
    addrs = await Promise.race([
      dns.lookup(host, { all: true }),
      new Promise((_, rej) => setTimeout(() => rej(new Error("DNS 超时")), 8000)),
    ]);
  } catch (e) {
    throw new Error("域名解析失败：" + host + "（" + e.message + "）");
  }
  for (const a of addrs) {
    if (isBlockedIP(a.address)) throw new Error("不允许访问内网地址");
  }
}

/* ---------------- 通用抓取（手动跟随跳转，每跳都检查） ---------------- */
function fetchBuffer(targetUrl, { timeoutMs = 15000, maxBytes = 3 * 1024 * 1024, maxHops = 5 } = {}) {
  return new Promise(async (resolve, reject) => {
    let urlObj;
    try {
      urlObj = new URL(targetUrl);
      await assertPublicUrl(urlObj);
    } catch (e) { reject(e); return; }

    const doHop = (u, hopsLeft, chunks, total) => {
      const lib = u.protocol === "https:" ? https : http;
      const req = lib.request(u, {
        method: "GET",
        headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml", "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8" },
      }, (res) => {
        const loc = res.headers.location;
        if (res.statusCode >= 300 && res.statusCode < 400 && loc && hopsLeft > 0) {
          res.resume();
          let next;
          try {
            next = new URL(loc, u);
            assertPublicUrl(next).then(() => doHop(next, hopsLeft - 1, chunks, total)).catch(reject);
          } catch (e) { reject(e); }
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          reject(new Error("抓取失败，HTTP " + res.statusCode));
          return;
        }
        res.on("data", (c) => {
          total += c.length;
          if (total > maxBytes) { req.destroy(); reject(new Error("页面过大，已放弃")); return; }
          chunks.push(c);
        });
        res.on("end", () => resolve({
          buffer: Buffer.concat(chunks),
          contentType: res.headers["content-type"] || "",
          finalUrl: u.toString(),
        }));
        res.on("error", reject);
      });
      req.on("error", reject);
      req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error("抓取超时")); });
      req.end();
    };
    doHop(urlObj, maxHops, [], 0);
  });
}

/* ---------------- HTML -> 纯文本 ---------------- */
function decodeEntities(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(parseInt(n, 10)); } catch (e) { return ""; } })
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => { try { return String.fromCodePoint(parseInt(n, 16)); } catch (e) { return ""; } })
    .replace(/&(nbsp|amp|lt|gt|quot|apos|middot|ldquo|rdquo|lsquo|rsquo|hellip|mdash|ndash);/g,
      (_, n) => ({ nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", middot: "·", ldquo: "\u201c", rdquo: "\u201d", lsquo: "\u2018", rsquo: "\u2019", hellip: "…", mdash: "—", ndash: "–" }[n] || ""));
}
function detectCharset(buffer, contentType) {
  let m = /charset\s*=\s*["']?([\w-]+)/i.exec(contentType || "");
  if (m) return m[1].toLowerCase();
  const head = buffer.slice(0, 4096).toString("latin1");
  m = /<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head) ||
      /<meta[^>]+content\s*=\s*["'][^"']*charset\s*=\s*([\w-]+)/i.exec(head);
  if (m) return m[1].toLowerCase();
  return "utf-8";
}
function htmlToText(buffer, contentType) {
  const label = detectCharset(buffer, contentType);
  let html;
  try { html = new TextDecoder(label).decode(buffer); }
  catch (e) { html = buffer.toString("utf-8"); }

  let title = "";
  const tm = /<title[^>]*>([\s\S]{0,300})<\/title>/i.exec(html);
  if (tm) title = decodeEntities(tm[1].replace(/<[^>]*>/g, "")).trim();

  let body = html;
  const bm = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
  if (bm) body = bm[1];
  body = body
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<\/(div|p|h\d|li|tr|section|article|br)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  let text = decodeEntities(body)
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/\n[ \t]+/g, "\n")
    .split("\n").map((l) => l.trim()).filter((l) => l.length > 0)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title, text };
}

/* ---------------- 联网搜索（DuckDuckGo HTML 端） ---------------- */
function parseDdgHtml(html, base) {
  const out = [];
  const re = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(html)) && out.length < 10) {
    let href = decodeEntities(m[1]);
    let title = decodeEntities(m[2].replace(/<[^>]*>/g, "")).trim();
    // DDG 把外链包成 //duckduckgo.com/l/?uddg=<encoded>
    const um = /[?&]uddg=([^&]+)/.exec(href);
    if (um) { try { href = decodeURIComponent(um[1]); } catch (e) { /* keep */ } }
    try { href = new URL(href, base).toString(); } catch (e) { continue; }
    if (!/^https?:/.test(href) || /duckduckgo\.com/.test(href)) continue;
    if (out.some((o) => o.url === href)) continue;
    out.push({ title: title || href, url: href, snippet: "" });
  }
  // 摘要
  const sre = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  let i = 0;
  while ((m = sre.exec(html)) && i < out.length) {
    out[i].snippet = decodeEntities(m[1].replace(/<[^>]*>/g, "")).trim().slice(0, 200);
    i++;
  }
  return out;
}
async function ddgSearch(query) {
  const q = encodeURIComponent(query);
  const endpoints = [
    "https://html.duckduckgo.com/html/?q=" + q,
    "https://lite.duckduckgo.com/lite/?q=" + q,
  ];
  let lastErr = null;
  for (const ep of endpoints) {
    try {
      const { buffer } = await fetchBuffer(ep, { timeoutMs: 15000, maxBytes: 1024 * 1024 });
      const html = new TextDecoder("utf-8").decode(buffer);
      const results = parseDdgHtml(html, ep);
      if (results.length) return results;
      lastErr = new Error("无搜索结果");
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("搜索失败");
}

/* ---------------- HTTP 服务 ---------------- */
function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*", // 前端静态站跨域调用
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  const p = u.pathname;

  if (req.method === "GET" && (p === "/" || p === "/index.html")) {
    fs.readFile(path.join(ROOT, "index.html"), (err, data) => {
      if (err) { res.writeHead(500); res.end("index.html missing"); return; }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" });
      res.end(data);
    });
    return;
  }

  if (req.method === "GET" && p === "/api/search") {
    const q = (u.searchParams.get("q") || "").trim().slice(0, 100);
    if (!q) { json(res, 400, { ok: false, error: "缺少 q 参数" }); return; }
    ddgSearch(q + " 投稿须知").then((results) => {
      json(res, 200, { ok: true, query: q, results });
    }).catch((e) => {
      json(res, 502, { ok: false, error: "联网搜索失败：" + e.message });
    });
    return;
  }

  if (req.method === "GET" && p === "/api/fetch") {
    const target = (u.searchParams.get("url") || "").trim();
    if (!target) { json(res, 400, { ok: false, error: "缺少 url 参数" }); return; }
    (async () => {
      try {
        const { buffer, contentType, finalUrl } = await fetchBuffer(target);
        const { title, text } = htmlToText(buffer, contentType);
        if (!text || text.length < 50) throw new Error("页面正文过短或抓取内容为空");
        json(res, 200, { ok: true, url: finalUrl, title, text: text.slice(0, 30000) });
      } catch (e) {
        json(res, 502, { ok: false, error: e.message });
      }
    })();
    return;
  }

  if (p === "/api/health") { json(res, 200, { ok: true }); return; }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(PORT, () => console.log("paper-formatter online on :" + PORT));
