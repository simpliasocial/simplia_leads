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


SOURCE_TYPE_LABELS = {
    "instagram": "Instagram",
    "facebook": "Facebook",
    "tiktok": "TikTok",
    "linkedin": "LinkedIn",
    "youtube": "YouTube",
    "other": "La fuente pública",
}


def _no_public_data_message(source_type: str) -> str:
    source_name = SOURCE_TYPE_LABELS.get(source_type, "La fuente pública")
    return (
        f"{source_name} no expuso datos públicos utilizables. La fuente existe o fue proporcionada, "
        "pero no tiene contenido adicional disponible para extraer sin iniciar sesión o sin permisos especiales."
    )


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


def _minimal_source_document(source_type: str, url: str, raw: str = "", reason: str | None = None) -> dict:
    normalized = normalize_public_url(url)
    source_name = SOURCE_TYPE_LABELS.get(source_type, "La fuente pública")
    message = reason or _no_public_data_message(source_type)
    metadata = {
        "sourceType": source_type,
        "sourceName": source_name,
        "noPublicData": True,
        "extractionNote": message,
    }
    if source_type == "tiktok":
        metadata["username"] = _tiktok_username_from_url(normalized)
    text = f"{source_name}: {normalized}. {message}"
    return _document(normalized, text, raw or json.dumps(metadata, ensure_ascii=False), metadata, source_name)


def _partial_no_public_data(source_type: str, url: str, raw: str = "", reason: str | None = None) -> PartialExtractionError:
    message = reason or _no_public_data_message(source_type)
    return PartialExtractionError(message, [_minimal_source_document(source_type, url, raw, message)])


def _extract_readable_text(raw: str, url: str, fallback_text: str = "") -> str:
    extracted = trafilatura.extract(raw, url=url, favor_recall=True) or ""
    if len(extracted.strip()) >= 80:
        return extracted
    visible_text = fallback_text.strip()
    if not visible_text:
        soup = BeautifulSoup(raw, "html.parser")
        visible_text = soup.get_text("\n", strip=True)
    return visible_text


def _public_metadata(raw: str) -> tuple[dict, str]:
    soup = BeautifulSoup(raw, "html.parser")
    metadata: dict[str, str] = {}
    for tag in soup.find_all("meta"):
        key = tag.get("property") or tag.get("name")
        content = tag.get("content")
        if key and content and (str(key).startswith("og:") or str(key).startswith("twitter:") or key in {"description", "keywords"}):
            metadata[str(key)] = str(content)[:4000]
    lines = list(dict.fromkeys(value.strip() for value in metadata.values() if value.strip()))
    return metadata, "\n".join(lines)


def _looks_like_auth_wall(text: str) -> bool:
    lowered = text.casefold()
    markers = ("sign up | linkedin", "agree & join linkedin", "log in or sign up", "inicia sesión o regístrate")
    return any(marker in lowered for marker in markers)


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
            metadata, metadata_text = _public_metadata(raw)
            text = "\n".join(filter(None, [metadata_text, _extract_readable_text(raw, current)]))
            if len(text.strip()) >= 120 or not use_browser_fallback:
                soup = BeautifulSoup(raw, "html.parser")
                title = soup.title.string.strip() if soup.title and soup.title.string else ""
                if _looks_like_auth_wall(text):
                    raise PlatformBlockedError("Platform requires authentication for this public URL")
                return _document(current, text, raw, metadata=metadata, title=title)
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
    metadata, metadata_text = _public_metadata(raw)
    text = "\n".join(filter(None, [metadata_text, _extract_readable_text(raw, final_url, visible_text)]))
    if len(text.strip()) < 80:
        raise PlatformBlockedError("Platform requires authentication or blocked public extraction")
    if _looks_like_auth_wall(text):
        raise PlatformBlockedError("Platform requires authentication for this public URL")
    return _document(final_url, text, raw, metadata=metadata, title=title)


def fetch_public_markdown_proxy(url: str) -> dict:
    normalized = normalize_public_url(url)
    proxy_url = f"https://r.jina.ai/http://{urlsplit(normalized).netloc}{urlsplit(normalized).path or '/'}"
    headers = {"User-Agent": "Mozilla/5.0 (compatible; SimpliaBRE/1.0; +public-onboarding)"}
    response = httpx.get(proxy_url, headers=headers, timeout=30)
    response.raise_for_status()
    raw = response.text
    text = raw.strip()
    if len(text) < 80:
        raise PlatformBlockedError("No se pudo rescatar contenido público legible desde el sitio web")
    title_match = re.search(r"^Title:\s*(.+)$", raw, re.MULTILINE)
    title = title_match.group(1).strip() if title_match else urlsplit(normalized).netloc
    metadata = {
        "fallbackReader": "r.jina.ai",
        "sourceUrl": normalized,
    }
    return _document(normalized, text, raw, metadata=metadata, title=title)


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
    profile_document = _scrape_tiktok_public_profile(url)
    if profile_document.get("metadata", {}).get("noPublicData"):
        raise PartialExtractionError(_no_public_data_message("tiktok"), [profile_document])
    try:
        metadata = _yt_dlp_metadata(url)
        raw = json.dumps(metadata, ensure_ascii=False)
        entries = metadata.get("entries") or []
        if not entries:
            return [profile_document]
        text = "\n".join(
            filter(None, [
                str(metadata.get("title") or ""),
                str(metadata.get("description") or ""),
                *[str(item.get("title") or item.get("description") or "") for item in entries],
            ])
        )
        return [profile_document, _document(url, text, raw, metadata, str(metadata.get("title") or "TikTok"))]
    except Exception:
        return [profile_document]


def _tiktok_username_from_url(url: str) -> str:
    match = re.search(r"tiktok\.com/@([^/?#]+)", url)
    return match.group(1) if match else urlsplit(url).path.strip("/").lstrip("@") or "perfil"


def _tiktok_minimal_document(url: str, raw: str) -> dict:
    return _minimal_source_document("tiktok", url, raw, _no_public_data_message("tiktok"))


def _has_useful_tiktok_data(public_data: dict) -> bool:
    if public_data.get("biography") or public_data.get("bioLink") or public_data.get("verified"):
        return True
    for key in ("followers", "following", "likes", "videos"):
        value = public_data.get(key)
        if isinstance(value, (int, float)) and value > 0:
            return True
    return False


def _scrape_tiktok_public_profile(url: str) -> dict:
    normalized = normalize_public_url(url)
    with httpx.Client(timeout=25, follow_redirects=True, headers={"User-Agent": "Mozilla/5.0"}) as client:
        response = client.get(normalized)
        response.raise_for_status()
    soup = BeautifulSoup(response.text, "html.parser")
    script = soup.find("script", id="__UNIVERSAL_DATA_FOR_REHYDRATION__")
    if not script or not script.string:
        return _tiktok_minimal_document(normalized, response.text)
    payload = json.loads(script.string)
    detail = payload.get("__DEFAULT_SCOPE__", {}).get("webapp.user-detail", {})
    user_info = detail.get("userInfo") or {}
    user = user_info.get("user") or {}
    stats = user_info.get("stats") or {}
    if not user.get("uniqueId"):
        return _tiktok_minimal_document(normalized, response.text)
    public_data = {
        "username": user.get("uniqueId"),
        "nickname": user.get("nickname"),
        "biography": user.get("signature"),
        "verified": user.get("verified"),
        "language": user.get("language"),
        "bioLink": (user.get("bioLink") or {}).get("link"),
        "followers": stats.get("followerCount"),
        "following": stats.get("followingCount"),
        "likes": stats.get("heartCount"),
        "videos": stats.get("videoCount"),
    }
    text = "\n".join(
        f"{key}: {value}" for key, value in public_data.items() if value not in (None, "", [])
    )
    raw = json.dumps(public_data, ensure_ascii=False)
    document = _document(normalized, text, raw, public_data, str(user.get("nickname") or user.get("uniqueId")))
    if not _has_useful_tiktok_data(public_data):
        document["metadata"]["noPublicData"] = True
        document["metadata"]["extractionNote"] = _no_public_data_message("tiktok")
        document["extractedText"] = f"{document['extractedText']}\n{_no_public_data_message('tiktok')}".strip()
    return document


def scrape_social(source_type: str, url: str) -> list[dict]:
    try:
        if source_type == "instagram":
            return scrape_instagram(url)
        if source_type == "youtube":
            return scrape_youtube(url)
        if source_type == "tiktok":
            return scrape_tiktok(url)
        return [fetch_public_html(url, use_browser_fallback=source_type in {"facebook", "linkedin", "other"})]
    except PartialExtractionError:
        raise
    except PlatformBlockedError as exc:
        raise _partial_no_public_data(source_type, url, reason=_no_public_data_message(source_type)) from exc
