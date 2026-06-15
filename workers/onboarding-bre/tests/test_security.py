import unittest

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


if __name__ == "__main__":
    unittest.main()
