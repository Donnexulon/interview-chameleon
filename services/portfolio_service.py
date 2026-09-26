"""Consent-gated portfolio retrieval with SSRF and size protections."""

from __future__ import annotations

import ipaddress
import socket
from dataclasses import dataclass
from html.parser import HTMLParser
from urllib.parse import urljoin, urlsplit

import requests


MAX_PORTFOLIO_BYTES = 1_500_000
MAX_PORTFOLIO_TEXT = 20_000
MAX_REDIRECTS = 3
ALLOWED_CONTENT_TYPES = {"text/html", "text/plain"}


@dataclass
class PortfolioFetchError(ValueError):
    code: str
    message: str
    status_code: int = 422
    retryable: bool = False

    def __str__(self) -> str:
        return self.message


class _VisibleTextParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._hidden = 0

    def handle_starttag(self, tag: str, attrs):
        if tag.lower() in {"script", "style", "noscript", "svg"}:
            self._hidden += 1

    def handle_endtag(self, tag: str):
        if tag.lower() in {"script", "style", "noscript", "svg"} and self._hidden:
            self._hidden -= 1

    def handle_data(self, data: str):
        if not self._hidden:
            self.parts.append(data)


def _validate_public_url(raw_url: str) -> str:
    url = str(raw_url or "").strip()
    if not url or len(url) > 2_048:
        raise PortfolioFetchError("portfolio_url_invalid", "Enter a valid portfolio URL")
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise PortfolioFetchError("portfolio_url_invalid", "Only HTTP and HTTPS portfolio URLs are supported")
    if parsed.username or parsed.password:
        raise PortfolioFetchError("portfolio_credentials_blocked", "URLs containing credentials are not allowed")
    try:
        addresses = {item[4][0] for item in socket.getaddrinfo(parsed.hostname, parsed.port or 443)}
    except socket.gaierror as exc:
        raise PortfolioFetchError("portfolio_host_unavailable", "The portfolio host could not be resolved", 502, True) from exc
    for address in addresses:
        ip = ipaddress.ip_address(address)
        if not ip.is_global:
            raise PortfolioFetchError("portfolio_private_host_blocked", "Local and private network addresses are not allowed")
    return url


def fetch_portfolio(url: str, *, network_consent: bool) -> dict[str, str | int]:
    if not network_consent:
        raise PortfolioFetchError(
            "network_consent_required",
            "Portfolio analysis sends this page request over the network. Confirm consent to continue.",
            403,
        )
    current = _validate_public_url(url)
    session = requests.Session()
    session.trust_env = False
    response = None
    for _ in range(MAX_REDIRECTS + 1):
        try:
            response = session.get(
                current,
                timeout=(5, 15),
                stream=True,
                allow_redirects=False,
                headers={"User-Agent": "Interview-Chameleon/1.0 local portfolio reader"},
            )
        except requests.RequestException as exc:
            raise PortfolioFetchError("portfolio_fetch_failed", "The portfolio page could not be reached", 502, True) from exc
        if response.status_code in {301, 302, 303, 307, 308}:
            location = response.headers.get("Location")
            response.close()
            if not location:
                raise PortfolioFetchError("portfolio_redirect_invalid", "The portfolio returned an invalid redirect", 502)
            current = _validate_public_url(urljoin(current, location))
            continue
        break
    else:
        raise PortfolioFetchError("portfolio_redirect_limit", "The portfolio redirected too many times", 502)
    if response is None:
        raise PortfolioFetchError("portfolio_fetch_failed", "The portfolio page could not be reached", 502, True)
    try:
        response.raise_for_status()
        content_type = response.headers.get("Content-Type", "").split(";", 1)[0].lower().strip()
        if content_type not in ALLOWED_CONTENT_TYPES:
            raise PortfolioFetchError("portfolio_type_unsupported", "The portfolio must return HTML or plain text", 415)
        content_length = response.headers.get("Content-Length")
        if content_length and int(content_length) > MAX_PORTFOLIO_BYTES:
            raise PortfolioFetchError("portfolio_too_large", "The portfolio page exceeds the 1.5 MB limit", 413)
        chunks = []
        total = 0
        for chunk in response.iter_content(64 * 1024):
            total += len(chunk)
            if total > MAX_PORTFOLIO_BYTES:
                raise PortfolioFetchError("portfolio_too_large", "The portfolio page exceeds the 1.5 MB limit", 413)
            chunks.append(chunk)
        encoding = response.encoding or "utf-8"
        raw_text = b"".join(chunks).decode(encoding, errors="replace")
    finally:
        response.close()
        session.close()
    if content_type == "text/html":
        parser = _VisibleTextParser()
        parser.feed(raw_text)
        raw_text = " ".join(parser.parts)
    clean = " ".join(raw_text.replace("\x00", " ").split())[:MAX_PORTFOLIO_TEXT]
    if not clean:
        raise PortfolioFetchError("portfolio_empty", "No readable portfolio text was found")
    return {"url": current, "text": clean, "bytes": total}
