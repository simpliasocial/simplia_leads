import unittest
from unittest.mock import patch

from app.social import PartialExtractionError, _extract_readable_text, scrape_tiktok


class SocialExtractionTests(unittest.TestCase):
    @patch("app.social.trafilatura.extract", return_value="")
    def test_uses_visible_text_when_article_extraction_is_empty(self, _extract):
        raw = "<html><body><main>Contenido publico renderizado para describir el negocio y sus servicios principales.</main></body></html>"

        text = _extract_readable_text(raw, "https://example.com/")

        self.assertIn("Contenido publico renderizado", text)

    @patch("app.social._yt_dlp_metadata", side_effect=RuntimeError("This account does not have any videos posted"))
    def test_tiktok_profile_without_videos_is_partial(self, _metadata):
        with self.assertRaises(PartialExtractionError) as raised:
            scrape_tiktok("https://www.tiktok.com/@simplia.social")

        document = raised.exception.documents[0]
        self.assertEqual(document["metadata"]["username"], "simplia.social")
        self.assertEqual(document["metadata"]["extractionStatus"], "no_public_videos")


if __name__ == "__main__":
    unittest.main()
