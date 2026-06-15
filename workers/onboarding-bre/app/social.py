from __future__ import annotations

import hashlib
import json
import os
import re
import time
from datetime import datetime, timezone
from urllib.parse import urlsplit

import httpx
import instaloader
import trafilatura
import yt_dlp
from bs4 import BeautifulSoup
from playwright.sync_api import sync_playwright

from .security import UnsafeUrlError, normalize_public_url, validate_redirect


class PlatformBlockedError(RuntimeError):
    pass


class PartialExtractionError(RuntimeError):
    def __init__(self, message: str, documents: list[dict]):
        super().__init__(message)
        self.documents = documents


def _document(url: str, text: str, raw: str, metadata: dict | None = None, title: str = "") -> dict:
    return {
        "kind": "document",
        "url": url,
        "title": title,
        "extractedText": text[:200_000],
        "rawContent": raw[:2_000_000],
        "contentType": "text/html",
        "contentHash": hashlib.sha256(raw.encode("utf-8", errors="ignore")).hexdigest(),
        "capturedAt": datetime.now(timezone.utc).isoformat(),
        "metadata": metadata or {},
    }


def _extract_readable_text(raw: str, url: str, fallback_text: str = "") -> str:
    extracted = trafilatura.extract(raw, url=url, favor_recall=True) or ""
    if len(extracted.strip()) >= 80:
        return extracted
    visible_text = fallback_text.strip()
    if not visible_text:
        soup = BeautifulSoup(raw, "html.parser")
        visible_text = soup.get_text("\n", strip=True)
    return visible_text


def fetch_public_html(url: str, use_browser_fallback: bool = True) -> dict:
    current = normalize_public_url(url)
    headers = {"User-Agent": "Mozilla/5.0 (compatible; SimpliaBRE/1.0; +public-onboarding)"}
    with httpx.Client(timeout=20, headers=headers, follow_redirects=False) as client:
        for _ in range(6):
            response = client.get(current)
            if response.status_code in {301, 302, 303, 307, 308}:
                location = response.headers.get("location")
                if not location:
                    break
                current = validate_redirect(current, location)
                continue
            if response.status_code in {401, 403, 429}:
                raise PlatformBlockedError(f"Platform returned HTTP {response.status_code}")
            if response.status_code == 999:
                raise PlatformBlockedError("LinkedIn blocked automated public extraction (HTTP 999)")
            response.raise_for_status()
            raw = response.text
            text = _extract_readable_text(raw, current)
            if len(text.strip()) >= 120 or not use_browser_fallback:
                soup = BeautifulSoup(raw, "html.parser")
                title = soup.title.string.strip() if soup.title and soup.title.string else ""
                return _document(current, text, raw, title=title)
            break
    if not use_browser_fallback:
        raise PlatformBlockedError("Public page did not expose readable content")
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        page = browser.new_page(user_agent=headers["User-Agent"])

        def guard_route(route):
            try:
                scheme = urlsplit(route.request.url).scheme.lower()
                if scheme in {"http", "https"}:
                    normalize_public_url(route.request.url)
                route.continue_()
            except (UnsafeUrlError, ValueError):
                route.abort()

        page.route("**/*", guard_route)
        try:
            response = page.goto(current, wait_until="domcontentloaded", timeout=30_000)
            if response and response.status in {401, 403, 429, 999}:
                raise PlatformBlockedError(f"Platform returned HTTP {response.status}")
            page.wait_for_timeout(2_500)
            final_url = normalize_public_url(page.url)
            raw = page.content()
            title = page.title()
            try:
                visible_text = page.locator("body").inner_text(timeout=5_000)
            except Exception:
                visible_text = ""
        finally:
            page.unroute("**/*", guard_route)
            browser.close()
    text = _extract_readable_text(raw, final_url, visible_text)
    if len(text.strip()) < 80:
        raise PlatformBlockedError("Platform requires authentication or blocked public extraction")
    return _document(final_url, text, raw, title=title)


def scrape_instagram(url: str) -> list[dict]:
    username_match = re.search(r"instagram\.com/([^/?#]+)", url)
    if not username_match:
        return [fetch_public_html(url)]
    username = username_match.group(1)
    loader = instaloader.Instaloader(download_pictures=False, download_videos=False, save_metadata=False, quiet=True)
    try:
        profile = instaloader.Profile.from_username(loader.context, username)
        captions = []
        for index, post in enumerate(profile.get_posts()):
            if index >= 12:
                break
            if post.caption:
                captions.append(post.caption)
            time.sleep(0.25)
        payload = {
            "username": profile.username,
            "fullName": profile.full_name,
            "biography": profile.biography,
            "externalUrl": profile.external_url,
            "followers": profile.followers,
            "recentCaptions": captions,
        }
        raw = json.dumps(payload, ensure_ascii=False)
        return [_document(url, "\n\n".join(filter(None, [profile.full_name, profile.biography, *captions])), raw, payload, profile.full_name)]
    except Exception:
        return [fetch_public_html(url)]


def _yt_dlp_metadata(url: str) -> dict:
    options = {
        "quiet": True,
        "no_warnings": True,
        "skip_download": True,
        "extract_flat": True,
        "playlistend": 12,
        "socket_timeout": 20,
    }
    with yt_dlp.YoutubeDL(options) as downloader:
        info = downloader.extract_info(url, download=False)
    selected = {key: info.get(key) for key in ("id", "title", "description", "channel", "channel_id", "uploader", "webpage_url", "entries")}
    if selected.get("entries"):
        selected["entries"] = [
            {key: item.get(key) for key in ("id", "title", "description", "url")}
            for item in selected["entries"][:12]
        ]
    return selected


def scrape_youtube(url: str) -> list[dict]:
    api_key = os.getenv("YOUTUBE_API_KEY")
    metadata = _yt_dlp_metadata(url)
    channel_id = metadata.get("channel_id")
    if api_key and channel_id:
        with httpx.Client(timeout=20) as client:
            channel_response = client.get("https://www.googleapis.com/youtube/v3/channels", params={
                "part": "snippet,brandingSettings,statistics",
                "id": channel_id,
                "key": api_key,
            })
            if channel_response.is_success:
                metadata["youtubeDataApi"] = channel_response.json().get("items", [])
                metadata["apiQuotaMode"] = "free_quota"
    raw = json.dumps(metadata, ensure_ascii=False)
    text = "\n\n".join(str(value) for key, value in metadata.items() if key != "entries" and value)
    for item in metadata.get("entries") or []:
        text += f"\n{item.get('title', '')}\n{item.get('description', '')}"
    return [_document(url, text, raw, metadata, str(metadata.get("title") or metadata.get("channel") or "YouTube"))]


def scrape_tiktok(url: str) -> list[dict]:
    try:
        metadata = _yt_dlp_metadata(url)
        raw = json.dumps(metadata, ensure_ascii=False)
        return [_document(url, raw, raw, metadata, str(metadata.get("title") or "TikTok"))]
    except Exception as exc:
        if "does not have any videos posted" in str(exc).lower():
            username_match = re.search(r"tiktok\.com/@([^/?#]+)", url)
            username = username_match.group(1) if username_match else ""
            payload = {
                "username": username,
                "profileUrl": url,
                "recentVideos": [],
                "extractionStatus": "no_public_videos",
            }
            raw = json.dumps(payload, ensure_ascii=False)
            text = f"TikTok profile: @{username}\nNo public videos were exposed by the platform."
            document = _document(url, text, raw, payload, f"@{username} | TikTok")
            raise PartialExtractionError(
                "El perfil es publico, pero TikTok no expuso videos o contenido adicional para extraer.",
                [document],
            ) from exc
        return [fetch_public_html(url)]


def scrape_social(source_type: str, url: str) -> list[dict]:
    if source_type == "instagram":
        return scrape_instagram(url)
    if source_type == "youtube":
        return scrape_youtube(url)
    if source_type == "tiktok":
        return scrape_tiktok(url)
    return [fetch_public_html(url, use_browser_fallback=source_type in {"facebook", "linkedin", "other"})]
