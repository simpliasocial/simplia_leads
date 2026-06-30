import socket
import unittest
from unittest.mock import patch

from app.security import UnsafeUrlError, normalize_public_url


class SecurityTests(unittest.TestCase):
    def test_rejects_localhost(self):
        with self.assertRaises(UnsafeUrlError):
            normalize_public_url("http://localhost/admin", resolve_dns=False)

    def test_rejects_private_ipv4(self):
        with self.assertRaises(UnsafeUrlError):
            normalize_public_url("http://192.168.1.10", resolve_dns=False)

    def test_rejects_cloud_metadata(self):
        with self.assertRaises(UnsafeUrlError):
            normalize_public_url("http://169.254.169.254/latest/meta-data", resolve_dns=False)

    def test_normalizes_public_https(self):
        self.assertEqual(
            normalize_public_url("https://Example.com/about#team", resolve_dns=False),
            "https://example.com/about",
        )

    @patch("app.security.socket.getaddrinfo")
    def test_falls_back_to_www_host_when_apex_dns_fails(self, getaddrinfo):
        def fake_getaddrinfo(host, port):
            if host == "montemidas.ec":
                raise socket.gaierror("dns failed")
            if host == "www.montemidas.ec":
                return [(None, None, None, None, ("34.120.0.1", port))]
            raise AssertionError(f"Host inesperado: {host}")

        getaddrinfo.side_effect = fake_getaddrinfo

        self.assertEqual(
            normalize_public_url("https://montemidas.ec"),
            "https://www.montemidas.ec/",
        )


if __name__ == "__main__":
    unittest.main()
