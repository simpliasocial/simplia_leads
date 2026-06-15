import os
import unittest
from unittest.mock import patch

from app.normalizer import NormalizedContext, normalize_context


DOCUMENT = {
    "sourceId": "source-1",
    "sourceType": "website",
    "url": "https://example.com/",
    "title": "Empresa Ejemplo",
    "extractedText": "Empresa Ejemplo ofrece automatizacion comercial para empresas en Ecuador.",
    "capturedAt": "2026-06-15T00:00:00Z",
    "contentHash": "hash-1",
}


class NormalizerTests(unittest.TestCase):
    def test_structured_output_schema_types_json_values(self):
        schema = NormalizedContext.model_json_schema()
        field_schema = schema["$defs"]["NormalizedField"]["properties"]

        self.assertIn("anyOf", field_schema["value"])
        self.assertEqual(field_schema["alternatives"]["items"]["type"], "string")

    @patch.dict(os.environ, {"OPENAI_API_KEY": "test-key"})
    @patch("app.normalizer.OpenAI", side_effect=RuntimeError("invalid schema"))
    def test_openai_error_returns_fallback_context(self, _openai):
        fields, error, input_hash = normalize_context([DOCUMENT])

        self.assertEqual(len(fields), 11)
        self.assertIn("deterministic fallback used", error)
        self.assertTrue(input_hash)


if __name__ == "__main__":
    unittest.main()
