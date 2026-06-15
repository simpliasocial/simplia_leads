from __future__ import annotations

import hashlib
import json
import re
from datetime import datetime, timezone
from urllib.parse import urljoin, urlsplit

import scrapy
import tldextract
import trafilatura
from bs4 import BeautifulSoup

from .security import UnsafeUrlError, normalize_public_url, validate_redirect


SOCIAL_HOSTS = {
    "instagram.com": "instagram",
    "facebook.com": "facebook",
    "fb.com": "facebook",
    "tiktok.com": "tiktok",
    "linkedin.com": "linkedin",
    "youtube.com": "youtube",
    "youtu.be": "youtube",
}

PRIORITY_WORDS = {
    "about": 80,
    "nosotros": 80,
    "empresa": 70,
    "services": 70,
    "servicios": 70,
    "products": 65,
    "productos": 65,
    "faq": 60,
    "preguntas": 60,
    "contact": 55,
    "contacto": 55,
    "legal": 40,
    "privacy": 40,
    "privacidad": 40,
    "terms": 40,
    "terminos": 40,
}


async def secure_playwright_page(page, request):
    async def guard(route):
        try:
            normalize_public_url(route.request.url)
            await route.continue_()
        except (UnsafeUrlError, ValueError):
            await route.abort()
    await page.route("**/*", guard)


def registrable_domain(url: str) -> str:
    parts = tldextract.extract(url)
    return ".".join(part for part in (parts.domain, parts.suffix) if part)


class BreWebsiteSpider(scrapy.Spider):
    name = "bre_website"
    handle_httpstatus_list = [301, 302, 303, 307, 308, 401, 403, 404, 429, 500, 502, 503, 504]
    custom_settings = {
        "ROBOTSTXT_OBEY": True,
        "CONCURRENT_REQUESTS_PER_DOMAIN": 2,
        "DOWNLOAD_DELAY": 0.35,
        "RANDOMIZE_DOWNLOAD_DELAY": True,
        "DOWNLOAD_TIMEOUT": 20,
        "RETRY_TIMES": 2,
        "DEPTH_LIMIT": 3,
        "REDIRECT_ENABLED": False,
        "COOKIES_ENABLED": False,
        "TELNETCONSOLE_ENABLED": False,
        "DOWNLOAD_HANDLERS": {
            "http": "scrapy_playwright.handler.ScrapyPlaywrightDownloadHandler",
            "https": "scrapy_playwright.handler.ScrapyPlaywrightDownloadHandler",
        },
        "TWISTED_REACTOR": "twisted.internet.asyncioreactor.AsyncioSelectorReactor",
        "PLAYWRIGHT_BROWSER_TYPE": "chromium",
        "PLAYWRIGHT_DEFAULT_NAVIGATION_TIMEOUT": 20000,
    }

    def __init__(self, start_url: str, max_pages: int = 50, max_depth: int = 3, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.start_url = normalize_public_url(start_url)
        self.base_domain = registrable_domain(self.start_url)
        self.max_pages = min(max(int(max_pages), 1), 50)
        self.custom_settings = {**self.custom_settings, "DEPTH_LIMIT": min(max(int(max_depth), 0), 3)}
        self.pages_seen = 0
        self.discovered_sources: dict[str, dict] = {}

    def start_requests(self):
        yield scrapy.Request(self.start_url, callback=self.parse_page, errback=self.errback, priority=100)
        sitemap_url = urljoin(self.start_url, "/sitemap.xml")
        if sitemap_url != self.start_url:
            yield scrapy.Request(sitemap_url, callback=self.parse_sitemap, errback=self.ignore_error, priority=90)

    def parse_sitemap(self, response):
        if response.status != 200:
            return
        urls = re.findall(r"<loc>\s*(.*?)\s*</loc>", response.text, flags=re.IGNORECASE)
        for candidate in sorted(urls, key=self._priority, reverse=True)[: self.max_pages]:
            safe = self._safe_internal(candidate)
            if safe:
                yield scrapy.Request(safe, callback=self.parse_page, errback=self.errback, priority=self._priority(safe))

    def parse_page(self, response):
        if response.status in {301, 302, 303, 307, 308}:
            location = response.headers.get("Location")
            if location:
                try:
                    target = validate_redirect(response.url, location.decode())
                    if self._safe_internal(target):
                        yield scrapy.Request(target, callback=self.parse_page, errback=self.errback, priority=100)
                except UnsafeUrlError:
                    return
            return
        if response.status != 200 or self.pages_seen >= self.max_pages:
            return
        content_type = response.headers.get("Content-Type", b"").decode().lower()
        if "text/html" not in content_type:
            return
        raw_html = response.text
        extracted = trafilatura.extract(
            raw_html,
            url=response.url,
            include_links=False,
            include_tables=True,
            favor_recall=True,
        ) or ""
        if len(extracted.strip()) < 180 and not response.meta.get("playwright_rendered"):
            yield scrapy.Request(
                response.url,
                callback=self.parse_page,
                errback=self.errback,
                dont_filter=True,
                meta={
                    "playwright": True,
                    "playwright_rendered": True,
                    "playwright_page_init_callback": secure_playwright_page,
                    "depth": response.meta.get("depth", 0),
                },
                priority=110,
            )
            return

        self.pages_seen += 1

        soup = BeautifulSoup(raw_html, "html.parser")
        title = (soup.title.string or "").strip() if soup.title and soup.title.string else ""
        metadata = self._metadata(soup)
        links = []
        for anchor in soup.find_all("a", href=True):
            href = anchor.get("href", "").strip()
            if not href or href.startswith(("mailto:", "tel:", "javascript:", "#")):
                continue
            absolute = urljoin(response.url, href)
            social = self._social_type(absolute)
            if social:
                try:
                    normalized = normalize_public_url(absolute)
                    self.discovered_sources[normalized] = {"type": social, "url": normalized}
                except UnsafeUrlError:
                    pass
                continue
            safe = self._safe_internal(absolute)
            if safe:
                links.append(safe)

        captured_at = datetime.now(timezone.utc).isoformat()
        content_hash = hashlib.sha256(raw_html.encode("utf-8", errors="ignore")).hexdigest()
        yield {
            "kind": "document",
            "url": response.url,
            "title": title,
            "extractedText": extracted[:200_000],
            "rawContent": raw_html[:2_000_000],
            "contentType": "text/html",
            "contentHash": content_hash,
            "capturedAt": captured_at,
            "metadata": metadata,
        }
        for link in sorted(set(links), key=self._priority, reverse=True):
            if self.pages_seen >= self.max_pages:
                break
            yield scrapy.Request(link, callback=self.parse_page, errback=self.errback, priority=self._priority(link))

    def closed(self, reason):
        for source in self.discovered_sources.values():
            self.crawler.stats.inc_value("bre/discovered_sources")

    def _safe_internal(self, candidate: str) -> str | None:
        try:
            normalized = normalize_public_url(candidate)
        except (UnsafeUrlError, ValueError):
            return None
        parsed = urlsplit(normalized)
        if registrable_domain(normalized) != self.base_domain:
            return None
        if parsed.path.lower().endswith((".pdf", ".zip", ".rar", ".jpg", ".jpeg", ".png", ".gif", ".svg", ".mp4", ".mp3")):
            return None
        query = parsed.query.lower()
        if any(token in query for token in ("session=", "token=", "logout", "replytocom=", "add-to-cart=")):
            return None
        return normalized

    def _priority(self, url: str) -> int:
        lowered = url.lower()
        score = 10
        for word, value in PRIORITY_WORDS.items():
            if word in lowered:
                score = max(score, value)
        score -= min(len(urlsplit(url).query), 30)
        return score

    def _social_type(self, url: str) -> str | None:
        host = (urlsplit(url).hostname or "").lower()
        for domain, source_type in SOCIAL_HOSTS.items():
            if host == domain or host.endswith(f".{domain}"):
                return source_type
        return None

    def _metadata(self, soup: BeautifulSoup) -> dict:
        result: dict = {"openGraph": {}, "jsonLd": []}
        for tag in soup.find_all("meta"):
            key = tag.get("property") or tag.get("name")
            content = tag.get("content")
            if key and content and (str(key).startswith("og:") or key in {"description", "keywords"}):
                result["openGraph"][str(key)] = str(content)[:4000]
        for script in soup.find_all("script", attrs={"type": "application/ld+json"}):
            try:
                result["jsonLd"].append(json.loads(script.string or ""))
            except (json.JSONDecodeError, TypeError):
                continue
        return result

    def errback(self, failure):
        self.logger.debug("Website request failed: %s", failure)

    def ignore_error(self, failure):
        return None
