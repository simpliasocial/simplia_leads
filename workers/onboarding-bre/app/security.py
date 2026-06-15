from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urljoin, urlsplit, urlunsplit


class UnsafeUrlError(ValueError):
    pass


BLOCKED_HOSTS = {
    "localhost",
    "metadata.google.internal",
    "metadata.azure.internal",
}


def _assert_public_ip(value: str) -> None:
    address = ipaddress.ip_address(value)
    if (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_multicast
        or address.is_reserved
        or address.is_unspecified
    ):
        raise UnsafeUrlError(f"Private or reserved address is not allowed: {address}")


def normalize_public_url(value: str, *, resolve_dns: bool = True) -> str:
    raw = (value or "").strip()
    if not raw:
        raise UnsafeUrlError("URL is required")
    if "://" not in raw:
        raw = f"https://{raw}"
    parsed = urlsplit(raw)
    if parsed.scheme not in {"http", "https"}:
        raise UnsafeUrlError("Only HTTP and HTTPS URLs are allowed")
    if parsed.username or parsed.password:
        raise UnsafeUrlError("Credentials in URLs are not allowed")
    if parsed.port not in {None, 80, 443}:
        raise UnsafeUrlError("Non-standard ports are not allowed")
    host = (parsed.hostname or "").lower().rstrip(".")
    if not host or host in BLOCKED_HOSTS:
        raise UnsafeUrlError("Local or metadata hosts are not allowed")
    if host.endswith((".local", ".internal", ".localhost")):
        raise UnsafeUrlError("Private hostnames are not allowed")
    try:
        ipaddress.ip_address(host)
    except ValueError:
        if resolve_dns:
            try:
                addresses = {item[4][0] for item in socket.getaddrinfo(host, parsed.port or 443)}
            except socket.gaierror as exc:
                raise UnsafeUrlError(f"Host cannot be resolved: {host}") from exc
            if not addresses:
                raise UnsafeUrlError(f"Host has no addresses: {host}")
            for address in addresses:
                _assert_public_ip(address)
    else:
        _assert_public_ip(host)
    clean_netloc = f"[{host}]" if ":" in host else host
    if parsed.port and parsed.port not in {80, 443}:
        clean_netloc = f"{host}:{parsed.port}"
    return urlunsplit((parsed.scheme, clean_netloc, parsed.path or "/", parsed.query, ""))


def validate_redirect(current_url: str, location: str) -> str:
    return normalize_public_url(urljoin(current_url, location), resolve_dns=True)
