from __future__ import annotations

import json
import sys
import tempfile
from pathlib import Path

from scrapy.crawler import CrawlerProcess

from .site_spider import BreWebsiteSpider


def main() -> int:
    payload = json.loads(sys.stdin.read())
    with tempfile.TemporaryDirectory() as temp_dir:
        output_path = Path(temp_dir) / "documents.jsonl"
        process = CrawlerProcess(settings={
            "LOG_ENABLED": False,
            "FEEDS": {str(output_path): {"format": "jsonlines", "overwrite": True}},
        })
        crawler = process.create_crawler(BreWebsiteSpider)
        process.crawl(
            crawler,
            start_url=payload["url"],
            max_pages=payload.get("maxPages", 50),
            max_depth=payload.get("maxDepth", 3),
        )
        process.start()
        documents = []
        if output_path.exists():
            documents = [json.loads(line) for line in output_path.read_text(encoding="utf-8").splitlines() if line.strip()]
        discovered = list(getattr(crawler.spider, "discovered_sources", {}).values())
        print(json.dumps({"documents": documents, "discoveredSources": discovered}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
