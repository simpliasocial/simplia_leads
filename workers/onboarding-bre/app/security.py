from __future__ import annotations

import ipaddress
import json
import socket
from urllib.parse import urlencode
from urllib.request import urlopen
from urllib.parse import urljoin, urlsplit, urlunsplit


class UnsafeUrlError(ValueError):
    pass


BLOCKED_HOSTS = {
    "localhost",
    "metadata.google.internal",
    "metadata.azure.internal",
}

DOH_ENDPOINT = "https://dns.google/resolve"


def _candidate_hosts(host: str) -> list[str]:
    candidates = [host]
    if host.startswith("www."):
        candidates.append(host[4:])
    else:
        candidates.append(f"www.{host}")
    return [candidate for index, candidate in enumerate(candidates) if candidate and candidate not in candidates[:index]]


def _resolve_public_host_via_doh(host: str) -> set[str]:
    query = urlencode({"name": host, "type": "A"})
    with urlopen(f"{DOH_ENDPOINT}?{query}", timeout=8) as response:
        payload = json.loads(response.read().decode("utf-8"))
    answers = payload.get("Answer") or []
    addresses = {str(item.get("data", "")).strip() for item in answers if item.get("type") == 1 and str(item.get("data", "")).strip()}
    if not addresses:
        raise UnsafeUrlError(f"Host cannot be resolved: {host}")
    for address in addresses:
        _assert_public_ip(address)
    return addresses


def _resolve_public_host(host: str, port: int) -> tuple[str, set[str]]:
    last_error: socket.gaierror | None = None
    for candidate in _candidate_hosts(host):
        try:
            addresses = {item[4][0] for item in socket.getaddrinfo(candidate, port)}
        except socket.gaierror as exc:
            last_error = exc
            continue
        if not addresses:
            try:
                addresses = _resolve_public_host_via_doh(candidate)
            except Exception:
                continue
        for address in addresses:
            _assert_public_ip(address)
        return candidate, addresses
    for candidate in _candidate_hosts(host):
        try:
            return candidate, _resolve_public_host_via_doh(candidate)
        except Exception:
            continue
    if last_error:
        raise UnsafeUrlError(f"Host cannot be resolved: {host}") from last_error
    raise UnsafeUrlError(f"Host has no addresses: {host}")


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
            host, _ = _resolve_public_host(host, parsed.port or 443)
    else:
        _assert_public_ip(host)
    clean_netloc = f"[{host}]" if ":" in host else host
    if parsed.port and parsed.port not in {80, 443}:
        clean_netloc = f"{host}:{parsed.port}"
    return urlunsplit((parsed.scheme, clean_netloc, parsed.path or "/", parsed.query, ""))


def validate_redirect(current_url: str, location: str) -> str:
    return normalize_public_url(urljoin(current_url, location), resolve_dns=True)
